# Plan bổ sung hai pipeline ASR → NER

## 1. Mục tiêu

Mở rộng đồ án để so sánh công bằng ba phiên bản:

| Phiên bản | Quy trình |
|---|---|
| Baseline | `ASR → NER` |
| Normalize | `ASR → rule-based normalization → NER` |
| Correction | `ASR → correction model → NER` |

Mục tiêu là xác định việc xử lý transcript sau ASR có cải thiện chất lượng NER hay không, đồng thời kiểm tra tác động của nó lên WER.

## 2. Nguyên tắc bắt buộc

1. Giữ nguyên ASR checkpoint, NER checkpoint, dataset và cách tính metric giữa ba phiên bản.
2. Chạy cả ba phiên bản trên cùng một tập audio và cùng một thứ tự mẫu.
3. Không dùng `reference_transcript` của test để tạo luật, từ điển hoặc dữ liệu huấn luyện correction.
4. Chỉ xây luật/tạo dữ liệu correction từ train; dùng validation để chọn ngưỡng/checkpoint; chỉ dùng test một lần ở bước đánh giá cuối.
5. Lưu cả transcript trước và sau xử lý để có thể audit từng thay đổi.
6. Không tự sửa transcript test bằng đáp án chuẩn; đó là data leakage.
7. Nếu correction làm WER giảm nhưng NER F1 giảm, không chọn nó làm pipeline cuối.
8. Tất cả kết quả, lỗi và quyết định phải được ghi vào `REPORT_LOG.md`.

## 3. Thiết kế dữ liệu

### 3.1. Các tập dữ liệu

- ASR/pipeline: `leduckhai/VietMed`.
- NER gold: `leduckhai/VietMed-NER`.
- Train: chỉ dùng để thống kê lỗi/thuật ngữ và tạo dữ liệu correction.
- Validation: dùng để chọn luật, ngưỡng fuzzy matching và correction checkpoint.
- Test: chỉ dùng để so sánh cuối cùng.

### 3.2. Artifact cần lưu

Mỗi mẫu cần có tối thiểu:

```json
{
  "index": 0,
  "reference_transcript": "...",
  "asr_transcript": "...",
  "normalized_transcript": "...",
  "corrected_transcript": "...",
  "baseline_entities": [],
  "normalized_entities": [],
  "corrected_entities": [],
  "wer_baseline": null,
  "wer_normalized": null,
  "wer_corrected": null
}
```

Không phải phiên bản nào cũng cần có giá trị `normalized_transcript` hoặc `corrected_transcript` nếu đang chạy riêng từng thí nghiệm, nhưng output cuối nên dùng cùng schema.

## 4. Pipeline Baseline — đóng băng làm mốc

### Công việc

1. Đọc kết quả ASR test đã có hoặc chạy lại một lần vào thư mục độc lập.
2. Chạy NER trực tiếp trên `asr_transcript`.
3. Lưu kết quả và metric hiện tại.
4. Không thay đổi model, tokenizer, device hoặc post-processing entity khi so sánh.

### Metric baseline

- WER trung bình và trung vị.
- Tỷ lệ WER bằng 0.
- Entity count.
- Entity retention so với NER trên reference transcript.
- NER gold F1 từ dataset `leduckhai/VietMed-NER` (đánh giá NER độc lập).

Baseline hiện đã ghi nhận:

- Test WER: `26.1163%` trên 500 mẫu.
- NER gold micro F1: `58.6243%`.
- NER gold macro F1: `48.3849%`.
- Entity retention ASR/reference: `53.7996%`.

## 5. Pipeline Normalize — rule-based normalization

### 5.1. Mục tiêu

Sửa các sai khác hình thức, ít phụ thuộc ngữ cảnh, không cố đoán lại nội dung bị mất.

### 5.2. Phạm vi luật phiên bản đầu

Ưu tiên các luật an toàn:

- Gộp nhiều khoảng trắng.
- Chuẩn hóa khoảng trắng quanh dấu câu.
- Chuẩn hóa Unicode và dạng dấu nếu không làm đổi từ.
- Chuẩn hóa cách viết số/đơn vị đã có sẵn trong transcript.
- Chuẩn hóa viết hoa/viết thường theo một quy ước cố định.
- Loại ký tự điều khiển/ký tự rác.

Không đưa vào phiên bản đầu:

