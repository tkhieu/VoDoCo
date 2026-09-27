from preprocessing import encode_words, normalize_row, prepare_vi_ner


class Tokenizer:
    def encode(self, word, add_special_tokens=False):
        return [3, 4] if word == "hà" else [5]

    def build_inputs_with_special_tokens(self, ids):
        return [0] + ids + [2]


def test_punctuation_removal_repairs_bio_and_aligns_subtokens():
    row = normalize_row(["HÀ", ",", "Nội", "!", "đẹp"],
                        ["B-LOCATION", "B-PERSON", "I-PERSON", "O", "O"])
    assert row == {"words": ["hà", "nội", "đẹp"],
                   "tags": ["B-LOCATION", "B-PERSON", "O"]}
    encoded, word_ids = encode_words(row["words"], row["tags"], Tokenizer(),
                                     {"B-LOCATION": 1, "B-PERSON": 2, "O": 0})
    assert encoded["labels"] == [-100, 1, -100, 2, 0, -100]
    assert word_ids == [None, 0, 0, 1, 2, None]


def test_dedup_and_heldout_exclusion():
    def row(words):
        return {"tokens": words, "ner_tags": ["O"] * len(words)}
    splits = {"train": [row(["A", "."]), row(["a"]), row(["heldout"]),
                        row(["test"]), row(["unique"])],
              "validation": [row(["A"]), row(["A"]), row(["test"])],
              "test": [row(["test"])]}
    cleaned, log = prepare_vi_ner(splits, {"heldout"})
    assert [r["words"] for r in cleaned["train"]] == [["unique"]]
    assert [r["words"] for r in cleaned["validation"]] == [["a"]]
    assert log["train"]["duplicate"] == 2
    assert log["train"]["vietmed_heldout_overlap"] == 1
    assert log["train"]["vi_ner_test_overlap"] == 1
