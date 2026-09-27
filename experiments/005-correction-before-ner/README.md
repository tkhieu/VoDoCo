# Correction before medical NER

This experiment tests the pinned [bmd1905/vietnamese-correction-v2](https://huggingface.co/bmd1905/vietnamese-correction-v2) checkpoint before the demo PhoBERT NER checkpoint. It changes no demo code. The corrector is Apache-2.0 and has about 396 million parameters. The complete machine-readable results, including all 18 entity types and paired examples, are in [`results.json`](results.json).

## Data and scoring

The full 3,437-utterance PhoWhisper-medium ASR snapshot from commit `712dcfed7` was used. Only 500 whisper-small test transcripts were available; regenerating the other 2,937 audio predictions was outside this run. Therefore these numbers do **not** estimate the exact demo whisper-small pipeline. Transfer is especially uncertain here: the corrector and the normalization branch mostly affect casing and punctuation, while all 3,437 PhoWhisper hypotheses are already lowercase, 3,436 end in a single period, and only one contains inner punctuation. Whisper-small may have a different casing and punctuation pattern. VietMed-NER test has 3,497 rows. All 3,437 speech test transcript texts matched the NER gold file, with no ambiguous duplicates; the extra 60 NER rows were excluded. The input and gold SHA-256 digests are in the result JSON.

Each branch runs the released PhoBERT checkpoint independently on its own text. The ASR branches are raw, raw then normalized, corrected, and corrected then normalized; normalization lowercases and strips punctuation. Gold text through the same NER checkpoint is context. Gold BIO spans are rebuilt from each gold row. Predictions are compared to gold by **per-utterance multisets of (entity type, NFC casefolded punctuation-stripped surface)**; no ASR BIO offsets are reused. WER uses the same normalization for every branch, so casing and punctuation alone cannot improve WER. The dataset's `"0"` outside label is treated as `O`; `"0"`, `O`, and `_` are excluded from predicted entity multisets. Correction uses greedy fp16 decoding (`num_beams=1`) with a per-batch output cap of `min(512, max(64, 2 × longest input tokens))`; the longest input was 256 tokens and no output hit its cap.

## Results

| Text sent to PhoBERT | Entity precision | Entity recall | Entity micro F1 | WER |
| --- | ---: | ---: | ---: | ---: |
| Raw ASR | 46.77% | 54.72% | **50.43%** | 23.850% |
| Raw ASR, lowercase, punctuation stripped | 47.56% | 56.82% | **51.78%** | 23.850% |
| Corrected ASR | 46.80% | 54.71% | **50.45%** | 23.895% |
| Corrected, lowercase, punctuation stripped | 47.62% | 56.85% | **51.83%** | 23.895% |
| Gold transcript | 56.76% | 69.42% | **62.45%** | reference |

Correction after normalization adds only **0.054 F1 percentage points and 3 true-positive entities** over raw normalization. Raw normalization alone adds 1.346 F1 points over raw ASR. This identifies the earlier apparent gain as overwhelmingly a normalization effect, largely consistent with removing the trailing period. All per-type F1 values and exact corrected-minus-raw-normalized deltas are in `results.json`:

| Entity type | Raw normalized F1 | Corrected normalized F1 | Delta |
| --- | ---: | ---: | ---: |
| AGE | 62.26% | 62.26% | +0.00 pp |
| DATETIME | 63.80% | 63.75% | -0.05 pp |
| DIAGNOSTICS | 59.42% | 59.81% | +0.38 pp |
| DISEASESYMTOM | 48.63% | 48.54% | -0.09 pp |
| DRUGCHEMICAL | 51.58% | 51.98% | +0.40 pp |
| FOODDRINK | 60.04% | 60.82% | +0.78 pp |
| GENDER | 68.45% | 68.45% | +0.00 pp |
| LOCATION | 64.51% | 64.42% | -0.08 pp |
| MEDDEVICETECHNIQUE | 15.14% | 15.15% | +0.01 pp |
| OCCUPATION | 83.48% | 83.48% | +0.00 pp |
| ORGAN | 49.91% | 49.95% | +0.04 pp |
| ORGANIZATION | 0.00% | 0.00% | +0.00 pp |
| PERSONALCARE | 32.08% | 32.02% | -0.07 pp |
| PREVENTIVEMED | 0.97% | 0.98% | +0.00 pp |
| SURGERY | 38.26% | 38.26% | +0.00 pp |
| TRANSPORTATION | 0.00% | 0.00% | +0.00 pp |
| TREATMENT | 63.35% | 63.35% | +0.00 pp |
| UNITCALIBRATOR | 27.86% | 27.86% | +0.00 pp |

The corrector changed 476 transcripts verbatim, but only 176 after scoring normalization. Against gold entities, it recovered 6 matches and broke 7. For `DRUGCHEMICAL`, it recovered one `sữa mẹ` mention and broke none; for `DISEASESYMTOM`, it recovered none and broke one `viêm gan` mention. In `utt_id_test_002052`, correction changed `viêm gan siêu vi bê` into `viêm gan siêu vi B`, yet PhoBERT lost a matching `viêm gan` entity. This shows why text correction and NER must be measured together. Per-type counts and short raw/corrected/gold snippets are in `results.json`.

The earlier zero-shot correction experiment (`001`) raised WER on its 100-sample evaluation from 22.068% to 22.247%. The [experiment 002 notebook](../002-vietmed-correction-training/train_correction_end_to_end.ipynb) reports dev-tune WER rising from 4.436% (R0) to 5.362% (R3 seed 42), with **552 of 2,769** dev-tune utterances worsened; its official-test WER improved from 28.349% to 27.983% for that seed. The previous claim of 617 of 3,437 miscorrected transcripts is not supported by that tracked source and has been removed. These runs use different correctors and ASR inputs, so their WER values are not directly comparable. Here, normalized WER worsened by 0.045 percentage points, and direct correction changed entity F1 by only +0.014 points.

**Recommendation:** do not add this corrector to the demo now. Lowercasing and stripping punctuation is a cheap potential improvement to test on full whisper-small transcripts, but this result alone does not authorize changing the demo. A correction toggle belongs in a later PR only if correction adds a clear paired entity F1 win over that normalization control without material drug/disease regressions; retain the raw ASR transcript.

## Reproduce

On a CUDA-capable machine with Torch cu128 and the demo PhoBERT release at `.local/vodoco-models/release/phobert`:

```bash
cd experiments/005-correction-before-ner
uv sync
uv run python run.py
uv run pytest -q test_metrics.py
uvx ruff check metrics.py run.py test_metrics.py
```

The runner downloads pinned corrector and VietMed-NER files, extracts the ASR JSONL from commit `712dcfed7`, and records source hashes. All downloaded model files and intermediate predictions stay in the gitignored `.local/` directory. `VODOCO_ASSET_ROOT` can point to the checkout containing the local release and speech parquet.
