# Nhật ký kết quả đồ án MultiMed

File này là nơi ghi các cấu hình, kết quả, diễn giải và quyết định thực nghiệm. Mỗi giai đoạn mới cần bổ sung một mục, không xóa các kết quả cũ. Roadmap các giai đoạn mở rộng correction nằm trong [ROADMAP_CORRECTION.md](ROADMAP_CORRECTION.md); plan triển khai hai phương án nằm trong [CORRECTION_IMPLEMENTATION_PLAN.md](CORRECTION_IMPLEMENTATION_PLAN.md).

## Giai đoạn 1 — 500 mẫu train

- Dataset: `leduckhai/VietMed`, split `train`.
- Số mẫu hoàn thành: `500/500`.
- Số mẫu lỗi: `0`.
- Giới hạn độ dài: `30` giây.
- ASR: `leduckhai/MultiMed-ST/asr/whisper-small-vietnamese/checkpoint-5000`.
- NER: `leduckhai/VietMed-NER/xlm-roberta-base-VietMed-NER`.
- Thiết bị: Google Colab GPU (T4).
- WER trung bình: `0.041218` (`4.12%`).
- WER trung vị: `0.0`.
- Mẫu WER bằng 0: `406/500` (`81.2%`).
- Tổng entity NER dự đoán: `1,278`.
- Phân bố entity lớn nhất: `ORGAN=309`, `DISEASESYMTOM=262`, `AGE=122`, `TREATMENT=95`.
- Kết luận: pipeline Audio → ASR → transcript → NER hoạt động ổn định; WER/NER trên split `train` chỉ là kết quả kiểm tra, không dùng làm số liệu tổng quát hóa chính.
- File nguồn ban đầu đã bị ghi đè/đổi tên khi tải kết quả test; `multimed_results_500_train/summary.json` hiện mang số liệu test (`mean_wer=0.261163`). WER train `0.041218` là số liệu đã ghi nhận từ lần chạy trước, nhưng không còn file summary train độc lập để xác minh.

## Giai đoạn 2 — đánh giá test set (đã hoàn thành)

- Notebook: `multimed_pipeline_colab.ipynb`.
- Dataset: `leduckhai/VietMed`, split `test` (xác nhận qua `utt_id_test_*`).
- Số mẫu hoàn thành: `500/500`.
- Số mẫu lỗi: `0` (file `errors.jsonl` rỗng).
- Giới hạn độ dài: `30` giây.
- ASR: `leduckhai/MultiMed-ST/asr/whisper-small-vietnamese/checkpoint-5000`.
- NER: `leduckhai/VietMed-NER/xlm-roberta-base-VietMed-NER`.
- Thiết bị: Google Colab GPU (T4).
- WER trung bình: `0.261163` (`26.12%`).
- WER trung vị: `0.25` (`25%`).
- Mẫu WER bằng 0: `2/500` (`0.4%`).
- WER cao nhất quan sát được: `0.928571`.
- Tổng entity NER dự đoán: `1,274`.
- Phân bố entity lớn nhất: `DISEASESYMTOM=226`, `ORGAN=175`, `DATETIME=114`, `GENDER=113`, `OCCUPATION=113`.
- Ví dụ tốt: mẫu `index=0` có WER `0.045455`, giữ được entity `biến chứng → DISEASESYMTOM`.
- Ví dụ lỗi ASR/NER: mẫu `index=1` có WER `0.321429`, `cắt túi mật` bị nhận thành `cắt cứu bật`; mẫu `index=3` nhận nhầm `công việc văn phòng` thành hai entity; mẫu `index=7` tách `ngưng` thành các mảnh `ng`/`ưng`.
- Kết luận: pipeline chạy ổn định trên test nhưng chất lượng tổng quát hóa thấp hơn train rõ rệt; WER test `26.12%` là số liệu chính cần báo cáo, còn các entity hiện mới là dự đoán chưa có gold NER để tính Precision/Recall/F1.
- File nguồn: `multimed_results_500_train/summary (1).json`, `summary (1).csv`, `results (1).jsonl`; tên thư mục giữ nguyên do file test được tải đè/đổi tên trong quá trình tải về.

## Giai đoạn 3 — so sánh NER trên transcript chuẩn và ASR (đã hoàn thành)