- Sửa một từ thành thuật ngữ khác chỉ vì nghe gần giống.
- Suy đoán từ bị thiếu dựa trên reference test.
- Sửa các từ có nhiều nghĩa khi chưa có ngữ cảnh đủ chắc chắn.

### 5.3. Từ điển y khoa tùy chọn

Nếu luật hình thức không đủ hiệu quả, tạo lexicon từ train/validation:

```text
noisy_variant → canonical_term
```

Mỗi entry cần lưu:

```json
{
  "noisy": "...",
  "canonical": "...",
  "source": "train_or_validation",
  "count": 0,
  "threshold": 0.0
}
```

Chỉ áp dụng khi:

- Biến thể xuất hiện đủ số lần trong train/validation.
- Điểm tương đồng vượt ngưỡng đã chọn trên validation.
- Không gây xung đột với thuật ngữ khác.

### 5.4. Thí nghiệm

Chạy:

```text
ASR transcript → normalization → NER
```

So sánh với baseline trên cùng 500 test samples.

### 5.5. Output

```text
normalize_results.jsonl
normalize_summary.json
normalize_comparison.csv
normalization_rules.json
```

## 6. Pipeline Correction — correction model

### 6.1. Mục tiêu

Dùng một mô hình text-to-text để sửa lỗi ASR theo ngữ cảnh trước khi đưa transcript vào NER.

### 6.2. Tạo dữ liệu huấn luyện không leakage

Không có sẵn cặp ASR-noisy/clean cho mọi mẫu, nên tạo cặp từ train:

```text
reference transcript train → ASR transcript train
```

Mỗi cặp gồm:

```json
{
  "noisy": "transcript do ASR tạo",
  "clean": "transcript chuẩn tương ứng"
}
```

Có thể lọc các cặp:

- `noisy` và `clean` không rỗng.
- Có WER khác 0 để model học sửa lỗi.
- Không vượt giới hạn độ dài.

Nếu dùng dữ liệu tổng hợp, chỉ tạo nhiễu dựa trên lỗi quan sát trong train; ghi rõ cách tạo vào báo cáo.

### 6.3. Chia dữ liệu

- Correction train pairs: chỉ từ split train.
- Correction validation pairs: chỉ từ split validation hoặc một phần train được tách trước khi huấn luyện.
- Correction test: không fine-tune trên test; test chỉ dùng đánh giá cuối.

### 6.4. Chọn correction model

Ưu tiên một mô hình seq2seq text-to-text hỗ trợ tiếng Việt và có thể fine-tune trên Colab. Cần chốt model cụ thể sau khi kiểm tra:

- tokenizer tương thích.
- giới hạn độ dài.
- kích thước model/VRAM.
- license và khả năng tải công khai.
- khả năng giữ nguyên thuật ngữ không cần sửa.

Không đưa một mô hình chưa kiểm tra vào kết quả chính thức. Nếu không đủ thời gian fine-tune, báo cáo correction model như thí nghiệm phụ hoặc không thực hiện Giai đoạn 6.

### 6.5. Ràng buộc bảo toàn nội dung

Correction model cần được kiểm tra để tránh:

- Hallucination.
- Xóa thông tin y tế.
- Sửa đúng thành sai.
- Lặp văn bản.
- Thay đổi số, liều lượng hoặc tên thuốc.

Lưu các cột:

```text
asr_transcript
corrected_transcript
changed
change_count
```

### 6.6. Chọn checkpoint/ngưỡng

Chỉ dùng validation để chọn:

- checkpoint tốt nhất.
- `max_new_tokens`.
- beam size hoặc decoding setting.
- ngưỡng bỏ qua correction nếu output quá khác ASR.

Tiêu chí chọn nên ưu tiên theo thứ tự:

1. NER F1/metric downstream trên validation có gold phù hợp.
2. WER giảm mà không tăng lỗi nội dung.
3. Tỷ lệ hallucination thấp.
4. Thời gian và bộ nhớ chấp nhận được.

### 6.7. Output

```text
correction_model_config.json
correction_results.jsonl
correction_summary.json
correction_validation_metrics.json
```

## 7. Chạy so sánh ba pipeline

### 7.1. Cấu hình cố định

- Cùng audio/test indices.
- Cùng ASR output.
- Cùng NER model/tokenizer.
- Cùng entity filtering.
- Cùng cách tính WER.
- Cùng thiết bị nếu có thể.

### 7.2. Bảng metric

