"""
Bước 3 — Chạy zero-shot bmd1905/vietnamese-correction-v2.

Chạy trên HAI nguồn đầu vào, và đây là điểm mấu chốt của thí nghiệm:

  1. hypothesis ASR  -> corrector có sửa được lỗi ASR không?
  2. transcript GỐC  -> corrector có phá hỏng văn bản vốn đã đúng không?

Nhánh (2) là phép thử over-correction. Với đầu vào hoàn hảo, một corrector vô hại
phải trả về gần như nguyên văn. Mọi thay đổi ở đây đều là thiệt hại thuần túy, và
nếu thiệt hại rơi vào thuật ngữ y khoa thì đó chính là bằng chứng cho luận điểm
"mô hình sai miền" của đề tài.

Lưu ra:
  outputs/corrected-from-asr.jsonl
  outputs/corrected-from-reference.jsonl

Chạy:
  python scripts/run-zeroshot-correction.py
"""

import argparse
import json
import time
from pathlib import Path

import torch
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

EXPERIMENT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = EXPERIMENT_ROOT / "outputs"
ASR_HYPOTHESES_PATH = OUTPUT_DIR / "asr-hypotheses.jsonl"

# Giới hạn của model card bmd1905/vietnamese-correction-v2
MAX_INPUT_TOKENS = 512


def load_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def correct_texts(texts, tokenizer, model, device, batch_size: int) -> list[str]:
    """Chạy corrector theo lô, trả về danh sách văn bản đã sửa."""
    corrected = []
    for batch_start in range(0, len(texts), batch_size):
        batch = texts[batch_start : batch_start + batch_size]
        inputs = tokenizer(
            batch,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=MAX_INPUT_TOKENS,
        ).to(device)

        with torch.no_grad():
            output_ids = model.generate(
                **inputs,
                max_length=MAX_INPUT_TOKENS,
                num_beams=4,
                early_stopping=True,
            )
        corrected.extend(
            text.strip()
            for text in tokenizer.batch_decode(output_ids, skip_special_tokens=True)
        )
        done = min(batch_start + batch_size, len(texts))
        print(f"      {done}/{len(texts)} ...", end="\r")
    print()
    return corrected


def main() -> None:
    parser = argparse.ArgumentParser(description="Zero-shot hiệu chỉnh văn bản tiếng Việt")
    parser.add_argument("--model-id", type=str, default="bmd1905/vietnamese-correction-v2")
    parser.add_argument("--batch-size", type=int, default=8)
    args = parser.parse_args()

    samples = load_jsonl(ASR_HYPOTHESES_PATH)
    print(f"[1/4] Đã đọc {len(samples)} mẫu")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[2/4] Đang tải {args.model_id} lên {device} ...")
    tokenizer = AutoTokenizer.from_pretrained(args.model_id)
    model = AutoModelForSeq2SeqLM.from_pretrained(args.model_id).to(device)
    model.eval()

    # Nhánh 1: sửa hypothesis ASR
    print("[3/4] Hiệu chỉnh hypothesis ASR ...")
    started_at = time.time()
    corrected_from_asr = correct_texts(
        [s["hypothesis_text"] for s in samples], tokenizer, model, device, args.batch_size
    )
    print(f"      {time.time() - started_at:.1f}s")

    with (OUTPUT_DIR / "corrected-from-asr.jsonl").open("w", encoding="utf-8") as handle:
        for sample, corrected in zip(samples, corrected_from_asr):
            handle.write(json.dumps({
                "sample_id": sample["sample_id"],
                "reference_text": sample["reference_text"],
                "input_text": sample["hypothesis_text"],
                "corrected_text": corrected,
            }, ensure_ascii=False) + "\n")

    # Nhánh 2: sửa transcript gốc — phép thử over-correction
    print("[4/4] Hiệu chỉnh transcript GỐC (đo over-correction) ...")
    started_at = time.time()
    corrected_from_reference = correct_texts(
        [s["reference_text"] for s in samples], tokenizer, model, device, args.batch_size
    )
    print(f"      {time.time() - started_at:.1f}s")

    with (OUTPUT_DIR / "corrected-from-reference.jsonl").open("w", encoding="utf-8") as handle:
        for sample, corrected in zip(samples, corrected_from_reference):
            handle.write(json.dumps({
                "sample_id": sample["sample_id"],
                "reference_text": sample["reference_text"],
                "input_text": sample["reference_text"],
                "corrected_text": corrected,
            }, ensure_ascii=False) + "\n")

    print(f"\nĐã ghi kết quả vào {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
