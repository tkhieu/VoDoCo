from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

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


def test_256_includes_special_tokens_and_never_silently_truncates():
    runtime = ModelRuntime(Path("unused"), Path("unused"))
    runtime.model_statuses["phobert"]["status"] = "ready"
    runtime.tokenizers["phobert"] = WordTokenizer()
    runtime._torch = SimpleNamespace(inference_mode=nullcontext, cuda=SimpleNamespace(synchronize=lambda: None))
    # The entity at the end proves the accepted boundary reaches inference intact.
    runtime.pipelines["phobert"] = lambda text: [{
        "entity_group": "ORGAN", "word": text.split()[-1], "score": 0.9,
    }]
    exact = runtime.recognize("x " * 253 + "tim", "phobert", "review", 4)
    over = runtime.recognize("x " * 254 + "tim", "phobert", "review", 5)
    assert exact["status"] == "succeeded" and exact["entities"][0]["text"] == "tim"
    assert over["status"] == "failed"
    assert over["error"]["code"] == "NER_INPUT_TOO_LONG"
    assert over["entities"] == []
    assert over["revision"] == 5 and over["source"] == "review"
