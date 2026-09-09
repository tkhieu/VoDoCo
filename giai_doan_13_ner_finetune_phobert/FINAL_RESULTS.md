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

## Thí nghiệm Normalize, lexicon pilot và canonical rulebase

Nhánh rule-based normalization đã được chạy trên 500 transcript test bằng các luật hình thức: Unicode NFC, xử lý ký tự điều khiển, khoảng trắng và dấu câu.

| Metric | Baseline | Normalize |
|---|---:|---:|
| WER trung bình | 26,1163% | 26,1163% |
| Entity | 1.274 | 1.274 |
| Entity match | — | 1.274 |
| Consistency | — | 100% |

Có `0/500` transcript thay đổi. Đây là control experiment cho thấy normalization hình thức không sửa được lỗi ngữ âm/thuật ngữ; chưa được gọi là medical correction.

Canonical rulebase được xây từ `2.773` câu train sạch, gồm `1.140` terms và `20.277` phrases. Synthetic validation trên `500` câu dev với lỗi mất dấu cho thấy khôi phục `4.329/10.682` token lỗi (`40,5261%`) và precision trên token thay đổi `99,1071%`, nhưng exact sentence recovery là `0%`. Đây là kết quả trên nhiễu nhân tạo, chưa phải đánh giá ASR thật.

Medical lexicon correction pilot cũng được chạy độc lập với 400 mẫu induction và 100 mẫu validation từ train. Với `min_support=2`, `min_dominance=0.8`, chỉ có `0` rule hợp lệ, `0/500` test transcript thay đổi và WER giữ nguyên `26,1163%`. Đây là kết quả âm tính do độ phủ dữ liệu train mẫu còn thấp, không phải bằng chứng rằng mọi correction đều vô ích.

## Đánh giá rulebase từ text sạch

Rulebase được xây từ 2.773 câu train sạch, gồm 1.140 terms và 20.277 phrases. Trên 500 câu dev được tạo nhiễu bằng cách bỏ dấu, hệ thống khôi phục 4.329/10.682 token lỗi (40,5261%) với precision 99,1071% trên các token được thay đổi. Exact sentence recovery là 0% vì vocabulary chỉ bao phủ một phần câu.

Đây là synthetic validation cho lỗi mất dấu, không phải đánh giá correction trên lỗi ASR thật. Text sạch không tự cung cấp ánh xạ `ASR noisy → clean`.

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

## Thí nghiệm bổ sung — so sánh XLM-RoBERTa và PhoBERT NER

- Notebook: `ner_comparison_phobert_colab/NER_PhoBERT_RunAll.ipynb`, release `v9-full-validation-seeds`.
- Dataset: `leduckhai/VietMed-NER`, split `test`.
- Số mẫu: `3.497` cho cả hai model.
- Điều kiện: cùng test split, cùng manual first-subtoken alignment và cùng evaluator `seqeval`; PhoBERT được fine-tune từ `vinai/phobert-base-v2` trên cùng dataset.
- Tuning: 18 trial validation với learning rate `5e-6/1e-5/3e-5`, epoch `4/6/8`, weight decay `0.01/0.05`; sau đó chạy 3 seed `42/123/2024`. Test chỉ được đánh giá sau khi chọn cấu hình và seed bằng validation.
- Cấu hình chọn: learning rate `3e-5`, `8` epoch, weight decay `0.05`, warmup ratio `0.1`, linear scheduler; seed được chọn: `123`.
- Validation F1 ba seed: seed 42 `83.20%`, seed 123 `83.95%`, seed 2024 `83.17%`; mean `83.44%`, population std `0.36` điểm phần trăm.

| Model | Precision | Recall | F1 |
|---|---:|---:|---:|
| XLM-RoBERTa baseline | 51,82% | 62,78% | **56,78%** |
| PhoBERT best seed 123 | **56,20%** | **66,46%** | **60,90%** |

- PhoBERT cải thiện so với XLM-RoBERTa `+4,38` điểm phần trăm Precision, `+3,68` điểm phần trăm Recall và `+4,12` điểm phần trăm F1.
- Kết luận: sau full sweep và kiểm tra 3 seed, PhoBERT vượt XLM-RoBERTa trên gold NER benchmark; kết quả tốt hơn lần tuning trước (F1 `59,26%`).
- File kết quả: `colab/ner_gold_comparison.json`, `colab/validation_trials.jsonl`, `colab/best_config_seeds.json`.

### Kiểm tra trong pipeline audio ASR

- Dataset: `leduckhai/VietMed`, split `test`, `500` audio.
- ASR dùng chung: `leduckhai/MultiMed-ST/asr/whisper-small-vietnamese/checkpoint-5000`.
- WER trung bình của batch: `26,3446%`; WER bằng 0: `2/500`.
- Hai NER model xử lý cùng một transcript ASR; retention là consistency giữa prediction trên transcript chuẩn và ASR, không phải gold recall.

| Model | Entity matched | Entity trên reference | Entity retention |
|---|---:|---:|---:|
| XLM-RoBERTa baseline | 785 | 1.487 | 52,79% |
| PhoBERT best seed 123 | 741 | 1.391 | **53,27%** |

- PhoBERT retention cao hơn XLM-RoBERTa `0,48` điểm phần trăm.
- Kết luận thực tế: PhoBERT sau full tuning vượt baseline cả trên gold F1 và ASR retention, nên là ứng viên NER chính tốt nhất hiện tại. Mức tăng retention nhỏ, vì vậy vẫn cần ghi rõ đây là consistency metric, không phải gold recall.
- Artifacts: `colab/asr_ner_comparison_summary.json`, `colab/asr_ner_comparison.jsonl`, `colab/phobert-best-seed.zip`.
