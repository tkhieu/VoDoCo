import unicodedata

import pytest

from metrics import Entity, bio_entities, changes, corpus_wer, decoded_entities, normalize, score


def test_bio_entities_uses_each_rows_own_tokenization() -> None:
    words = ["uống", "thuốc", "A", "vì", "cảm", "cúm"]
    labels = ["0", "B-DRUGCHEMICAL", "I-DRUGCHEMICAL", "0",
              "B-DISEASESYMTOM", "I-DISEASESYMTOM"]

    entities = bio_entities(words, labels)

    assert entities == [Entity("DRUGCHEMICAL", "thuốc A"),
                        Entity("DISEASESYMTOM", "cảm cúm")]


def test_score_counts_repeated_entities_per_utterance() -> None:
    gold = {"one": [Entity("DRUGCHEMICAL", "Thuốc A"),
                    Entity("DRUGCHEMICAL", "thuốc a")],
            "two": [Entity("DISEASESYMTOM", "Cảm cúm")]}
    predictions = {"one": [Entity("DRUGCHEMICAL", "thuốc a")],
                   "two": [Entity("DISEASESYMTOM", "cảm cúm!")]}

    result = score(gold, predictions)

    assert result["micro"]["tp"] == 2
    assert result["micro"]["gold"] == 3
    assert result["micro"]["f1"] == pytest.approx(0.8)
    assert result["per_type"]["DRUGCHEMICAL"]["recall"] == 0.5


def test_changes_counts_recovered_and_broken_gold_matches() -> None:
    gold = {"one": [Entity("DRUGCHEMICAL", "thuốc a"),
                    Entity("DISEASESYMTOM", "cảm cúm")]}
    raw = {"one": [Entity("DRUGCHEMICAL", "thuốc a")]}
    corrected = {"one": [Entity("DISEASESYMTOM", "cảm cúm")]}

    result = changes(gold, raw, corrected)

    assert result["by_type"]["DRUGCHEMICAL"]["broken"] == 1
    assert result["by_type"]["DISEASESYMTOM"]["recovered"] == 1


def test_wer_uses_same_normalization_for_both_branches() -> None:
    references = {"one": "Thuốc A, cảm cúm."}

    result = corpus_wer(references, {"one": "thuốc a cảm"})

    assert result == {"errors": 1, "reference_words": 4, "wer": 0.25}
    assert normalize("THUỐC A, cảm cúm.") == "thuốc a cảm cúm"


def test_zero_outside_tags_never_become_pseudo_entities() -> None:
    gold = {"one": bio_entities(["không", "bệnh"], ["0", "B-DISEASESYMTOM"])}
    predicted = {"one": decoded_entities([
        {"entity_group": "0", "word": "không"},
        {"entity_group": "_", "word": "không"},
        {"entity_group": "DISEASESYMTOM", "word": "bệnh"},
    ])}

    result = score(gold, predicted)

    assert set(result["per_type"]) == {"DISEASESYMTOM"}
    assert result["micro"]["tp"] == 1


@pytest.mark.parametrize("labels", [
    ["O", "I-DISEASESYMTOM"],
    ["B-DRUGCHEMICAL", "I-DISEASESYMTOM"],
])
def test_i_tag_after_outside_or_another_type_starts_new_entity(labels: list[str]) -> None:
    entities = bio_entities(["thuốc", "bệnh"], labels)

    assert entities[-1] == Entity("DISEASESYMTOM", "bệnh")


def test_score_matches_nfc_and_nfd_surfaces() -> None:
    gold = {"one": [Entity("DRUGCHEMICAL", "thuốc")]}
    decomposed = unicodedata.normalize("NFD", "thuốc")

    result = score(gold, {"one": [Entity("DRUGCHEMICAL", decomposed)]})

    assert result["micro"]["tp"] == 1


def test_score_rejects_utterance_id_mismatch() -> None:
    gold = {"one": [Entity("DISEASESYMTOM", "bệnh")]}

    with pytest.raises(ValueError, match="Prediction IDs"):
        score(gold, {"two": [Entity("DISEASESYMTOM", "bệnh")]})


def test_duplicate_matching_is_case_insensitive() -> None:
    gold = {"one": [Entity("DRUGCHEMICAL", "Thuốc A"),
                    Entity("DRUGCHEMICAL", "THUỐC A")]}
    predicted = {"one": [Entity("DRUGCHEMICAL", "thuốc a")]}

    result = score(gold, predicted)

    assert result["micro"]["tp"] == 1
    assert result["micro"]["predicted"] == 1
    assert result["micro"]["gold"] == 2
