"""
Chuẩn hóa văn bản dùng chung cho việc tính WER/CER trên tiếng Việt.

Lý do cần chuẩn hóa: đầu ra ASR thường không có dấu câu và không viết hoa,
trong khi transcript gốc của VietMed có. Nếu so sánh thô, WER sẽ bị thổi phồng
bởi những khác biệt không liên quan tới chất lượng nhận dạng.
"""

import re
import unicodedata

# Dấu câu cần loại bỏ trước khi so khớp từ (giữ nguyên chữ + số + khoảng trắng)
_PUNCT_PATTERN = re.compile(r"[^\w\s]", flags=re.UNICODE)
_WHITESPACE_PATTERN = re.compile(r"\s+")


def normalize_for_scoring(text: str) -> str:
    """Đưa văn bản về dạng chuẩn để tính WER/CER.

    Các bước:
      1. Chuẩn hóa Unicode về NFC — tiếng Việt có thể được mã hóa dạng tổ hợp
         (NFD: "e" + dấu) hoặc dựng sẵn (NFC: "ê"). Không thống nhất sẽ khiến
         hai chuỗi nhìn giống hệt nhau nhưng bị tính là khác.
      2. Chuyển về chữ thường.
      3. Bỏ dấu câu.
      4. Gộp khoảng trắng thừa.
    """
    if text is None:
        return ""
    text = unicodedata.normalize("NFC", str(text))
    text = text.lower()
    text = _PUNCT_PATTERN.sub(" ", text)
    text = _WHITESPACE_PATTERN.sub(" ", text)
    return text.strip()


def normalize_batch(texts):
    """Chuẩn hóa một danh sách văn bản."""
    return [normalize_for_scoring(t) for t in texts]
