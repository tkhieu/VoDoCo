import hashlib
import json
import os
import subprocess
import unicodedata
from collections import defaultdict, deque
from pathlib import Path

import torch
import torch.version
from huggingface_hub import hf_hub_download, snapshot_download
from pyarrow import parquet
from transformers import (
    AutoModelForSeq2SeqLM,
    AutoModelForTokenClassification,
    AutoTokenizer,
    pipeline,
)

from metrics import Entity, bio_entities, changes, corpus_wer, decoded_entities, normalize, score

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
ASSETS = Path(os.environ.get("VODOCO_ASSET_ROOT", REPO if (REPO / ".local").exists()
                             else REPO.parents[1]))
LOCAL = HERE / ".local"
CORRECTOR_REVISION = "a3d342348d39d87622aa58aabd07de38ade8c17b"
NER_DATA_REVISION = "e3d0393c733858402a7c04228f45d351d2ce6d8f"
ASR_COMMIT = "712dcfed7"
ASR_PATH = "do_an_may_hoc/ket_qua_goc/asr_test_phowhisper_medium.jsonl"


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def load_asr() -> dict[str, str]:
    target = LOCAL / "asr_test_phowhisper_medium.jsonl"
    if not target.exists():
        with target.open("wb") as output:
            subprocess.run(["git", "show", f"{ASR_COMMIT}:{ASR_PATH}"],
                           cwd=REPO, stdout=output, check=True)
    records = [json.loads(line) for line in target.read_text(encoding="utf-8").splitlines()]
    hypotheses = {row["utterance_id"]: row["hypothesis"] for row in records}
    if len(records) != 3437 or len(hypotheses) != len(records):
        raise ValueError("ASR snapshot coverage or ID uniqueness failed")
    return hypotheses


def load_gold(ids: set[str]) -> tuple[dict[str, str], dict[str, list[Entity]], dict]:
    ner_file = hf_hub_download("leduckhai/VietMed-NER", "data/test-00000-of-00001.parquet",
                               repo_type="dataset", revision=NER_DATA_REVISION,
                               local_dir=LOCAL / "gold")
    speech_file = ASSETS / "datasets/leduckhai/VietMed/data/test-00000-of-00001.parquet"
    speech = parquet.read_table(speech_file, columns=["text", "utterance_id"]).to_pylist()
    ner = parquet.read_table(ner_file, columns=["text", "words", "labels"]).to_pylist()
    gold_by_text = defaultdict(deque)
    for row in ner:
        gold_by_text[row["text"]].append(row)
    references, entities = {}, {}
    ambiguous = 0
    for row in speech:
        utterance_id = row["utterance_id"]
        if utterance_id not in ids:
            continue
        candidates = gold_by_text[row["text"]]
        if len(candidates) > 1:
            labels = {(tuple(candidate["words"]), tuple(candidate["labels"]))
                      for candidate in candidates}
            if len(labels) != 1:
                ambiguous += 1
                continue
        if not candidates:
            raise ValueError(f"No NER gold text for {utterance_id}")
        gold_row = candidates.popleft()
        references[utterance_id] = row["text"]
        entities[utterance_id] = bio_entities(gold_row["words"], gold_row["labels"])
    if len(references) + ambiguous != len(ids):
        raise ValueError("Speech/NER/ASR ID coverage mismatch")
    return references, entities, {"speech_rows": len(speech), "ner_rows": len(ner),
                                  "ambiguous_duplicate_ids_excluded": ambiguous,
                                  "ner_sha256": sha256(Path(ner_file)),
                                  "speech_sha256": sha256(speech_file)}


