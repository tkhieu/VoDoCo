from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
import pytest

from vodoco_inference.classical import adapt_classical_entities, tokenize_classical
from vodoco_inference.runtime import ModelRuntime, adapt_entities


def test_repeated_unicode_occurrences_are_not_first_matched():
    text = "👩🏽‍⚕️ đau đau"
    first = len("👩🏽‍⚕️ ")
    items = [
        {"entity_group": "DISEASESYMTOM", "word": "đau", "start": first, "end": first + 3, "score": 0.9},
        {"entity_group": "DISEASESYMTOM", "word": "đau", "start": first + 4, "end": first + 7, "score": 0.8},
    ]
    entities = adapt_entities(items, text, "xlmr", 0, True)
    assert [(item["start"], item["end"]) for item in entities] == [(first, first + 3), (first + 4, first + 7)]
    assert entities[0]["id"] != entities[1]["id"]
    assert all(text[item["start"]:item["end"]] == item["text"] for item in entities)


def test_normalized_or_slow_offsets_are_list_only():
    item = {"entity_group": "ORGAN", "word": "é", "start": 0, "end": 2, "score": 0.8}
    entity = adapt_entities([item], "e\u0301", "xlmr", 0, True)[0]
    assert entity["start"] is None and entity["end"] is None
    item.update(word="tim", start=0, end=3)
    entity = adapt_entities([item], "tim", "phobert", 0, False)[0]
    assert entity["start"] is None and entity["end"] is None
    assert entity["text"] == "tim"


def test_background_strings_do_not_hide_xlmr_class_zero_organ():
    # XLM-R class zero maps to I-ORGAN, not the background string '0'.
    items = [{"entity_group": label, "word": "tim", "start": 0, "end": 3, "score": 0.9}
             for label in ("0", "O", "dum", "I-ORGAN")]
    entities = adapt_entities(items, "tim", "xlmr", 0, True)
    assert [(item["text"], item["label"]) for item in entities] == [("tim", "ORGAN")]


class WordTokenizer:
    is_fast = False

    def __call__(self, text, *, add_special_tokens=True, truncation=False):
        words = text.split()
        if truncation:
            words = words[:256 - (2 if add_special_tokens else 0)]
        tokens = [3] * len(words)
        return {"input_ids": [1] + tokens + [2] if add_special_tokens else tokens}


@pytest.mark.parametrize("model_id", ["phobert", "vihealthbert-ner-seed2024"])
def test_256_includes_special_tokens_and_never_silently_truncates(model_id):
    runtime = ModelRuntime(Path("unused"), Path("unused"))
    runtime.model_statuses[model_id]["status"] = "ready"
    runtime.tokenizers[model_id] = WordTokenizer()
    runtime._torch = SimpleNamespace(inference_mode=nullcontext, cuda=SimpleNamespace(synchronize=lambda: None))
    # The entity at the end proves the accepted boundary reaches inference intact.
    runtime.pipelines[model_id] = lambda text: [{
        "entity_group": "ORGAN", "word": text.split()[-1], "score": 0.9,
    }]
    exact = runtime.recognize("x " * 253 + "tim", model_id, "review", 4)
    over = runtime.recognize("x " * 254 + "tim", model_id, "review", 5)
    assert exact["status"] == "succeeded" and exact["entities"][0]["text"] == "tim"
    assert over["status"] == "failed"
    assert over["error"]["code"] == "NER_INPUT_TOO_LONG"
    assert over["entities"] == []
    assert over["revision"] == 5 and over["source"] == "review"


def test_classical_preprocessing_lowercases_nfc_and_trims_boundary_punctuation_with_offsets():
    text = "  (ĐAU),  E\u0301!!!"
    tokens = tokenize_classical(text)
    assert [token.normalized for token in tokens] == ["đau", "é"]
    assert [(token.start, token.end, text[token.start:token.end]) for token in tokens] == [
        (3, 6, "ĐAU"),
        (10, 12, "E\u0301"),
    ]


def test_classical_bio_merge_preserves_source_text_and_uses_null_scores():
    text = "tim đau đầu"
    tokens = tokenize_classical(text)
    entities = adapt_classical_entities(
        text,
        tokens,
        ["I-ORGAN", "B-DISEASESYMTOM", "I-DISEASESYMTOM"],
        "crf",
        7,
    )
    assert [(entity["text"], entity["label"], entity["start"], entity["end"]) for entity in entities] == [
        ("tim", "ORGAN", 0, 3),
        ("đau đầu", "DISEASESYMTOM", 4, 11),
    ]
    assert all(entity["score"] is None for entity in entities)


@pytest.mark.parametrize("model_id", ["logreg", "linear-svm", "crf"])
def test_classical_runtime_predicts_lowercase_tokens_but_returns_exact_source_offsets(model_id):
    class Predictor:
        def predict(self, words):
            assert words == ["bệnh", "nhân", "đau", "đầu"]
            return ["O", "O", "B-DISEASESYMTOM", "I-DISEASESYMTOM"]

    runtime = ModelRuntime(Path("unused"), Path("unused"))
    runtime.model_statuses[model_id].update({
        "status": "ready",
        "token_limit": 4096,
        "identity": {"logical_id": model_id},
    })
    runtime.pipelines[model_id] = Predictor()
    result = runtime.recognize("BỆNH nhân đau ĐẦU,", model_id, "review", 3)
    assert result["status"] == "succeeded"
    assert result["entities"] == [{
        "id": f"{model_id}:3:0",
        "text": "đau ĐẦU",
        "label": "DISEASESYMTOM",
        "start": 10,
        "end": 17,
        "offset_unit": "unicode_codepoint",
        "score": None,
    }]


def test_classical_runtime_rejects_more_than_4096_tokens_without_truncation():
    class Predictor:
        def predict(self, words):
            raise AssertionError("over-limit input must not reach inference")

    runtime = ModelRuntime(Path("unused"), Path("unused"))
    runtime.model_statuses["crf"].update({
        "status": "ready",
        "token_limit": 4096,
        "identity": {"logical_id": "crf"},
    })
    runtime.pipelines["crf"] = Predictor()
    result = runtime.recognize("x " * 4097, "crf", "raw", 0)
    assert result["status"] == "failed"
    assert result["error"]["code"] == "NER_INPUT_TOO_LONG"
    assert result["entities"] == []
