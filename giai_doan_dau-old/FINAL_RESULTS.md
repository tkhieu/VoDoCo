# Bảng kết quả cuối cùng

## Số liệu đã xác minh từ file hiện có

| Thí nghiệm | Dataset/split | Số mẫu | Chỉ số | Kết quả |
|---|---|---:|---|---:|
| ASR + NER | VietMed/test | 500 | WER trung bình | 26,1163% |
| ASR + NER | VietMed/test | 500 | WER trung vị | 25% |
| ASR + NER | VietMed/test | 500 | WER = 0 | 2/500 (0,4%) |
| ASR + NER | VietMed/test | 500 | Entity dự đoán | 1.274 |
| NER gold | VietMed-NER/test | 3.497 | Micro Precision | 52,58% |
| NER gold | VietMed-NER/test | 3.497 | Micro Recall | 66,2389% |
| NER gold | VietMed-NER/test | 3.497 | Micro F1 | 58,6243% |
| NER gold | VietMed-NER/test | 3.497 | Macro F1 | 48,3849% |
| NER consistency | VietMed/test | 500 | Entity retention | 53,7996% |
| NER consistency | VietMed/test | 500 | Consistency F1 | 57,95% |

## Số liệu train rerun đã xác minh

Batch train 500 mẫu đã được chạy lại độc lập trong `multimed_results_500_train_rerun/` với WER trung bình 4,1218%, WER trung vị 0% và 406/500 mẫu WER bằng 0 (81,2%). Có 0 lỗi runtime và 500 index duy nhất từ 0 đến 499.

Không dùng kết quả train làm số liệu tổng quát hóa chính; dùng để đối chiếu hiện tượng chênh lệch train/test. Nguồn độc lập: `multimed_results_500_train_rerun/summary.json`, `summary.csv`, `results.jsonl`, `errors.jsonl`.

## Diễn giải chính

- NER gold micro F1 là số liệu NER chính thức: 58,6243%.
- Macro F1 là 48,3849%, thấp hơn micro F1 vì hiệu năng không đồng đều giữa các nhãn.
- ASR test WER 26,1163% là nút thắt của pipeline tiếng nói.
- Entity retention 53,7996% là consistency metric, không phải recall gold.
- Khi WER >30%, retention giảm còn 35,0467%; nhóm này chiếm 29,4% trong batch 500 mẫu.

## Checklist trước khi nộp

- [x] Đối chiếu bảng này với JSON nguồn.
- [x] Không gọi consistency F1 là gold F1.
- [x] Không dùng WER train làm kết quả tổng quát hóa chính.
- [ ] Chèn sơ đồ pipeline.
- [ ] Chèn ít nhất 3 case study lỗi.
- [ ] Chèn biểu đồ `giai_doan_5/stage5_error_analysis.png`.
- [ ] Nêu rõ giới hạn đánh giá và không dùng hệ thống để chẩn đoán.
