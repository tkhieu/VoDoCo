# Correction before medical NER

This experiment tests the pinned [bmd1905/vietnamese-correction-v2](https://huggingface.co/bmd1905/vietnamese-correction-v2) checkpoint before the demo PhoBERT NER checkpoint. It changes no demo code. The corrector is Apache-2.0 and has about 396 million parameters. The complete machine-readable results, including all 18 entity types and paired examples, are in [`results.json`](results.json).

## Data and scoring

The full 3,437-utterance PhoWhisper-medium ASR snapshot from commit `712dcfed7` was used. Only 500 whisper-small test transcripts were available; regenerating the other 2,937 audio predictions was outside this run. Therefore these numbers do **not** estimate the exact demo whisper-small pipeline. VietMed-NER test has 3,497 rows. All 3,437 speech test transcript texts matched the NER gold file, with no ambiguous duplicates; the extra 60 NER rows were excluded. The input and gold SHA-256 digests are in the result JSON.

Each branch runs the released PhoBERT checkpoint independently on its own text. The three ASR branches are raw, corrected, and corrected then lowercased with punctuation stripped. Gold text through the same NER checkpoint is context. Gold BIO spans are rebuilt from each gold row. Predictions are compared to gold by **per-utterance multisets of (entity type, NFC casefolded punctuation-stripped surface)**; no ASR BIO offsets are reused. Both raw and corrected WER use the same normalization, so casing and punctuation alone cannot improve WER. The dataset's `"0"` outside label is treated as `O`; `"0"`, `O`, and `_` are excluded from predicted entity multisets.

## Results

| Text sent to PhoBERT | Entity precision | Entity recall | Entity micro F1 | WER |
| --- | ---: | ---: | ---: | ---: |
| Raw ASR | 46.77% | 54.72% | **50.43%** | 23.850% |
| Corrected ASR | 46.80% | 54.71% | **50.45%** | 23.895% |
| Corrected, lowercase, punctuation stripped | 47.62% | 56.85% | **51.83%** | 23.895%* |
| Gold transcript | 56.76% | 69.42% | **62.45%** | reference |

*The third branch has the same WER as corrected ASR because WER normalization already lowercases and strips punctuation. Its NER F1 gain cannot be assigned to correction without a raw-ASR normalization control.

The corrector changed 476 transcripts verbatim, but only 176 after scoring normalization. Against gold entities, it recovered 6 matches and broke 7. For `DRUGCHEMICAL`, it recovered one `sữa mẹ` mention and broke none; for `DISEASESYMTOM`, it recovered none and broke one `viêm gan` mention. In `utt_id_test_002052`, correction changed `viêm gan siêu vi bê` into `viêm gan siêu vi B`, yet PhoBERT lost a matching `viêm gan` entity. This shows why text correction and NER must be measured together. Per-type counts and short raw/corrected/gold snippets are in `results.json`.

The earlier zero-shot correction experiment (`001`) raised WER on its 100-sample evaluation from 22.068% to 22.247%. The LLM/LoRA correction work (`002`) was abandoned after dev WER worsened and 617 of 3,437 transcripts were miscorrected. This independent checkpoint repeats the main warning: normalized WER worsened by 0.045 percentage points, and direct correction changed entity F1 by only +0.014 points. The 1.39-point F1 increase in the normalized branch is potentially useful, but normalization is a confounder.

**Recommendation:** do not add this corrector to the demo now. First compare raw-ASR normalization alone on full whisper-small test transcripts, then require a clear paired entity F1 win without material drug/disease regressions. If it wins, add it as an opt-in demo toggle in a later PR and retain the raw ASR transcript.

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
