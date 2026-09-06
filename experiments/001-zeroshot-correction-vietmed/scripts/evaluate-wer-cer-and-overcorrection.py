"""
Bước 4 — Đo và kết luận.

Ba nhóm số liệu:

  A. WER/CER của ASR thô so với transcript gốc          -> mức nhiễu ban đầu
  B. WER/CER sau khi hiệu chỉnh                          -> corrector giúp hay hại
  C. WER/CER khi cho corrector ăn transcript GỐC         -> mức over-correction

Không chỉ báo cáo trung bình. Một corrector có thể kéo WER trung bình xuống
trong khi vẫn phá hỏng nhiều câu lẻ, nên phải đếm số câu tốt lên / xấu đi.

Lưu ra:
  outputs/evaluation-summary.json
  outputs/per-sample-comparison.csv

Chạy:
  python scripts/evaluate-wer-cer-and-overcorrection.py
"""

import csv
import importlib.util
import json
from pathlib import Path

import jiwer

EXPERIMENT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = EXPERIMENT_ROOT / "outputs"

# Tên file có dấu gạch ngang nên không import bằng cú pháp thường được
_normalization_spec = importlib.util.spec_from_file_location(
    "text_normalization_utils", Path(__file__).parent / "text-normalization-utils.py"
)
_normalization = importlib.util.module_from_spec(_normalization_spec)
_normalization_spec.loader.exec_module(_normalization)
normalize_for_scoring = _normalization.normalize_for_scoring


def load_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def corpus_error_rates(references: list[str], hypotheses: list[str]) -> dict:
    """Tính WER/CER trên toàn corpus (gộp, không phải trung bình theo câu).

    WER gộp là chuẩn báo cáo trong ASR: tổng số lỗi chia tổng số từ tham chiếu.
    Trung bình theo câu sẽ khiến câu ngắn có trọng số quá lớn.
    """
    normalized_refs = [normalize_for_scoring(r) for r in references]
    normalized_hyps = [normalize_for_scoring(h) for h in hypotheses]

    # jiwer bỏ qua cặp có reference rỗng; loại trước để tránh lệch số liệu
    pairs = [(r, h) for r, h in zip(normalized_refs, normalized_hyps) if r]
    refs = [r for r, _ in pairs]
    hyps = [h for _, h in pairs]

    # jiwer >= 4.0 bỏ compute_measures, thay bằng process_words trả về dataclass
    output = jiwer.process_words(refs, hyps)
    return {
        "wer": output.wer,
        "cer": jiwer.cer(refs, hyps),
        "substitutions": output.substitutions,
        "deletions": output.deletions,
        "insertions": output.insertions,
        "hits": output.hits,
        "num_scored_sentences": len(pairs),
    }


def sentence_wer(reference: str, hypothesis: str) -> float:
    """WER của một câu, dùng để so tốt lên / xấu đi ở mức từng mẫu."""
    normalized_ref = normalize_for_scoring(reference)
    normalized_hyp = normalize_for_scoring(hypothesis)
    if not normalized_ref:
        return 0.0
    return jiwer.wer(normalized_ref, normalized_hyp)


