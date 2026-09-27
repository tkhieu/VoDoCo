import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Entity:
    label: str
    surface: str


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text).casefold()
    return " ".join("".join(" " if unicodedata.category(c).startswith("P") else c
                            for c in text).split())


def bio_entities(words: list[str], labels: list[str]) -> list[Entity]:
    if len(words) != len(labels):
        raise ValueError("Gold word and label lengths differ")
    entities: list[Entity] = []
    active_label = ""
    active_words: list[str] = []
    for word, tag in zip(words, labels, strict=True):
        tag = "O" if tag == "0" else tag
        prefix, _, label = tag.partition("-")
        if tag == "O" or prefix == "B" or label != active_label:
            if active_words:
                entities.append(Entity(active_label, " ".join(active_words)))
            active_label, active_words = "", []
        if tag != "O":
            if prefix not in {"B", "I"} or not label:
                raise ValueError(f"Invalid BIO label: {tag}")
            active_label = label
            active_words.append(word)
    if active_words:
        entities.append(Entity(active_label, " ".join(active_words)))
    return entities


def entity_counter(entities: list[Entity]) -> Counter[tuple[str, str]]:
    return Counter((item.label, normalize(item.surface)) for item in entities
                   if item.label not in {"0", "O", "_"})


def decoded_entities(items: list[dict]) -> list[Entity]:
    entities = []
    for item in items:
        label = item["entity_group"].removeprefix("B-").removeprefix("I-")
        label = "O" if label == "0" else label
        if label not in {"O", "_"}:
            entities.append(Entity(label, item["word"]))
    return entities


def score(gold: dict[str, list[Entity]], predictions: dict[str, list[Entity]]) -> dict:
    if gold.keys() != predictions.keys():
        raise ValueError("Prediction IDs do not match gold IDs")
    counts = defaultdict(lambda: Counter({"tp": 0, "predicted": 0, "gold": 0}))
    for utterance_id, truth in gold.items():
        reference = entity_counter(truth)
        predicted = entity_counter(predictions[utterance_id])
        for (label, _), amount in reference.items():
            counts[label]["gold"] += amount
        for (label, _), amount in predicted.items():
            counts[label]["predicted"] += amount
        for (label, _), amount in (reference & predicted).items():
            counts[label]["tp"] += amount

    def row(items: Counter) -> dict:
        tp, pred, ref = items["tp"], items["predicted"], items["gold"]
        return {"tp": tp, "predicted": pred, "gold": ref,
                "precision": tp / pred if pred else 0.0,
                "recall": tp / ref if ref else 0.0,
                "f1": 2 * tp / (pred + ref) if pred + ref else 0.0}

    total = Counter()
    for items in counts.values():
        total.update(items)
    return {"micro": row(total), "per_type": {k: row(v) for k, v in sorted(counts.items())}}


def changes(gold: dict[str, list[Entity]], raw: dict[str, list[Entity]],
            corrected: dict[str, list[Entity]], limit: int = 12) -> dict:
    totals = defaultdict(lambda: Counter({"recovered": 0, "broken": 0}))
    examples: list[dict] = []
    for utterance_id, truth_entities in gold.items():
        truth = entity_counter(truth_entities)
        old = truth & entity_counter(raw[utterance_id])
        new = truth & entity_counter(corrected[utterance_id])
        for kind, delta in (("recovered", new - old), ("broken", old - new)):
            for (label, surface), amount in delta.items():
                totals[label][kind] += amount
                if len(examples) < limit or label in {"DRUGCHEMICAL", "DISEASESYMTOM"}:
                    examples.append({"utterance_id": utterance_id, "kind": kind,
                                     "label": label, "surface": surface, "count": amount})
    medical = [e for e in examples if e["label"] in {"DRUGCHEMICAL", "DISEASESYMTOM"}]
    return {"by_type": {k: dict(v) for k, v in sorted(totals.items())},
            "examples": (medical[:limit] + [e for e in examples if e not in medical])[:limit]}


def word_errors(reference: str, hypothesis: str) -> tuple[int, int]:
    source, target = normalize(reference).split(), normalize(hypothesis).split()
    previous = list(range(len(target) + 1))
    for index, word in enumerate(source, 1):
        current = [index]
        for offset, candidate in enumerate(target, 1):
            current.append(min(current[-1] + 1, previous[offset] + 1,
                               previous[offset - 1] + (word != candidate)))
        previous = current
    return previous[-1], len(source)


def corpus_wer(references: dict[str, str], hypotheses: dict[str, str]) -> dict:
    if references.keys() != hypotheses.keys():
        raise ValueError("WER IDs do not match")
    errors, words = 0, 0
    for utterance_id, reference in references.items():
        delta, length = word_errors(reference, hypotheses[utterance_id])
        errors += delta
        words += length
    return {"errors": errors, "reference_words": words, "wer": errors / words}
