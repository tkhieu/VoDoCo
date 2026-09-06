"""
Bước 1 — Tải VietMed và trích mẫu N câu từ split test.

Lưu ra:
  data/sample-metadata.jsonl   : transcript gốc + metadata (accent, role, icd10...)
  data/audio/<utterance_id>.wav: audio 16kHz mono, dùng cho bước chạy ASR

Chạy:
  python scripts/download-vietmed-test-sample.py --num-samples 100 --seed 42
"""

import argparse
import io
import json
import random
from pathlib import Path

import numpy as np
import soundfile as sf
from datasets import Audio, load_dataset

# Thư mục gốc của thí nghiệm (script nằm trong scripts/)
EXPERIMENT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = EXPERIMENT_ROOT / "data"
AUDIO_DIR = DATA_DIR / "audio"

# Các trường metadata của VietMed cần giữ lại để phân tích lỗi theo lát cắt
METADATA_FIELDS = [
    "utterance_id", "speaker_name", "seq_name", "audio_name",
    "role", "gender", "accent", "icd10_code", "rec_condition", "duration",
]

TARGET_SAMPLE_RATE = 16_000


def resample_if_needed(waveform: np.ndarray, source_rate: int) -> np.ndarray:
    """Đưa audio về 16kHz — tần số mà mọi mô hình ASR trong thí nghiệm này yêu cầu.

    Dùng nội suy tuyến tính thay vì thư viện resample chuyên dụng để tránh
    thêm phụ thuộc; với mục đích sinh hypothesis thì sai khác là không đáng kể.
    """
    if source_rate == TARGET_SAMPLE_RATE:
        return waveform
    duration_seconds = len(waveform) / source_rate
    target_length = int(round(duration_seconds * TARGET_SAMPLE_RATE))
    source_positions = np.linspace(0, len(waveform) - 1, num=len(waveform))
    target_positions = np.linspace(0, len(waveform) - 1, num=target_length)
    return np.interp(target_positions, source_positions, waveform).astype(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser(description="Trích mẫu test set của VietMed")
    parser.add_argument("--num-samples", type=int, default=100)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--split", type=str, default="test")
    args = parser.parse_args()

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[1/3] Đang tải leduckhai/VietMed split={args.split} ...")
    dataset = load_dataset("leduckhai/VietMed", split=args.split)

    # Tắt decode tự động của `datasets`: backend torchcodec không tương thích với
    # ffmpeg 9 trên máy này. Lấy bytes thô rồi tự decode bằng soundfile ổn định hơn
    # và không thêm phụ thuộc nào.
    dataset = dataset.cast_column("audio", Audio(decode=False))

    print(f"      Tổng số dòng: {len(dataset)}")
    print(f"      Các cột: {dataset.column_names}")

    # Lấy mẫu ngẫu nhiên có seed cố định để thí nghiệm lặp lại được
    random.seed(args.seed)
    selected_indices = sorted(
        random.sample(range(len(dataset)), k=min(args.num_samples, len(dataset)))
    )

    print(f"[2/3] Đang ghi {len(selected_indices)} mẫu ...")
    metadata_path = DATA_DIR / "sample-metadata.jsonl"
    written_count = 0

    with metadata_path.open("w", encoding="utf-8") as metadata_file:
        for position, dataset_index in enumerate(selected_indices):
            row = dataset[dataset_index]

            # Định danh mẫu: ưu tiên utterance_id thật, fallback về số thứ tự
            sample_id = str(row.get("utterance_id") or f"sample-{position:04d}")
            safe_sample_id = sample_id.replace("/", "_").replace(" ", "_")

            audio_field = row.get("audio")
            if audio_field is None:
                print(f"      ! Bỏ qua {sample_id}: không có audio")
                continue

            # audio_field ở dạng {"bytes": ..., "path": ...} vì đã tắt decode
            audio_bytes = audio_field.get("bytes")
            if audio_bytes is None:
                print(f"      ! Bỏ qua {sample_id}: audio rỗng")
                continue

            waveform, source_rate = sf.read(io.BytesIO(audio_bytes), dtype="float32")
            if waveform.ndim > 1:  # gộp stereo về mono
                waveform = waveform.mean(axis=1)
            waveform = resample_if_needed(waveform, source_rate)

            audio_path = AUDIO_DIR / f"{safe_sample_id}.wav"
            sf.write(audio_path, waveform, TARGET_SAMPLE_RATE)

            record = {
                "sample_id": safe_sample_id,
                "dataset_index": dataset_index,
                "reference_text": row.get("text", ""),
                "audio_path": str(audio_path.relative_to(EXPERIMENT_ROOT)),
            }
            for field in METADATA_FIELDS:
                if field in row:
                    record[field] = row[field]

            metadata_file.write(json.dumps(record, ensure_ascii=False) + "\n")
            written_count += 1

    print(f"[3/3] Xong. Đã ghi {written_count} mẫu vào {metadata_path}")
    print(f"      Audio: {AUDIO_DIR}")


if __name__ == "__main__":
    main()