def main() -> None:
    corrected_from_asr = load_jsonl(OUTPUT_DIR / "corrected-from-asr.jsonl")
    corrected_from_reference = load_jsonl(OUTPUT_DIR / "corrected-from-reference.jsonl")

    references = [row["reference_text"] for row in corrected_from_asr]
    asr_hypotheses = [row["input_text"] for row in corrected_from_asr]
    corrected_hypotheses = [row["corrected_text"] for row in corrected_from_asr]
    corrected_references = [row["corrected_text"] for row in corrected_from_reference]

    metrics_asr_raw = corpus_error_rates(references, asr_hypotheses)
    metrics_asr_corrected = corpus_error_rates(references, corrected_hypotheses)
    metrics_overcorrection = corpus_error_rates(references, corrected_references)

    # Mức giảm tương đối — con số quyết định đề tài đi tiếp hay đổi hướng
    wer_before = metrics_asr_raw["wer"]
    wer_after = metrics_asr_corrected["wer"]
    relative_wer_reduction = (
        (wer_before - wer_after) / wer_before if wer_before > 0 else 0.0
    )

    # Đếm câu tốt lên / xấu đi — chống lại việc trung bình che giấu thiệt hại
    improved = worsened = unchanged = 0
    per_sample_rows = []
    for row_asr, row_ref in zip(corrected_from_asr, corrected_from_reference):
        wer_raw = sentence_wer(row_asr["reference_text"], row_asr["input_text"])
        wer_corrected = sentence_wer(row_asr["reference_text"], row_asr["corrected_text"])
        wer_over = sentence_wer(row_ref["reference_text"], row_ref["corrected_text"])

        if wer_corrected < wer_raw - 1e-9:
            improved += 1
            verdict = "tot_len"
        elif wer_corrected > wer_raw + 1e-9:
            worsened += 1
            verdict = "xau_di"
        else:
            unchanged += 1
            verdict = "khong_doi"

        per_sample_rows.append({
            "sample_id": row_asr["sample_id"],
            "reference_text": row_asr["reference_text"],
            "asr_hypothesis": row_asr["input_text"],
            "corrected_from_asr": row_asr["corrected_text"],
            "corrected_from_reference": row_ref["corrected_text"],
            "wer_asr_raw": round(wer_raw, 4),
            "wer_after_correction": round(wer_corrected, 4),
            "wer_overcorrection": round(wer_over, 4),
            "verdict": verdict,
        })

    # Tỉ lệ câu bị corrector động vào dù đầu vào vốn đã đúng
    reference_untouched = sum(
        1 for row in per_sample_rows if row["wer_overcorrection"] == 0.0
    )

    summary = {
        "num_samples": len(per_sample_rows),
        "A_asr_raw": metrics_asr_raw,
        "B_after_correction": metrics_asr_corrected,
        "C_overcorrection_on_gold": metrics_overcorrection,
        "relative_wer_reduction": relative_wer_reduction,
        "sentence_level": {
            "improved": improved,
            "worsened": worsened,
            "unchanged": unchanged,
        },
        "reference_left_untouched": reference_untouched,
    }

    summary_path = OUTPUT_DIR / "evaluation-summary.json"
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    csv_path = OUTPUT_DIR / "per-sample-comparison.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(per_sample_rows[0].keys()))
        writer.writeheader()
        writer.writerows(per_sample_rows)

    # ---- In báo cáo ----
    print("=" * 62)
    print(f"KẾT QUẢ — {len(per_sample_rows)} câu VietMed test")
    print("=" * 62)
    print(f"\nA. ASR thô (PhoWhisper)")
    print(f"   WER = {metrics_asr_raw['wer']:.2%}   CER = {metrics_asr_raw['cer']:.2%}")
    print(f"\nB. Sau hiệu chỉnh zero-shot")
    print(f"   WER = {metrics_asr_corrected['wer']:.2%}   CER = {metrics_asr_corrected['cer']:.2%}")
    print(f"   Giảm tương đối: {relative_wer_reduction:+.2%}")
    print(f"\nC. Over-correction (cho ăn transcript GỐC)")
    print(f"   WER = {metrics_overcorrection['wer']:.2%}  (lý tưởng = 0%)")
    print(f"   Câu giữ nguyên vẹn: {reference_untouched}/{len(per_sample_rows)}")
    print(f"\nMức câu: tốt lên {improved} · xấu đi {worsened} · không đổi {unchanged}")

    print("\n" + "=" * 62)
    if relative_wer_reduction > 0.02:
        print("KẾT LUẬN: corrector CÓ giúp -> hướng đi đúng, fine-tune sẽ còn tốt hơn.")
    elif relative_wer_reduction < -0.02:
        print("KẾT LUẬN: corrector LÀM TỆ HƠN -> đây là motivation mạnh nhất cho đề tài.")
        print("           Sai miền + sai loại lỗi đúng như giả thuyết. Cần fine-tune.")
    else:
        print("KẾT LUẬN: gần như không tác dụng -> corrector mù trước lỗi ASR.")
    print("=" * 62)
    print(f"\nChi tiết: {csv_path}")


if __name__ == "__main__":
    main()
