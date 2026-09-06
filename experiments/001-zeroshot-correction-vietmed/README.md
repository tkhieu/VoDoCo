# Thí nghiệm 001 — Zero-shot correction trên VietMed

Kiểm chứng giả thuyết mở đầu của đề tài *Post-ASR Error Correction cho lời nói y tế tiếng Việt*:

> `bmd1905/vietnamese-correction-v2` được huấn luyện trên **lỗi gõ phím** ở miền **báo chí**.
> Nó có sửa được **lỗi ASR** ở miền **y tế** không?

## Pipeline

```
VietMed test ──┬── audio ──> PhoWhisper ──> hypothesis ──┬──> corrector ──> WER sau
               │                                          │
               └── transcript gốc ───────────────────────┴──> corrector ──> đo over-correction
```

Nhánh thứ hai (cho corrector ăn transcript vốn đã đúng) là phép thử quan trọng:
một corrector vô hại phải trả về gần như nguyên văn. Mọi thay đổi ở đó là thiệt hại thuần.

## Chạy

```bash
source .venv/bin/activate
python scripts/download-vietmed-test-sample.py --num-samples 100 --seed 42
python scripts/run-asr-generate-hypotheses.py
python scripts/run-zeroshot-correction.py
python scripts/evaluate-wer-cer-and-overcorrection.py
```

## Scripts

| File | Vai trò |
|---|---|
| `download-vietmed-test-sample.py` | Tải `leduckhai/VietMed`, trích N mẫu test, xuất wav 16kHz + metadata |
| `run-asr-generate-hypotheses.py` | Sinh hypothesis ASR (mặc định `vinai/PhoWhisper-medium`) |
| `run-zeroshot-correction.py` | Chạy corrector trên cả hypothesis lẫn transcript gốc |
| `evaluate-wer-cer-and-overcorrection.py` | WER/CER gộp, mức giảm tương đối, đếm câu tốt lên/xấu đi |
| `text-normalization-utils.py` | Chuẩn hóa NFC + lowercase + bỏ dấu câu trước khi chấm |

## Đọc kết quả

| Kết quả | Ý nghĩa cho đề tài |
|---|---|
| WER giảm >2% tương đối | Hướng đúng, fine-tune sẽ còn tốt hơn |
| WER **tăng** | Motivation mạnh nhất — sai miền + sai loại lỗi đúng như giả thuyết |
| WER đứng yên | Corrector mù trước lỗi ASR |

Trường hợp nào cũng dùng được cho báo cáo. Không có kết quả "hỏng".

## Đầu ra

- `outputs/evaluation-summary.json` — số liệu tổng hợp
- `outputs/per-sample-comparison.csv` — từng câu, để soi lỗi bằng mắt