| Metric | Baseline | Normalize | Correction |
|---|---:|---:|---:|
| WER mean | ... | ... | ... |
| WER median | ... | ... | ... |
| WER = 0 | ... | ... | ... |
| NER micro Precision | ... | ... | ... |
| NER micro Recall | ... | ... | ... |
| NER micro F1 | ... | ... | ... |
| NER macro F1 | ... | ... | ... |
| Entity retention | ... | ... | ... |
| Hallucination rate | ... | ... | ... |

NER gold F1 chỉ ghi khi input và gold labels tương ứng, hoặc phải nêu rõ đây là đánh giá NER độc lập. Không gọi entity retention là recall gold.

### 7.3. Output

```text
three_pipeline_results.jsonl
three_pipeline_comparison.csv
three_pipeline_summary.json
```

## 8. Phân tích lỗi

Chọn tối thiểu 5 case cho mỗi nhóm:

1. Normalize/correction cải thiện WER và giữ entity.
2. WER cải thiện nhưng entity không cải thiện.
3. ASR sai, normalization không sửa được.
4. Correction model sửa đúng thuật ngữ y khoa.
5. Correction model sửa sai transcript đúng.
6. Correction làm mất entity hoặc đổi label.
7. Correction sinh nội dung không có trong ASR.

Bảng case study:

| Index | Reference | ASR | Normalize | Correction | Entity trước | Entity sau | Kết luận |
|---|---|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... | ... | ... |

## 9. Tiêu chí quyết định pipeline cuối

### Chọn Normalize nếu

- WER giảm hoặc không tăng đáng kể.
- NER F1/retention tăng.
- Không tạo thay đổi sai đáng kể.
- Dễ tái hiện và giải thích.

### Chọn Correction nếu

- Validation cho thấy cải thiện ổn định.
- Test cho thấy cải thiện cùng chiều.
- Hallucination và thay đổi quá mức thấp.
- Chi phí GPU/thời gian chấp nhận được.

### Giữ Baseline nếu

- Hai phương án mới không cải thiện đáng kể.
- Correction làm tăng hallucination hoặc làm giảm NER F1.
- Không đủ dữ liệu để chứng minh lợi ích.

Thí nghiệm không cải thiện vẫn là kết quả hợp lệ nếu được báo cáo trung thực.

## 10. Giai đoạn thực hiện

### Bước A — Freeze baseline

- [ ] Lưu ASR output test độc lập.
- [ ] Lưu NER output baseline.
- [ ] Ghi checksum/tên model và cấu hình.

### Bước B — Normalize

- [ ] Xây normalization function.
- [ ] Kiểm tra trên train/validation.
- [ ] Chốt luật và ngưỡng trước test.
- [ ] Chạy test.
- [ ] Tính WER/NER/retention.

### Bước C — Correction model

- [ ] Tạo noisy/clean pairs từ train.
- [ ] Tạo validation pairs.
- [ ] Chọn model và cấu hình.
- [ ] Fine-tune hoặc tải checkpoint.
- [ ] Đánh giá validation.
- [ ] Chốt checkpoint/ngưỡng.
- [ ] Chạy test.
- [ ] Kiểm tra hallucination và thay đổi quá mức.

### Bước D — So sánh

- [ ] Tạo bảng ba pipeline.
- [ ] Chọn case study.
- [ ] Tạo biểu đồ.
- [ ] Cập nhật báo cáo và slide.
- [ ] Ghi quyết định pipeline cuối.

## 11. Các file dự kiến cần thêm

- `correction_normalization.py` — hàm normalization và lexicon correction.
- `evaluate_three_pipelines.py` — chạy/đánh giá ba cấu hình trên output đã cố định.
- `CORRECTION_RESULTS.md` — diễn giải kết quả sau khi chạy.
- `normalization_rules.json` — luật đã chốt.
- Các output trong thư mục riêng, không ghi đè `giai_doan_4/` hoặc `giai_doan_5/`.

Chỉ tạo file code sau khi hoàn tất kiểm tra dữ liệu và chốt model correction.

## 12. Thứ tự khuyến nghị

```text
Freeze baseline
    ↓
Rule-based normalization
    ↓
Đánh giá normalization trên validation
    ↓
Chạy normalization trên test
    ↓
Tạo dữ liệu correction từ train
    ↓
Fine-tune/chọn correction model trên validation
    ↓
Chạy correction trên test
    ↓
So sánh ba pipeline
    ↓
Phân tích lỗi
    ↓
Chọn pipeline cuối
    ↓
Cập nhật báo cáo/slide/demo
```
