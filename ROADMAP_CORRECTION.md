# Roadmap mở rộng: Correction cho pipeline ASR → NER

Kế hoạch triển khai chi tiết cho hai nhánh Normalize và Correction nằm trong [CORRECTION_IMPLEMENTATION_PLAN.md](CORRECTION_IMPLEMENTATION_PLAN.md).

## Mục tiêu

Mở rộng pipeline hiện tại để kiểm tra liệu việc sửa transcript ASR có cải thiện khả năng nhận diện thực thể y tế hay không.

Pipeline baseline hiện tại:

```text
Audio → ASR → Transcript ASR → NER → Medical entities
```

Pipeline mở rộng cần đánh giá:

```text
Audio → ASR → Text normalization/correction → NER → Medical entities
```

## Nguyên tắc thực nghiệm

1. Giữ nguyên baseline `ASR → NER` để làm mốc so sánh.
2. Không dùng transcript chuẩn của test để tạo luật sửa hoặc huấn luyện correction model.
3. Tách dữ liệu thành train/validation/test rõ ràng.
4. Đánh giá correction bằng WER trước/sau.
5. Đánh giá NER bằng gold labels khi có thể; nếu không có gold labels cho audio, chỉ báo cáo consistency và đánh giá thủ công.
6. Không dùng confidence score làm bằng chứng rằng entity đúng.
7. Không đưa ra chẩn đoán hoặc khuyến nghị điều trị từ output của hệ thống.
8. Mỗi giai đoạn phải cập nhật kết quả vào `REPORT_LOG.md`.

---

## Giai đoạn 9 — Chuẩn hóa transcript baseline

### Mục tiêu

Tạo một bước tiền xử lý an toàn, không dùng mô hình sinh văn bản.

### Công việc

- Chuẩn hóa khoảng trắng.
- Chuẩn hóa chữ hoa/chữ thường theo quy ước thống nhất.
- Chuẩn hóa dấu câu và ký hiệu.
- Chuẩn hóa cách viết số/đơn vị nếu không làm thay đổi nội dung.
- Xử lý các token rỗng hoặc ký tự bất thường.
- Không tự động thay thế thuật ngữ dựa trên đáp án test.

### Pipeline

```text
ASR → Normalization → NER
```

### Đánh giá

- WER trước normalization.
- WER sau normalization.
- Entity retention trước/sau.
- Số entity thay đổi.
- Kiểm tra thủ công các trường hợp normalization làm sai nghĩa.

### Output dự kiến

```text
normalization_results.jsonl
normalization_summary.json
normalization_comparison.csv
```

---

## Giai đoạn 10 — Từ điển correction y khoa an toàn

### Mục tiêu

Thử sửa các lỗi ASR thường gặp bằng từ điển được xây dựng chỉ từ tập train hoặc nguồn y khoa công khai.

### Công việc

- Trích xuất các thuật ngữ y khoa thường gặp từ tập train.
- Xây dựng danh sách biến thể lỗi có căn cứ từ train.
- Dùng khoảng cách chỉnh sửa hoặc fuzzy matching có ngưỡng.
- Chỉ sửa khi điểm tương đồng và ngữ cảnh đủ chắc chắn.
- Không sửa các từ ngắn hoặc từ có nhiều nghĩa nếu thiếu ngữ cảnh.
- Ghi lại từng thay đổi: text trước, text sau, luật áp dụng.

### Ví dụ minh họa

```text
ASR:       chày máu não
Correction: chảy máu não
```

Chỉ đưa ví dụ này vào từ điển nếu luật được xây dựng trước khi xem test output hoặc được xác nhận bằng dữ liệu train/validation.

### Đánh giá

- WER trước/sau correction.
- WER riêng trên câu có thuật ngữ y khoa.
- Tỷ lệ correction đúng, sai và không thay đổi.
- NER F1/retention trước và sau correction.

### Output dự kiến

```text
medical_lexicon.json
lexicon_correction_results.jsonl
lexicon_correction_summary.json
```

---

## Giai đoạn 11 — Đánh giá NER trên ba đầu vào

### Mục tiêu

Đo riêng tác động của correction lên NER.

### Ba cấu hình

| Cấu hình | Pipeline |
|---|---|
| Baseline | `ASR → NER` |
| Normalization | `ASR → normalization → NER` |
| Lexicon correction | `ASR → correction → NER` |

### Chỉ số

- Gold NER Precision, Recall, F1 nếu có nhãn tương ứng.
- Entity retention so với NER trên reference transcript.
- Số entity bị mất.
- Số entity phát sinh.
- Số entity đổi span.
- Số entity đổi label.

### Output dự kiến

```text
three_pipeline_comparison.csv
three_pipeline_comparison.json
three_pipeline_summary.json
```

---

## Giai đoạn 12 — Correction model có ngữ cảnh

### Điều kiện bắt đầu

Chỉ thực hiện nếu Giai đoạn 9–11 cho thấy correction bằng luật có tiềm năng và còn thời gian/GPU.

