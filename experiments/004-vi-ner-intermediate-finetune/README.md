# Vi-Ner intermediate fine-tuning for VietMed-NER

This experiment tests whether general-domain Vietnamese entity supervision helps a medical speech NER encoder. Each seed compares two paths: (1) VietMed-NER training from the pretrained encoder, and (2) Vi-Ner training with its four-type head, followed by a fresh VietMed 18-type head and VietMed training. No Vi-Ner rows enter the VietMed training set. The VietMed test split is used only for final metrics.

## Reproduce

On a CUDA 12.8 GPU with `uv` installed:

```bash
cd experiments/004-vi-ner-intermediate-finetune
uv sync --locked
uv run --locked pytest -q test_preprocessing.py
uv run --locked python train.py --encoder phobert --seeds 42 123 2024
```

The script accepts `--encoder vihealthbert` for `demdecuong/vihealthbert-base-syllable`. It resumes completed seeds from `results/<encoder>/`. Dataset downloads use the Hugging Face cache. Model checkpoints are written to the ignored `.local/` directory.

The scripts reuse the notebook's `leduckhai/VietMed-NER` dataset, 256-token limit, per-word subtoken encoding, first-subtoken labels, seqeval entity-level metrics, learning rate 3e-5, eight epochs, linear schedule, 10% warmup, epoch validation, and selection of best validation F1. PhoBERT uses weight decay 0.05; ViHealthBERT uses 0.01. The original effective batch size of 16 is implemented as batch size 4 with four accumulation steps to fit shared GPU memory; bf16 is enabled. Seeds are 42, 123, and 2024.

Vi-Ner words are lowercased. Punctuation-only tokens are removed, and an `I-` label stranded by removal is repaired to `B-`. Normalized sentence text is used for duplicate removal and to exclude exact matches with VietMed validation or test. Vi-Ner validation remains separate from Vi-Ner training; its test split is reserved and not used for either training or selection. Counts are in [`results/preprocessing.json`](results/preprocessing.json).

## Results

VietMed test entity-level scores below are percentages, mean ± sample standard deviation across seeds 42, 123, and 2024. The historical PhoBERT 60.90% and ViHealthBERT 61.28% test micro F1 are reference points only; the paired comparisons use new baseline runs. Full per-seed micro F1, macro F1, and precision, recall, F1, and support for all 18 types are in [`results/phobert/`](results/phobert/) and [`results/vihealthbert/`](results/vihealthbert/).

| Encoder | Path | Micro F1 | Macro F1 |
| --- | --- | ---: | ---: |
| PhoBERT | VietMed only | 60.93 ± 0.05 | 52.47 ± 0.34 |
| PhoBERT | Vi-Ner then VietMed | 61.29 ± 0.19 | 52.59 ± 0.33 |
| ViHealthBERT | VietMed only | 61.16 ± 0.32 | 51.35 ± 0.50 |
| ViHealthBERT | Vi-Ner then VietMed | 60.84 ± 0.48 | 51.78 ± 0.26 |

Focused type results, also percentages and mean ± sample standard deviation:

| Encoder | Path | Type | Precision | Recall | F1 |
| --- | --- | --- | ---: | ---: | ---: |
| PhoBERT | VietMed only | ORGANIZATION | 1.04 ± 1.80 | 0.55 ± 0.95 | 0.72 ± 1.24 |
| PhoBERT | Vi-Ner then VietMed | ORGANIZATION | 2.67 ± 2.98 | 2.19 ± 2.50 | 2.40 ± 2.72 |
| PhoBERT | VietMed only | LOCATION | 58.44 ± 0.73 | 86.32 ± 0.53 | 69.70 ± 0.53 |
| PhoBERT | Vi-Ner then VietMed | LOCATION | 61.72 ± 1.88 | 85.41 ± 1.90 | 71.66 ± 1.93 |
| PhoBERT | VietMed only | DATETIME | 71.28 ± 0.26 | 76.16 ± 0.45 | 73.64 ± 0.30 |
| PhoBERT | Vi-Ner then VietMed | DATETIME | 71.89 ± 0.50 | 77.06 ± 0.26 | 74.39 ± 0.39 |
| ViHealthBERT | VietMed only | ORGANIZATION | 1.04 ± 1.80 | 0.55 ± 0.95 | 0.72 ± 1.24 |
| ViHealthBERT | Vi-Ner then VietMed | ORGANIZATION | 5.64 ± 5.75 | 4.92 ± 5.68 | 5.23 ± 5.74 |
| ViHealthBERT | VietMed only | LOCATION | 56.24 ± 0.56 | 82.17 ± 0.46 | 66.78 ± 0.50 |
| ViHealthBERT | Vi-Ner then VietMed | LOCATION | 61.59 ± 2.09 | 83.69 ± 0.93 | 70.95 ± 1.59 |
| ViHealthBERT | VietMed only | DATETIME | 73.02 ± 1.33 | 75.61 ± 1.36 | 74.28 ± 0.05 |
| ViHealthBERT | Vi-Ner then VietMed | DATETIME | 73.08 ± 1.33 | 76.46 ± 0.40 | 74.73 ± 0.75 |

PhoBERT gains 0.37 percentage points in micro F1 and 0.12 points in macro F1. LOCATION and DATETIME F1 gain 1.96 and 0.75 points. ViHealthBERT loses 0.31 points in micro F1 while gaining 0.43 points in macro F1; LOCATION and DATETIME gain 4.17 and 0.45 points. ORGANIZATION improves for both encoders but remains poor in absolute terms. The inconsistent micro result means Vi-Ner is useful for selected shared types, but not a reliable overall improvement across encoders.

The twelve GPU jobs took **7,686.95 seconds (128.12 minutes)** in summed wall time, including tokenization and evaluation. Peak allocated GPU memory was **2.644 GiB**. PhoBERT took 3,915.71 seconds; ViHealthBERT took 3,771.24 seconds. These are run wall times from the scripts, not profiler measurements of GPU utilization.

**Demo recommendation:** do not promote a new checkpoint. The PhoBERT overall gain is small, ViHealthBERT's overall result is negative, and Vi-Ner's provenance and license are unstated. The checkpoint files remain in the ignored `.local/` directory for further internal evaluation.

## Limits

Vi-Ner has no stated provenance or license, so redistribution and deployment rights require investigation. It consists of written, punctuated general-domain text, whereas VietMed is lowercase, unpunctuated medical speech. Normalization reduces some surface differences but cannot remove domain mismatch. ORGANIZATION and TRANSPORTATION have only 19 and five VietMed training examples, respectively; their per-type estimates are unstable. VietMed test has 61 ORGANIZATION and 27 TRANSPORTATION entities. Three seeds give a useful first estimate, but not a confidence interval or proof of transfer. Test results were not used for checkpoint selection.

## Tóm tắt tiếng Việt

Thí nghiệm so sánh mô hình chỉ học VietMed-NER với mô hình học Vi-Ner trước, thay đầu phân loại rồi học VietMed-NER. Mỗi nhánh dùng ba hạt giống và cùng siêu tham số. PhoBERT tăng micro F1 từ 60,93% lên 61,29%, chủ yếu có lợi cho LOCATION và DATETIME. ViHealthBERT giảm micro F1 từ 61,16% xuống 60,84% dù LOCATION và DATETIME cải thiện. ORGANIZATION vẫn rất kém và không đáng tin cậy vì dữ liệu huấn luyện hiếm. **Chưa nên thay checkpoint của bản demo**: lợi ích tổng thể nhỏ hoặc không ổn định, và Vi-Ner chưa rõ nguồn gốc hay giấy phép.