- Notebook: `multimed_pipeline_colab.ipynb`.
- Dataset: `leduckhai/VietMed`, split `test`, 500 mẫu.
- ASR: `leduckhai/MultiMed-ST/asr/whisper-small-vietnamese/checkpoint-5000`.
- NER: `leduckhai/VietMed-NER/xlm-roberta-base-VietMed-NER`.
- Thiết bị: Google Colab GPU (T4).
- Số mẫu so sánh: `500`; lỗi runtime: `0`.
- Entity do NER dự đoán trên transcript chuẩn: `1,487`.
- Entity do NER dự đoán trên transcript ASR: `1,274`.
- Entity trùng theo cặp chuẩn hóa `text + label`: `800`.
- Tỷ lệ giữ lại so với dự đoán trên transcript chuẩn: `53.80%`.
- Consistency precision/recall/F1 lần lượt: `62.79% / 53.80% / 57.95%`.
- Các tỷ lệ trên là consistency metrics giữa hai lần dự đoán của cùng model, không phải Precision/Recall/F1 gold vì VietMed không có nhãn NER chuẩn.
- Ví dụ tác động ASR: `cắt túi mật` → `cắt cứu bật`, khiến entity phẫu thuật bị đổi span; `ngưng` bị tách thành `ng` và `ưng`; `triệu chứng` thành `triệu chứng lập sàng`.
- Kết luận: lỗi ASR làm giảm đáng kể độ nhất quán của NER; transcript chuẩn tạo nhiều entity hơn và giữ lại entity tốt hơn. Cần đánh giá NER trên gold labels trước khi tuyên bố chất lượng NER.
- File nguồn: `multimed_results_500_test/ner_comparison_summary.json`, `ner_comparison.csv`, `ner_comparison.jsonl`, `errors.jsonl`.

## Giai đoạn 4 — đánh giá NER bằng gold labels (đã hoàn thành)

- Lỗi lần đầu: dataset ID `yuufong/vietmed_ner_v5` không tồn tại/không truy cập được (`DatasetNotFoundError`). Đây là ID cũ trong source, không phải lỗi token của người dùng.
- Dataset chính thức: `leduckhai/VietMed-NER`, split `test`, schema gồm `words`, `tags`, `labels`, `text`, `audio`, `duration`.
- Model: `leduckhai/VietMed-NER/xlm-roberta-base-VietMed-NER`.
- Số mẫu đánh giá: `3,497`.
- Phương pháp: dùng trực tiếp cột `labels` làm BIO gold, chuẩn hóa nhãn nền `0` thành `O`, ánh xạ dự đoán của subword đầu tiên về từng word, tính entity-level metrics bằng `seqeval`.
- Overall micro Precision: `52.58%`.
- Overall micro Recall: `66.2389%`.
- Overall micro F1: `58.6243%`.
- Macro average: Precision `43.5589%`, Recall `57.3819%`, F1 `48.3849%`.
- Weighted average F1: `59.3108%`.
- Nhãn F1 cao: `OCCUPATION=87.9599%`, `DRUGCHEMICAL=76.1162%`, `DATETIME=70.8148%`, `FOODDRINK=68.3625%`.
- Nhãn F1 thấp: `ORGANIZATION=9.8039%`, `PREVENTIVEMED=0%`, `TRANSPORTATION=0%`, `MEDDEVICETECHNIQUE=14.2721%`, `PERSONALCARE=32.8829%`.
- Kết luận: model có recall cao hơn precision, nghĩa là bắt được nhiều entity nhưng có nhiều dự đoán thừa/sai; hiệu năng không đồng đều giữa các nhãn và bị ảnh hưởng bởi nhãn ít mẫu. Đây là NER F1 chính thức trên gold test labels, khác với consistency F1 `57.95%` của Giai đoạn 3.
- Lưu ý báo cáo: ưu tiên nêu micro F1 `58.6243%` và macro F1 `48.3849%` cùng nhau; không chỉ nêu một nhãn tốt nhất. Các metrics dựa trên word-level alignment với nhãn subword đầu tiên.
- File nguồn: `giai_doan_4/ner_gold_metrics.json`, `results.jsonl`, `summary.csv`, `summary.json`.

## Giai đoạn 5 — phân tích lỗi và so sánh cuối (đã hoàn thành)

