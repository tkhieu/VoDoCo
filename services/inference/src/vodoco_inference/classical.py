"""Safe CPU inference for the three classical VietMed-NER models."""
from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
import unicodedata

import numpy as np

from .artifacts import BACKGROUND_LABELS, ENTITY_LABELS, asset_path
from .errors import InferenceError
from .schemas import CLASSICAL_TOKEN_LIMIT

_WHITESPACE_TOKEN = re.compile(r"\S+")


@dataclass(frozen=True, slots=True)
class ClassicalToken:
    normalized: str
    start: int
    end: int


def _punctuation(character: str) -> bool:
    return unicodedata.category(character).startswith("P")


def tokenize_classical(text: str) -> list[ClassicalToken]:
    """Normalize model input while retaining exact code-point offsets in the source."""
    tokens = []
    for match in _WHITESPACE_TOKEN.finditer(text):
        raw = match.group()
        left = 0
        right = len(raw)
        while left < right and _punctuation(raw[left]):
            left += 1
        while right > left and _punctuation(raw[right - 1]):
            right -= 1
        if left == right:
            continue
        normalized = unicodedata.normalize("NFC", raw[left:right]).lower()
        if not normalized:
            continue
        tokens.append(ClassicalToken(normalized, match.start() + left, match.start() + right))
    return tokens


def word_features(words: list[str], index: int) -> dict[str, str | bool | int | float]:
    """Feature function shared verbatim by export and runtime inference."""
    word = words[index]
    features: dict[str, str | bool | int | float] = {
        "bias": 1.0,
        "w.lower": word.lower(),
        "w.istitle": word.istitle(),
        "w.isdigit": word.isdigit(),
        "w.len": min(len(word), 8),
        "suf2": word[-2:].lower(),
        "pre2": word[:2].lower(),
    }
    for offset in (-2, -1, 1, 2):
        neighbor = index + offset
        if 0 <= neighbor < len(words):
            features[f"{offset}:w.lower"] = words[neighbor].lower()
            features[f"{offset}:w.istitle"] = words[neighbor].istitle()
            if abs(offset) == 1:
                low, high = sorted((index, neighbor))
                features[f"{offset}:bigram"] = f"{words[low].lower()}_{words[high].lower()}"
        else:
            features[f"{offset}:pad"] = True
    return features


def featurize(words: list[str]) -> list[dict[str, str | bool | int | float]]:
    return [word_features(words, index) for index in range(len(words))]


def _encoded_features(
    features: dict[str, str | bool | int | float], vocabulary: dict[str, int]
) -> tuple[np.ndarray, np.ndarray]:
    indices = []
    values = []
    for name, value in features.items():
        if isinstance(value, str):
            feature_name = f"{name}={value}"
            numeric = 1.0
        elif isinstance(value, (bool, int, float)):
            feature_name = name
            numeric = float(value)
        else:
            raise ValueError("Unsupported classical feature value")
        position = vocabulary.get(feature_name)
        if position is not None and numeric != 0:
            indices.append(position)
            values.append(numeric)
    return np.asarray(indices, dtype=np.intp), np.asarray(values, dtype=np.float64)


class LinearPredictor:
    def __init__(self, coefficients: np.ndarray, intercept: np.ndarray, classes: np.ndarray,
                 vocabulary: dict[str, int]):
        if coefficients.ndim != 2 or intercept.ndim != 1 or classes.ndim != 1:
            raise ValueError("Invalid linear classifier arrays")
        if coefficients.shape[0] != intercept.shape[0] or coefficients.shape[0] != classes.shape[0]:
            raise ValueError("Linear classifier class dimensions disagree")
        if coefficients.shape[1] != len(vocabulary) or set(vocabulary.values()) != set(range(len(vocabulary))):
            raise ValueError("Linear classifier feature dimensions disagree")
        self.coefficients = coefficients
        self.intercept = intercept
        self.classes = classes.astype(str)
        self.vocabulary = vocabulary

    @classmethod
    def load(cls, model_root: Path, spec: dict) -> LinearPredictor:
        feature_path = asset_path(model_root, f"{spec['model_path']}/features.json")
        feature_document = json.loads(feature_path.read_text(encoding="utf-8"))
        if feature_document.get("schema_version") != 1:
            raise ValueError("Unsupported feature vocabulary")
        vocabulary = {str(name): int(index) for name, index in feature_document["vocabulary"].items()}
        with np.load(asset_path(model_root, spec["weight_path"]), allow_pickle=False) as archive:
            if set(archive.files) != {"coef", "intercept", "classes"}:
                raise ValueError("Unexpected linear classifier arrays")
            return cls(archive["coef"], archive["intercept"], archive["classes"], vocabulary)

    def predict(self, words: list[str]) -> list[str]:
        labels = []
        for features in featurize(words):
            indices, values = _encoded_features(features, self.vocabulary)
            scores = self.intercept if not len(indices) else self.intercept + self.coefficients[:, indices] @ values
            labels.append(str(self.classes[int(np.argmax(scores))]))
        return labels


class CrfPredictor:
    def __init__(self, model_path: Path):
        import pycrfsuite

        self.tagger = pycrfsuite.Tagger()
        self.tagger.open(str(model_path))

    def predict(self, words: list[str]) -> list[str]:
        return [str(label) for label in self.tagger.tag(featurize(words))]


def load_classical_predictor(model_root: Path, spec: dict):
    artifact_type = spec.get("artifact_type")
    if artifact_type == "linear-npz-v1":
        return LinearPredictor.load(model_root, spec)
    if artifact_type == "crfsuite-v1":
        return CrfPredictor(asset_path(model_root, spec["weight_path"]))
    raise ValueError("Unsupported classical NER artifact")


def bio_spans(labels: list[str]) -> list[tuple[str, int, int]]:
    """Return (entity type, start token, exclusive end token), matching seqeval transitions."""
    spans = []
    active_label = None
    active_start = 0
    for index, tag in enumerate([*labels, "O"]):
        if tag in BACKGROUND_LABELS:
            prefix, label = "O", None
        elif tag.startswith(("B-", "I-")) and tag[2:] in ENTITY_LABELS:
            prefix, label = tag[0], tag[2:]
        else:
            raise ValueError("Unsupported BIO label")
        continues = prefix == "I" and active_label == label
        if active_label is not None and not continues:
            spans.append((active_label, active_start, index))
            active_label = None
        if prefix == "B" or (prefix == "I" and active_label is None):
            active_label = label
            active_start = index
    return spans


def adapt_classical_entities(text: str, tokens: list[ClassicalToken], labels: list[str],
                             model_id: str, revision: int) -> list[dict]:
    if len(tokens) != len(labels):
        raise InferenceError("NER_OUTPUT_INVALID", "The model returned an invalid label sequence.",
                             "recognizing", model_id)
    try:
        spans = bio_spans(labels)
    except ValueError as exc:
        raise InferenceError("NER_LABEL_INVALID", "The model returned an unsupported entity label.",
                             "recognizing", model_id) from exc
    entities = []
    for label, token_start, token_end in spans:
        start = tokens[token_start].start
        end = tokens[token_end - 1].end
        entities.append({
            "id": f"{model_id}:{revision}:{len(entities)}",
            "text": text[start:end],
            "label": label,
            "start": start,
            "end": end,
            "offset_unit": "unicode_codepoint",
            "score": None,
        })
    return entities