### Mục tiêu

Thử một mô hình text-to-text correction trên transcript ASR.

### Công việc

- Chọn model correction tiếng Việt phù hợp.
- Huấn luyện hoặc fine-tune chỉ trên cặp noisy/clean được tạo từ train.
- Giữ validation riêng để chọn checkpoint.
- Không dùng test reference để tạo cặp huấn luyện.
- Bảo toàn các thuật ngữ y khoa trong output.
- Giới hạn độ dài và kiểm tra output rỗng/hallucination.

### Pipeline

```text
ASR → Correction model → NER
```

### Đánh giá

- WER trước/sau correction.
- Tỷ lệ câu bị sửa quá mức.
- Tỷ lệ hallucination.
- NER F1 trên tập có gold labels.
- So sánh với baseline và lexicon correction.

### Tiêu chí dừng

Nếu WER giảm nhưng NER F1 giảm, không chọn correction model làm pipeline chính; chỉ báo cáo như thí nghiệm thất bại hoặc hướng nghiên cứu.

---

## Giai đoạn 13 — Phân tích lỗi correction

### Mục tiêu

Xác định correction giúp hoặc gây hại ở trường hợp nào.

### Nhóm case study

1. ASR sai và correction sửa đúng.
2. ASR sai nhưng correction không sửa được.
3. ASR đúng nhưng correction sửa sai.
4. Correction sửa transcript nhưng không cải thiện NER.
5. Correction làm entity bị mất hoặc đổi label.
6. Correction tạo từ không có trong reference.

### Bảng cần tạo

| Audio | Reference | ASR | Corrected | Entity trước | Entity sau | Kết luận |
|---|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... | ... |

### Output dự kiến

```text
correction_case_studies.json
correction_error_analysis.csv
correction_error_analysis.md
```

---

## Giai đoạn 14 — Chọn pipeline cuối

### Tiêu chí

Chọn cấu hình có sự cân bằng tốt giữa:

- WER thấp.
- NER F1 cao.
- Entity retention cao.
- Ít hallucination.
- Thời gian chạy hợp lý.
- Có thể tái hiện trên Colab.

### Không chọn chỉ dựa trên một chỉ số

Ví dụ, không chọn model chỉ vì:

- Confidence cao.
- WER thấp nhưng NER kém.
- Một vài case study đẹp.
- Một nhãn có F1 cao.

### Output

```text
FINAL_PIPELINE_DECISION.md
final_pipeline_summary.json
```

---

## Giai đoạn 15 — Demo correction

### Demo cần thể hiện

```text
Audio
→ ASR transcript
→ Corrected transcript
→ NER entities
```

Hiển thị ba phần cạnh nhau:

1. Transcript chuẩn tham chiếu (chỉ dùng để minh họa/đánh giá, không dùng trong inference).
2. Transcript ASR.
3. Transcript sau correction và entities.

### Lưu ý demo

- Không hiển thị reference transcript như thể hệ thống đã biết trước.
- Gắn nhãn rõ reference chỉ phục vụ đánh giá.
- Có JSON output dự phòng.
- Nêu rằng hệ thống không chẩn đoán bệnh.

---

## Giai đoạn 16 — Cập nhật báo cáo và slide

### Báo cáo cần bổ sung

- Động lực thêm correction.
- Thiết kế thí nghiệm baseline/correction.
- Nguyên tắc tránh data leakage.
- Bảng WER trước/sau.
- Bảng NER trước/sau.
- Case study correction thành công và thất bại.
- Chi phí tính toán và thời gian chạy.
- Hạn chế của correction.

### Slide cần bổ sung

- Slide pipeline baseline.
- Slide pipeline có correction.
- Slide so sánh ba cấu hình.
- Slide case study.
- Slide quyết định pipeline cuối.

---

## Thứ tự thực hiện khuyến nghị

```text
Giai đoạn 9  — Normalization an toàn
      ↓
Giai đoạn 10 — Từ điển correction
      ↓
Giai đoạn 11 — So sánh ba pipeline
      ↓
Giai đoạn 13 — Phân tích lỗi
      ↓
Giai đoạn 14 — Chọn pipeline cuối
      ↓
Giai đoạn 15 — Demo
      ↓
Giai đoạn 16 — Báo cáo và slide
```

Chỉ làm Giai đoạn 12 (correction model) nếu các bước trước cho thấy lợi ích rõ ràng.

## Trạng thái theo dõi

- [ ] Giai đoạn 9 — Normalization an toàn
- [ ] Giai đoạn 10 — Từ điển correction y khoa
- [ ] Giai đoạn 11 — So sánh ba pipeline
- [ ] Giai đoạn 12 — Correction model có ngữ cảnh
- [ ] Giai đoạn 13 — Phân tích lỗi correction
- [ ] Giai đoạn 14 — Chọn pipeline cuối
- [ ] Giai đoạn 15 — Demo correction
- [ ] Giai đoạn 16 — Cập nhật báo cáo và slide