- Notebook: `multimed_pipeline_colab.ipynb`, phân tích 500 mẫu test của Giai đoạn 2–3.
- Lỗi runtime: `0`.
- Phân nhóm WER và entity retention:
  - `0%`: 2 mẫu (`0.4%`), WER trung bình `0%`, retention `100%` (3/3 entity).
  - `0–10%`: 34 mẫu (`6.8%`), WER trung bình `7.5291%`, retention `80.4878%` (66/82 entity).
  - `10–30%`: 317 mẫu (`63.4%`), WER trung bình `20.9297%`, retention `59.6509%` (581/974 entity).
  - `>30%`: 147 mẫu (`29.4%`), WER trung bình `41.9554%`, retention `35.0467%` (150/428 entity).
- Tổng có trọng số: 800/1,487 entity giữ nguyên `text + label`, retention `53.7996%`; đây là consistency metric, không phải NER gold recall.
- Tương quan Pearson giữa WER và retention theo mẫu: `-0.405867`, cho thấy xu hướng nghịch vừa phải: WER tăng thường làm giảm entity được giữ lại, nhưng không phải quan hệ tuyệt đối.
- Case study tiêu biểu: WER `88.8889%` làm mất `mụn` và `tác dụng phụ`; WER `77.7778%` làm mất các entity liên quan `đặt vòng`, `que tránh thai`, `thai`; WER `66.6667%` biến các entity thuốc/điều trị thành dự đoán sai `uống uống → PERSONALCARE`; WER `40%` biến `chảy máu não` thành `chày máu não` nhưng NER vẫn dự đoán triệu chứng và cơ quan.
- Biểu đồ đã tạo: `stage5_error_analysis.png` (WER theo nhóm và phân bố entity ASR); bảng: `error_analysis_by_sample.csv`, `error_analysis_by_wer_group.csv`; case study: `case_studies.json`; summary: `stage5_summary.json`.
- Tất cả file nằm trong thư mục local `giai_doan_5/` sau khi tải từ `/content/multimed_results_500_test/`.
- Lưu ý: entity trên transcript chuẩn cũng là dự đoán của model, không phải gold; chỉ Giai đoạn 4 dùng gold labels.
- Kết luận: nhóm `>30%` chiếm `29.4%` mẫu và chỉ giữ lại `35.05%` entity, là điểm nghẽn chính của pipeline. Cần dùng các case study này cho phần phân tích lỗi và không nên tinh chỉnh threshold chỉ dựa trên confidence.

## Giai đoạn 6 — hoàn thiện bảng kết quả và báo cáo (đã hoàn thành bản nháp)

- Bản nháp báo cáo: `DO_AN_REPORT.md`.
- Dàn ý slide: `SLIDES_OUTLINE.md`.
- Bảng kết quả cuối đã kết hợp: ASR train WER `4.1218%` (chỉ kiểm tra), ASR test WER `26.1163%`, NER gold micro F1 `58.6243%`, NER gold macro F1 `48.3849%`, consistency retention `53.7996%`.
- Đã ghi rõ sự khác nhau giữa train/test, gold metrics và consistency metrics; không gọi consistency F1 `57.95%` là gold F1.
- Đã ghi hạn chế: test pipeline 500 mẫu, NER gold đánh giá 3.497 mẫu, word-level alignment, nhãn hiếm và không dùng hệ thống để chẩn đoán.
- Checklist hoàn thiện: chạy lại notebook sạch nếu cần, kiểm tra số liệu trong báo cáo với file JSON nguồn, chụp demo pipeline, hoàn thiện slide và luyện thuyết trình.
- Trạng thái: phần thực nghiệm và bản nháp nội dung đã đủ; các bước còn lại chủ yếu là biên tập/đóng gói nộp.

## Giai đoạn 7 — kiểm tra và hoàn thiện thực nghiệm (đã hoàn thành)

- Đã kiểm tra `multimed_results_500_test/results.jsonl`: 500 dòng, 500 index duy nhất.
- Đã kiểm tra `multimed_results_500_test/summary.json`: 500 mẫu, WER trung bình `26.1163%`, khớp với báo cáo.
- Đã kiểm tra `giai_doan_4/ner_gold_metrics.json`: 3.497 mẫu, micro F1 `58.6243%`, khớp với báo cáo.
- Đã kiểm tra `giai_doan_5/stage5_summary.json`: 500 mẫu; tổng các nhóm WER bằng 500; retention tổng `53.7996%` khớp với consistency summary.
- Đã kiểm tra `multimed_results_500_test/errors.jsonl`: rỗng, không có lỗi runtime.
- Đã làm sạch `multimed_pipeline_colab.ipynb`: JSON hợp lệ, 20 cell, không còn output/execution state cũ; 15 cell Python thuần parse thành công.
- Đã xác nhận notebook chứa dataset chính thức `leduckhai/VietMed-NER` và output Giai đoạn 5.
- Cảnh báo dữ liệu cũ: `multimed_results_500_train/summary.json` từng mang số liệu test do bị ghi đè; không dùng thư mục đó làm nguồn train chính.
- Kết luận: các kết quả test, NER gold và phân tích lỗi có thể dùng cho báo cáo; train rerun đã khôi phục nguồn độc lập.