def correct(hypotheses: dict[str, str]) -> tuple[dict[str, str], dict]:
    cache = LOCAL / "corrected_greedy_2x.jsonl"
    corrected = {}
    cap_hit_ids = []
    max_input_tokens = 0
    if cache.exists():
        for line in cache.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            if row["utterance_id"] not in hypotheses:
                raise ValueError("Correction cache has an unknown ID")
            corrected[row["utterance_id"]] = row["corrected"]
            max_input_tokens = max(max_input_tokens, row["input_tokens"])
            if row["hit_cap"]:
                cap_hit_ids.append(row["utterance_id"])
    pending = [(uid, text) for uid, text in hypotheses.items() if uid not in corrected]
    if not pending:
        return corrected, {"max_input_tokens": max_input_tokens, "cap_hit_ids": cap_hit_ids,
                           "cap_hit_count": len(cap_hit_ids),
                           "decoding": "greedy, num_beams=1, fp16; max_new_tokens=min(512,max(64,2*batch_max_input_tokens))"}
    model_path = LOCAL / "corrector"
    if not (model_path / "model.safetensors").exists():
        snapshot_download("bmd1905/vietnamese-correction-v2", revision=CORRECTOR_REVISION,
                          local_dir=model_path,
                          allow_patterns=["config.json", "dict.txt", "model.safetensors",
                                          "sentencepiece.bpe.model", "special_tokens_map.json",
                                          "tokenizer_config.json"])
    tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True)
    model = AutoModelForSeq2SeqLM.from_pretrained(
        model_path, dtype=torch.float16, use_safetensors=True, local_files_only=True,
    ).to("cuda").eval()
    with cache.open("a", encoding="utf-8") as output:
        for start in range(0, len(pending), 8):
            batch = pending[start:start + 8]
            encoded = tokenizer([text for _, text in batch], padding=True,
                                truncation=False, return_tensors="pt").to("cuda")
            input_lengths = encoded["attention_mask"].sum(dim=1).tolist()
            batch_input_tokens = max(input_lengths)
            max_input_tokens = max(max_input_tokens, batch_input_tokens)
            if batch_input_tokens > 512:
                raise ValueError("Correction input exceeds the model-card 512-token limit")
            generation_cap = min(512, max(64, 2 * batch_input_tokens))
            with torch.inference_mode():
                generated = model.generate(**encoded, max_new_tokens=generation_cap, num_beams=1)
            decoded = tokenizer.batch_decode(generated, skip_special_tokens=True)
            for (uid, _), text, tokens, input_tokens in zip(
                batch, decoded, generated.tolist(), input_lengths, strict=True,
            ):
                output_tokens = sum(token != tokenizer.pad_token_id for token in tokens) - 1
                hit_cap = output_tokens >= generation_cap or tokenizer.eos_token_id not in tokens
                if hit_cap:
                    cap_hit_ids.append(uid)
                corrected[uid] = text.strip()
                output.write(json.dumps({"utterance_id": uid, "corrected": corrected[uid],
                                         "input_tokens": input_tokens, "output_tokens": output_tokens,
                                         "generation_cap": generation_cap, "hit_cap": hit_cap},
                                        ensure_ascii=False) + "\n")
            output.flush()
            if start % 160 == 0:
                print(f"corrected {len(corrected)}/{len(hypotheses)}", flush=True)
    del model
    torch.cuda.empty_cache()
    return corrected, {"max_input_tokens": max_input_tokens, "cap_hit_ids": cap_hit_ids,
                       "cap_hit_count": len(cap_hit_ids),
                       "decoding": "greedy, num_beams=1, fp16; max_new_tokens=min(512,max(64,2*batch_max_input_tokens))"}


def predict(texts: dict[str, str]) -> dict[str, list[Entity]]:
    model_path = ASSETS / ".local/vodoco-models/release/phobert"
    tokenizer = AutoTokenizer.from_pretrained(model_path, use_fast=False, local_files_only=True)
    model = AutoModelForTokenClassification.from_pretrained(
        model_path, dtype=torch.float32, use_safetensors=True, local_files_only=True,
    ).to("cuda").eval()
    recognizer = pipeline("token-classification", model=model, tokenizer=tokenizer,
                          aggregation_strategy="simple", device=0,
                          ignore_labels=["O", "0", "dum"])
    ids = list(texts)
    results = {}
    for start in range(0, len(ids), 16):
        batch_ids = ids[start:start + 16]
        batch = [texts[uid] for uid in batch_ids]
        lengths = [len(tokenizer(text, add_special_tokens=True)["input_ids"]) for text in batch]
        if max(lengths) > 256:
            raise ValueError(f"NER input exceeds demo 256-token limit: {batch_ids[lengths.index(max(lengths))]}")
        outputs = recognizer(batch, batch_size=16)
        for uid, items in zip(batch_ids, outputs, strict=True):
            results[uid] = decoded_entities(items)
        if start % 320 == 0:
            print(f"NER {len(results)}/{len(ids)}", flush=True)
    del recognizer, model
    torch.cuda.empty_cache()
    return results


