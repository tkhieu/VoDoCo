# Vi-Ner intermediate fine-tuning for VietMed-NER

This experiment tests whether general-domain Vietnamese entity supervision helps a medical speech NER encoder. Each seed compares two paths: (1) VietMed-NER training from the pretrained encoder, and (2) Vi-Ner training with its four-type head, followed by a fresh VietMed 18-type head and VietMed training. No Vi-Ner rows enter the VietMed training set. The VietMed test split is used only for final metrics.

## Reproduce

On a CUDA 12.8 GPU with `uv` installed:

```bash
cd experiments/004-vi-ner-intermediate-finetune
uv sync --locked
uv run --locked pytest -q test_preprocessing.py
uv run --locked python train.py --encoder phobert --seeds 42 123 2024 --force
uv run --locked python train.py --encoder vihealthbert --seeds 42 123 2024 --force
```

The ViHealthBERT model is `demdecuong/vihealthbert-base-syllable`. Without `--force`, the script resumes completed seeds from `results/<encoder>/`; `--force` reruns and replaces all selected seed results. Dataset downloads use the Hugging Face cache. Model checkpoints are written to the ignored `.local/` directory. Check that the GPU is free before starting either command.

The scripts reuse the notebook's `leduckhai/VietMed-NER` dataset, 256-token limit, per-word subtoken encoding, first-subtoken labels, seqeval entity-level metrics, learning rate 3e-5, eight epochs, linear schedule, 10% warmup, epoch validation, and selection of best validation F1. PhoBERT uses weight decay 0.05; ViHealthBERT uses 0.01. The original effective batch size of 16 is implemented as batch size 4 with four accumulation steps to fit shared GPU memory; bf16 is enabled. Seeds are 42, 123, and 2024.

Vi-Ner words are lowercased and leading/trailing punctuation is stripped; punctuation-only tokens are removed. An `I-` label stranded by removal is repaired to `B-`. Normalized sentence text is used for duplicate removal and to exclude exact matches with VietMed validation or test. VietMed's outside tag `"0"` is mapped to `"O"` before building the label vocabulary, training, checkpoint selection, and scoring. Vi-Ner validation remains separate from Vi-Ner training; its test split is reserved and not used for either training or selection. Counts are in [`results/preprocessing.json`](results/preprocessing.json).

## Results

VietMed test entity-level scores below are percentages, mean ± sample standard deviation across seeds 42, 123, and 2024. The historical PhoBERT 60.90% and ViHealthBERT 61.28% test micro F1 were computed with the `"0"` outside-tag scoring bug, so a match to them is not a correctness check. The paired comparisons use new baseline runs. Full per-seed micro F1, macro F1, and precision, recall, F1, and support for all 18 types are in [`results/phobert/`](results/phobert/) and [`results/vihealthbert/`](results/vihealthbert/).

| Encoder | Metric | VietMed only | Vi-Ner then VietMed | Paired Δ seed 42 | Paired Δ seed 123 | Paired Δ seed 2024 | Paired Δ mean ± std |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| PhoBERT | Micro F1 | 62.98 ± 0.33 | 62.92 ± 0.55 | −0.06 | +0.43 | −0.54 | −0.06 ± 0.48 |
| PhoBERT | Macro F1 | 52.50 ± 0.38 | 52.51 ± 0.52 | +0.21 | +0.47 | −0.66 | +0.01 ± 0.59 |
| ViHealthBERT | Micro F1 | 62.88 ± 0.12 | 62.33 ± 0.30 | −0.43 | −0.20 | −1.01 | −0.55 ± 0.41 |
| ViHealthBERT | Macro F1 | 51.35 ± 0.50 | 51.70 ± 0.10 | +0.18 | +0.88 | +0.00 | +0.35 ± 0.46 |

The paired deltas are percentage-point differences (intermediate minus baseline) for the same seed. The mean and standard deviation of paired deltas are computed from those three differences.

Focused type results, also percentages and mean ± sample standard deviation:

| Encoder | Path | Type | Precision | Recall | F1 |
| --- | --- | --- | ---: | ---: | ---: |
| PhoBERT | VietMed only | ORGANIZATION | 1.04 ± 1.80 | 0.55 ± 0.95 | 0.72 ± 1.24 |
| PhoBERT | Vi-Ner then VietMed | ORGANIZATION | 0.00 ± 0.00 | 0.00 ± 0.00 | 0.00 ± 0.00 |
| PhoBERT | VietMed only | LOCATION | 58.32 ± 0.92 | 86.02 ± 0.91 | 69.51 ± 0.85 |
| PhoBERT | Vi-Ner then VietMed | LOCATION | 66.13 ± 1.10 | 86.42 ± 0.70 | 74.93 ± 0.92 |
| PhoBERT | VietMed only | DATETIME | 71.44 ± 0.37 | 75.86 ± 0.26 | 73.58 ± 0.26 |
| PhoBERT | Vi-Ner then VietMed | DATETIME | 65.70 ± 2.52 | 76.71 ± 0.77 | 70.76 ± 1.42 |
| ViHealthBERT | VietMed only | ORGANIZATION | 1.04 ± 1.80 | 0.55 ± 0.95 | 0.72 ± 1.24 |
| ViHealthBERT | Vi-Ner then VietMed | ORGANIZATION | 3.47 ± 0.99 | 2.73 ± 0.95 | 3.05 ± 0.98 |
| ViHealthBERT | VietMed only | LOCATION | 56.24 ± 0.56 | 82.17 ± 0.46 | 66.78 ± 0.50 |
| ViHealthBERT | Vi-Ner then VietMed | LOCATION | 63.57 ± 1.87 | 83.89 ± 0.61 | 72.33 ± 1.43 |
| ViHealthBERT | VietMed only | DATETIME | 73.02 ± 1.33 | 75.61 ± 1.36 | 74.28 ± 0.05 |
| ViHealthBERT | Vi-Ner then VietMed | DATETIME | 66.51 ± 0.36 | 75.41 ± 0.00 | 70.68 ± 0.20 |

Intermediate training does not improve overall micro F1: PhoBERT changes by −0.06 points on average with mixed seed deltas, and ViHealthBERT loses 0.55 points. LOCATION F1 rises by 5.42 points for PhoBERT and 5.55 for ViHealthBERT, while DATETIME falls by 2.82 and 3.60 points. Transfer therefore helps LOCATION in these runs but harms DATETIME. ORGANIZATION differences are within noise: per-seed F1 is 0.00–3.64% in the corrected reruns, and the reviewer's rescoring of the original checkpoints ranged from 0–11%. There are only 61 test entities and 19 VietMed training examples. The observed differences do not support a reliable ORGANIZATION gain.

The twelve corrected GPU jobs took **7,012.21 seconds (116.87 minutes)** in summed wall time, including tokenization and evaluation. Peak allocated GPU memory was **2.644 GiB**. PhoBERT took 3,548.83 seconds; ViHealthBERT took 3,463.38 seconds. These are run wall times from the scripts, not profiler measurements of GPU utilization.

**Demo recommendation:** do not promote a new checkpoint. The corrected runs show no overall micro F1 gain, DATETIME regresses, and Vi-Ner's provenance and license are unstated. The checkpoint files remain in the ignored `.local/` directory for further internal evaluation.

## Limits

Vi-Ner has no stated provenance or license, so redistribution and deployment rights require investigation. It consists of written, punctuated general-domain text, whereas VietMed is lowercase, unpunctuated medical speech. Normalization reduces some surface differences but cannot remove domain mismatch. ORGANIZATION and TRANSPORTATION have only 19 and five VietMed training examples, respectively; their per-type estimates are unstable. VietMed test has 61 ORGANIZATION and 27 TRANSPORTATION entities. Three seeds give a useful first estimate, but not a confidence interval or proof of transfer. Test results were not used for checkpoint selection.

## Tóm tắt tiếng Việt

Thí nghiệm so sánh mô hình chỉ học VietMed-NER với mô hình học Vi-Ner trước, thay đầu phân loại rồi học VietMed-NER. Nhãn ngoài `"0"` của VietMed đã được đổi thành `"O"` trước khi huấn luyện và tính điểm; các số 60,90% và 61,28% từ notebook cũ mắc lỗi tính điểm này. Mỗi nhánh dùng ba hạt giống và cùng siêu tham số. PhoBERT đạt micro F1 62,98% so với 62,92% sau Vi-Ner; ViHealthBERT đạt 62,88% so với 62,33%. LOCATION cải thiện nhưng DATETIME giảm ở cả hai encoder. Khác biệt ORGANIZATION không đáng tin cậy vì chỉ có 19 ví dụ huấn luyện. **Chưa nên thay checkpoint của bản demo**: micro F1 không tăng, DATETIME giảm, và Vi-Ner chưa rõ nguồn gốc hay giấy phép.