## Giai đoạn 7c — xác nhận train rerun (đã hoàn thành)

- Notebook: `multimed_train_colab.ipynb`.
- Dataset: `leduckhai/VietMed`, split `train`.
- Số mẫu: `500/500`, index `0–499`, 500 index duy nhất.
- Số lỗi: `0`; `errors.jsonl` rỗng.
- WER trung bình: `0.041218` (`4.1218%`).
- WER trung vị: `0.0`; WER=0: `406/500` (`81.2%`).
- Tổng entity dự đoán: `1,278`.
- Kết quả khớp với số liệu train đã ghi nhận trước đó.
- Nguồn độc lập mới: `multimed_results_500_train_rerun/summary.json`, `summary.csv`, `results.jsonl`, `errors.jsonl`.
- Kết luận: đã khôi phục được so sánh train/test mà không phụ thuộc thư mục train từng bị ghi đè.

## Giai đoạn 7b — tách notebook train/test (đã hoàn thành)

- Notebook train: `multimed_train_colab.ipynb`, 500 mẫu `leduckhai/VietMed/train`, output `/content/multimed_results_500_train_rerun/`.
- Notebook test: `multimed_test_colab.ipynb`, 500 mẫu `leduckhai/VietMed/test`, output `/content/multimed_results_500_test_rerun/`; giữ thêm NER gold và phân tích lỗi.
- Hai notebook được tạo từ bản sạch, xóa toàn bộ output/execution state, JSON hợp lệ và các cell Python parse thành công.
- Mục đích: chạy lại train mà không ghi đè test hoặc kết quả cũ; đây là biện pháp khắc phục việc thư mục train trước đó bị ghi đè.

## Giai đoạn 8 — hoàn thiện báo cáo và slide (đã hoàn thành bản đóng gói)

- Đã dọn file trùng/thử nghiệm: notebook gộp cũ, output mẫu cũ và các thư mục kết quả bị ghi đè đã được loại khỏi workspace.
- Đã giữ lại notebook tách riêng: `multimed_train_colab.ipynb` và `multimed_test_colab.ipynb`.
- Đã tạo `SUBMISSION_CHECKLIST.md`.
- Đã tạo/cập nhật `DO_AN_REPORT.md`, `FINAL_RESULTS.md`, `SLIDES_OUTLINE.md`, `DEMO_GUIDE.md`, `SUBMISSION_CHECKLIST.md`.
- Đã bổ sung tài liệu tham khảo, placeholder thông tin nhóm và kịch bản demo có phương án dự phòng.
- Cảnh báo trước cleanup đã được xử lý: artifact `multimed_results_500_train_rerun/` hiện đã được tải lại và xác minh độc lập.
- Đối chiếu cuối: train rerun đủ 500 mẫu/0 lỗi; nguồn test chính thức hiện lưu trong `giai_doan_5/` (summary test, comparison và error analysis), đủ các file cần thiết; NER gold lưu trong `giai_doan_4/`.
- Điền thông tin nhóm/trường/giảng viên.
- Chèn bảng `FINAL_RESULTS.md`, biểu đồ Giai đoạn 5 và 3–5 case study.
- Hoàn thiện tài liệu tham khảo, demo và luyện thuyết trình.

## Quy tắc báo cáo các giai đoạn tiếp theo

Mỗi lần chạy cần lưu:

1. Cấu hình dataset/split/index/model/device.
2. Số mẫu thành công và số mẫu lỗi.
3. WER (nếu có transcript chuẩn).
4. Entity count và label distribution.
5. Ít nhất 3–10 ví dụ lỗi hoặc ví dụ tiêu biểu.
6. Kết luận ngắn và quyết định bước tiếp theo.
7. Đường dẫn tới các file JSONL/CSV/summary/error.