def cached_predict(name: str, texts: dict[str, str]) -> dict[str, list[Entity]]:
    cache = LOCAL / f"ner_{name}.json"
    digest = hashlib.sha256(json.dumps(texts, ensure_ascii=False,
                                       sort_keys=True).encode("utf-8")).hexdigest()
    if cache.exists():
        saved = json.loads(cache.read_text(encoding="utf-8"))
        if saved["input_sha256"] == digest:
            return {uid: [Entity(**item) for item in items]
                    for uid, items in saved["predictions"].items()}
    result = predict(texts)
    cache.write_text(json.dumps({"input_sha256": digest,
                                 "predictions": {uid: [{"label": e.label, "surface": e.surface}
                                                       for e in items] for uid, items in result.items()}},
                                ensure_ascii=False), encoding="utf-8")
    return result


def main() -> None:
    LOCAL.mkdir(parents=True, exist_ok=True)
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable; CPU fallback is disabled")
    print(torch.__version__, torch.version.cuda, torch.cuda.get_device_name(0),
          (torch.ones(1, device="cuda") + 1).item(), flush=True)
    raw = load_asr()
    references, gold, alignment = load_gold(set(raw))
    raw = {uid: raw[uid] for uid in references}
    corrected, correction_generation = correct(raw)
    raw_cleaned = {uid: normalize(text) for uid, text in raw.items()}
    cleaned = {uid: normalize(text) for uid, text in corrected.items()}
    branches = {"raw": raw, "raw_normalized": raw_cleaned, "corrected": corrected,
                "corrected_normalized": cleaned, "gold_text": references}
    predictions = {name: cached_predict(name, texts) for name, texts in branches.items()}
    entity_changes = changes(gold, predictions["raw"], predictions["corrected"])
    for example in entity_changes["examples"]:
        uid = example["utterance_id"]
        example["gold_text"] = references[uid][:140]
        example["raw_text"] = raw[uid][:140]
        example["corrected_text"] = corrected[uid][:140]
    report = {
        "source": {"asr_commit": ASR_COMMIT, "asr_path": ASR_PATH,
                   "asr_sha256": sha256(LOCAL / "asr_test_phowhisper_medium.jsonl"),
                   "corrector_repo": "bmd1905/vietnamese-correction-v2",
                   "corrector_revision": CORRECTOR_REVISION,
                   "corrector_sha256": sha256(LOCAL / "corrector/model.safetensors"),
                   "ner_model_path": ".local/vodoco-models/release/phobert",
                   "ner_model_sha256": sha256(
                       ASSETS / ".local/vodoco-models/release/phobert/model.safetensors"),
                   "alignment": alignment, "scored_utterances": len(gold)},
        "wer": {"raw": corpus_wer(references, raw),
                "corrected": corpus_wer(references, corrected)},
        "correction_generation": correction_generation,
        "text_changes": {
            "changed_verbatim": sum(raw[uid] != corrected[uid] for uid in raw),
            "changed_after_scoring_normalization": sum(
                normalize(raw[uid]) != normalize(corrected[uid]) for uid in raw),
            "raw_lowercase_count": sum(text == text.lower() for text in raw.values()),
            "raw_terminal_period_count": sum(text.endswith(".") for text in raw.values()),
            "raw_internal_punctuation_count": sum(any(
                unicodedata.category(char).startswith("P") for char in text[:-1]
            ) for text in raw.values()),
        },
        "ner": {name: score(gold, result) for name, result in predictions.items()},
        "changes": entity_changes,
    }
    control = report["ner"]["raw_normalized"]
    treated = report["ner"]["corrected_normalized"]
    report["normalized_comparison"] = {
        "corrected_minus_raw_micro_f1": treated["micro"]["f1"] - control["micro"]["f1"],
        "corrected_minus_raw_true_positives": treated["micro"]["tp"] - control["micro"]["tp"],
        "corrected_minus_raw_per_type_f1": {
            label: treated["per_type"][label]["f1"] - control["per_type"][label]["f1"]
            for label in control["per_type"]
        },
        "corrected_minus_raw_per_type_true_positives": {
            label: treated["per_type"][label]["tp"] - control["per_type"][label]["tp"]
            for label in control["per_type"]
        },
    }
    result_path = HERE / "results.json"
    result_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")
    print(json.dumps({"wer": report["wer"],
                      "f1": {k: v["micro"]["f1"] for k, v in report["ner"].items()}},
                     indent=2), flush=True)


if __name__ == "__main__":
    main()
