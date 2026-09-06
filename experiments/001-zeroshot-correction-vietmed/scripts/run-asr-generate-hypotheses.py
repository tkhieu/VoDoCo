"""
Bước 2 — Sinh hypothesis ASR cho các mẫu đã trích.

Đây chính là mắt xích còn thiếu được nêu trong ghi chú khả thi: cặp
(hypothesis ASR, transcript gốc) chưa tồn tại sẵn ở bất kỳ đâu, phải tự tạo.

Mặc định dùng vinai/PhoWhisper-medium — mô hình ASR tiếng Việt phổ biến nhất
hiện có checkpoint công khai. Đổi bằng --model-id nếu muốn so nhiều ASR.

Lưu ra:
  outputs/asr-hypotheses.jsonl : sample_id + reference_text + hypothesis_text

Chạy:
  python scripts/run-asr-generate-hypotheses.py --model-id vinai/PhoWhisper-medium
"""

import argparse
import json
import time
from pathlib import Path

import soundfile as sf
import torch
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

EXPERIMENT_ROOT = Path(__file__).resolve().parent.parent
METADATA_PATH = EXPERIMENT_ROOT / "data" / "sample-metadata.jsonl"
OUTPUT_PATH = EXPERIMENT_ROOT / "outputs" / "asr-hypotheses.jsonl"


def load_samples() -> list[dict]:
    """Đọc file metadata do bước 1 sinh ra."""
    with METADATA_PATH.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description="Sinh hypothesis ASR cho mẫu VietMed")
    parser.add_argument("--model-id", type=str, default="vinai/PhoWhisper-medium")
    parser.add_argument("--batch-size", type=int, default=8)
    args = parser.parse_args()

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    samples = load_samples()
    print(f"[1/3] Đã đọc {len(samples)} mẫu từ {METADATA_PATH.name}")

    # float16 trên GPU để tiết kiệm VRAM; float32 khi chạy CPU cho ổn định số học
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    print(f"[2/3] Đang tải {args.model_id} lên {device} (dtype={dtype}) ...")

    processor = AutoProcessor.from_pretrained(args.model_id)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(args.model_id, torch_dtype=dtype)
    model.to(device)
    model.eval()

    print(f"[3/3] Đang chạy nhận dạng ...")
    started_at = time.time()
    results = []

    for batch_start in range(0, len(samples), args.batch_size):
        batch = samples[batch_start : batch_start + args.batch_size]
        waveforms = []
        for sample in batch:
            waveform, sample_rate = sf.read(EXPERIMENT_ROOT / sample["audio_path"])
            assert sample_rate == 16_000, f"Kỳ vọng 16kHz, nhận {sample_rate}"
            waveforms.append(waveform)

        inputs = processor(
            waveforms,
            sampling_rate=16_000,
            return_tensors="pt",
            return_attention_mask=True,
        )
        input_features = inputs.input_features.to(device, dtype=dtype)
        attention_mask = inputs.get("attention_mask")
        if attention_mask is not None:
            attention_mask = attention_mask.to(device)

        with torch.no_grad():
            predicted_ids = model.generate(
                input_features,
                attention_mask=attention_mask,
                language="vi",
                task="transcribe",
                max_new_tokens=225,
            )

        transcriptions = processor.batch_decode(predicted_ids, skip_special_tokens=True)
        for sample, hypothesis in zip(batch, transcriptions):
            results.append({
                "sample_id": sample["sample_id"],
                "reference_text": sample["reference_text"],
                "hypothesis_text": hypothesis.strip(),
            })

        done = min(batch_start + args.batch_size, len(samples))
        print(f"      {done}/{len(samples)} ...", end="\r")

    elapsed = time.time() - started_at
    print(f"\n      Hoàn tất trong {elapsed:.1f}s ({elapsed / len(samples):.2f}s/câu)")

    with OUTPUT_PATH.open("w", encoding="utf-8") as handle:
        for record in results:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"      Đã ghi {OUTPUT_PATH}")

    # In vài ví dụ để mắt thường kiểm tra ngay, tránh chạy tiếp trên kết quả rác
    print("\n--- 3 ví dụ đầu ---")
    for record in results[:3]:
        print(f"  GỐC : {record['reference_text']}")
        print(f"  ASR : {record['hypothesis_text']}\n")


if __name__ == "__main__":
    main()
