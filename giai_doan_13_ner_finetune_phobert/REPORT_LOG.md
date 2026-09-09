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
- Notebook full project mới: `multimed_full_project_colab.ipynb`, bao phủ baseline, Normalize, Correction tùy chọn, NER gold, phân tích lỗi, biểu đồ, report và ZIP export; output mặc định `/content/multimed_full_project_results/`.
- Correction mặc định `RUN_CORRECTION=False` vì repo chưa có checkpoint correction hợp lệ; notebook không ghi số liệu Correction giả.
- Full project run đã chạy thành công trên Colab: ZIP có 9 file, baseline/normalize/correction đều có 500 records, NER gold `3,497` mẫu và `zip_test=None`.
- Full project summary: baseline mean WER `0.261163`; Normalize thay đổi `0/500`; Correction status `not_run`; gold NER micro F1 `58.6243%`.
- Full project group summary: WER `0–10%` có 36 mẫu, retention `100%`; `10–30%` có 317 mẫu, retention `100%`; `>30%` có 147 mẫu, retention `100%`. Đây là do Normalize hình thức không thay đổi transcript, không phải ASR-to-reference entity retention của Giai đoạn 5; dùng `giai_doan_5/stage5_summary.json` cho retention baseline chính thức.
- Full notebook đã gặp lỗi khi ghi `ner_gold_metrics.json`: `seqeval` trả về `numpy.int64` ở `support`; đã sửa cell NER gold bằng cách ép `support` về `int` và metric về `float`, đồng thời làm sạch output notebook. Cần upload bản notebook hiện tại và chạy lại cell NER gold nếu gặp lỗi cũ.
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

## Giai đoạn 9 — rule-based normalization (đã hoàn thành)

- Input: `giai_doan_5/results.jsonl`, 500 ASR test records; baseline không bị sửa.
- Luật an toàn: Unicode NFC, control characters → space, khoảng trắng quanh dấu câu, gộp whitespace và trim.
- Số transcript thay đổi: `0/500`; số lần áp dụng luật: `0`.
- WER baseline: `26.1163%`; WER sau normalization: `26.1163%`.
- Entity baseline: `1,274`; entity normalized: `1,274`; entity match: `1,274`; consistency: `100%`.
- Không cần load lại NER vì normalized transcript giống hệt ASR transcript; nhánh Normalize đã được kiểm tra nhưng là no-op trên batch test hiện tại.
- Kết luận: normalization hình thức không cải thiện WER/NER nhưng không gây regression. Các sửa ngữ nghĩa như `cắt cứu bật → cắt túi mật` chưa được triển khai.
- Output: `giai_doan_9_normalize/normalize_results.jsonl`, `normalize_summary.json`, `normalize_comparison.csv`, `normalization_rules.json`, `normalization_case_studies.json`.

## Giai đoạn 10 — medical lexicon correction (tiếp theo)

- Chỉ triển khai lexicon từ train/validation, không dùng test reference.
- Mục tiêu: thử sửa lỗi ASR thuật ngữ y khoa và đo WER/NER trước-sau.

## Giai đoạn 11 — canonical text rulebase và synthetic validation (đã hoàn thành)

- Corpus source: `giai_doan_10_text_rulebase/train_text.jsonl` (`2,773` câu train sạch) để xây vocabulary; validation: `dev_text.jsonl` (`2,912` câu), chỉ tạo synthetic noise mất dấu.
- Rulebase: `1,140` canonical terms và `20,277` canonical phrases (min count `2`, n-gram tối đa `5`); output `giai_doan_11_text_rulebase/`.
- Corrector: canonicalize Unicode/whitespace, phrase dài trước, accent-insensitive matching, similarity/margin bảo thủ, bảo vệ số/ký hiệu và log source/target/score/support.
- Synthetic validation: `500` câu dev; `10,682` token lỗi mất dấu; khôi phục `4,329` token (`40.5261%`); `39` token sửa sai; precision trên token thay đổi `99.1071%`; exact sentence recovery `0%` vì rulebase chỉ bao phủ một phần vocabulary.
- Kết luận: rulebase sửa mất dấu có precision cao nhưng recall/coverage còn hạn chế; không được gọi đây là ASR correction thực tế. Chưa áp dụng test thật trong giai đoạn này vì chưa có noisy→clean ASR pairs đầy đủ.
- Files: `text_rulebase.py`, `build_canonical_rulebase.py`, `apply_text_rulebase.py`, `validate_text_rulebase.py`, `canonical_terms.json`, `canonical_phrases.json`, `rulebase_metadata.json`, `synthetic_validation.jsonl`, `synthetic_validation_metrics.json`.

## Giai đoạn 10a — tải text-only cho rulebase (đã hoàn thành)

- Notebook: `text_rulebase_colab.ipynb`; script local: `build_text_rulebase.py`.
- Chỉ tải các cột text/metadata nhẹ, không tải/giải mã audio và không chạy ASR/NER.
- Đã tải thành công `train=2,773`, `dev=2,912`, `test=3,437`, `cv=85`, tổng `9,207` records.
- Xuất corpus local trong `giai_doan_10_text_rulebase/`: mỗi split JSONL, `text_corpus_summary.json`, `term_frequency.json`; đây là transcript chuẩn, không phải ASR noisy transcript.
- Lexicon vẫn `0` rule vì builder chỉ có 500 cặp ASR/reference train mẫu, không dùng text chuẩn một mình để tạo lỗi ASR.
- Lần chạy đầu lỗi HTTP `429 Too Many Requests` tại API liệt kê split; đã sửa script/notebook bỏ API metadata, thử trực tiếp split và chạy thành công.
- Không dùng `test` để xây rule; chỉ dùng train/dev cho corpus/validation.

## Giai đoạn 10 — medical lexicon correction (đã hoàn thành thí nghiệm pilot; chờ corpus train đầy đủ)

- Input train: `multimed_results_500_train_rerun/results.jsonl`, 500 dòng đầu của train; tách deterministic `400` dòng induction (index `0–399`) và `100` dòng validation (index `400–499`).
- Input test: `giai_doan_5/results.jsonl`, 500 dòng; test reference chỉ dùng để tính WER sau khi lexicon đã freeze.
- Thuật toán: căn chỉnh Levenshtein token-level, chỉ giữ substitution 1 token → 1 token; loại stopword/token ngắn; yêu cầu `min_support=2`, `min_dominance=0.8`.
- Rule hợp lệ: `0`; validation áp dụng: `0`; test transcript thay đổi: `0/500`.
- WER test baseline: `26.1163%`; WER sau lexicon: `26.1163%`.
- Kết luận: thí nghiệm không cải thiện WER, nhưng không gây regression và không có leakage. Kết quả âm tính là hợp lệ vì artifact train chỉ có 500 mẫu và các lỗi thuật ngữ không lặp đủ để tạo rule bảo thủ. Không nới ngưỡng hoặc lấy test reference để ép tạo rule.
- Giới hạn: `multimed_results_500_train_rerun` là prefix 500 mẫu, không phải toàn bộ train; cần chạy thêm dữ liệu train/validation độc lập nếu muốn xây lexicon có độ phủ tốt hơn.
- Notebook tạo corpus đầy đủ: `multimed_full_train_asr_colab.ipynb`; output `/content/multimed_train_asr_full/`, có pilot `MAX_RECORDS=500`, đặt `None` để chạy toàn bộ và resume.
- Notebook correction model độc lập đã tạo: `multimed_correction_model_colab.ipynb`; output `/content/multimed_correction_model/`; mặc định `RUN_TRAIN=False`, `RUN_TEST=False`, correction chưa phải kết quả chính thức.
Đã ghi nhận lỗi Vit5/T5 `Unigram vocab dict` và generation collapse v5. Notebook v6 dùng `google/byt5-small`, chỉ noise mất dấu, audit byte length/lọc cặp vượt cap, smoke-overfit model clone, prefix `correct:`, decoding chống lặp và tự dừng trước test nếu validation WER không giảm. Bản upload v8: `colab_upload_correction/multimed_correction_model_colab_byt5_v8_train_diagnostic.ipynb`; notebook này train, lưu `final_checkpoint` và diagnostic validation trong một lần Run all. cell cấu hình là Code. Trainer v6 tự phát hiện API runtime bằng `inspect.signature`: chọn `eval_strategy`/`evaluation_strategy` và `processing_class`/`tokenizer`, dùng `warmup_steps=100`; sau khi map dữ liệu có thể chạy lại từ cell full train. Sau khi cài package nên Restart session Colab một lần.
- Thư mục upload Colab đã chuẩn bị: `colab_upload_correction/`, gồm notebook correction, `train_text.jsonl`, `dev_text.jsonl` và `README.md`; không chứa model/cache/.venv/output cũ.
- Output: `giai_doan_10_lexicon/lexicon_rules.json`, `lexicon_validation_metrics.json`, `correction_results.jsonl`, `correction_summary.json`, `correction_case_studies.json`.

## Đánh giá rulebase từ toàn bộ text (đã ghi nhận)

- Rulebase canonical được xây từ `giai_doan_10_text_rulebase/train_text.jsonl` gồm `2,773` câu, không dùng text test.
- Vocabulary gồm `1,140` terms và `20,277` phrases; fuzzy corrector chỉ chấp nhận khớp không dấu tuyệt đối, ưu tiên phrase dài và abstain khi không chắc.
- Synthetic dev validation (500 câu, lỗi bỏ dấu): khôi phục `4,329/10,682` token (`40.5261%`), precision trên token thay đổi `99.1071%`, exact sentence recovery `0%`.
- Kết luận: rulebase phù hợp prototype và sửa lỗi mất dấu với precision cao, nhưng coverage hạn chế; chưa chứng minh sửa lỗi ASR ngữ âm như `cắt cứu bật → cắt túi mật` vì text sạch không chứa ánh xạ noisy→clean.
- Không dùng kết quả synthetic làm ASR WER hoặc NER gold F1.

## Giai đoạn 12 — correction model lần 1 (không đạt, đã xác nhận)

- Model: `google/byt5-small`; checkpoint: `/content/multimed_correction_model_byt5/final_checkpoint`.
- Validation: `987` pairs synthetic.
- WER trước correction: `0.3228137441940095` (`32.2814%`).
- WER sau correction: `1.0` (`100%`).
- Exact recovery: `0`.
- Kết luận: checkpoint không dùng được; model chưa học nhiệm vụ hoặc sinh output không hợp lệ. Không chạy test và không đưa checkpoint này vào pipeline chính.
- Cảnh báo provenance: output validation ghi checkpoint final nhưng cần kiểm tra log train/model output; không được suy ra model đã học chỉ vì file checkpoint tồn tại.
- Hành động tiếp theo: chạy chẩn đoán 10 dự đoán (noisy/target/predicted), kiểm tra output rỗng/lặp, chỉ huấn luyện một loại noise mất dấu trước, dùng toàn bộ `2,773` train text nếu phù hợp, tăng epoch/learning rate có kiểm soát, và chỉ chạy test khi WER validation giảm rõ ràng.

## Giai đoạn 11 — so sánh ba pipeline (tiếp theo)

- Baseline và Normalize đã có số liệu; Lexicon correction pilot hiện trùng Baseline vì không có rule áp dụng.
- Chỉ đưa Lexicon vào bảng cuối với trạng thái `no_valid_rules`/`not_improved`, không trình bày như correction thành công.

## Giai đoạn 12k — BARTpho v2 ưu tiên real-ASR (đã chuẩn bị)

- Notebook dữ liệu: `bartpho_build_finetune_data_v2_colab.ipynb`; notebook train: `bartpho_correction_finetune_v2_colab.ipynb`.
- Cấu hình: oversample 4x các cặp real-ASR train, synthetic accent giới hạn 1/4 train text, identity khoảng 10%; giữ 20% real-ASR làm holdout.
- Notebook train tự upload/giải nén ZIP v2, smoke 64 cặp, fine-tune BARTpho 4 epochs, đánh giá synthetic và real holdout riêng, tạo checkpoint và ZIP cuối.
- Đã sửa import `shutil` để cell ZIP hoạt động; cả notebook data/train parse hợp lệ.
- Output riêng: `/content/multimed_correction_bartpho_v2/`; không ảnh hưởng artifact cũ.

## Phân tích 18 mẫu real-ASR holdout BARTpho

- Model chủ yếu copy lại ASR noisy; nhiều mẫu prediction gần như giống input và không sửa lỗi âm vị/thuật ngữ.
- Có một số thay đổi hình thức nhỏ như `giờ → bây giờ`, nhưng không khôi phục các lỗi quan trọng như `chày máu não → chảy máu não`, `phăn phòng → văn phòng`, `nôn na → nôm na`, `lày mẫu → lấy mẫu`.
- Một số prediction còn drift nội dung: `mạch máu → mạch nước`, `bác sĩ → người ta`, `dạ dày → miệng nối`, nhưng chưa gây output rỗng.
- Real holdout WER tăng `0.2769061 → 0.2865261`; cải thiện synthetic không chuyển sang ASR thật.
- Kết luận: dữ liệu thật dùng train quá ít (400 mẫu train sau holdout 20%) và synthetic chiếm ưu thế; model chưa học được lỗi âm vị/thuật ngữ ASR. Cần thêm ASR noisy/reference thật, không chỉ tăng epoch.

## Giai đoạn 12j — BARTpho validation với identity/safety filter (WER tốt, semantic drift còn)

- Validation: `1,000` accent-restoration pairs; WER identity `0.8761635884`.
- WER raw BARTpho: `0.2640599623` (`26.4060%`); WER sau safety filter: `0.2640599623`; exact recovery `16/1000`.
- Fallback rate: `0/1000`; tất cả output bị filter đánh dấu `accepted`.
- Phát hiện quan trọng: WER giảm mạnh nhưng output vẫn semantic drift, ví dụ `nhiễm khuẩn → nhiễm khuẩn khu trú`, `khẩu trang → khắc phục`, `giấy xét nghiệm → cấy ghép chống viêm`, `tổ chức thực hiện → tỏa nhiệt thực`. Filter hiện chỉ bảo vệ số/đơn vị/mã, chưa bảo vệ thuật ngữ y khoa và nội dung chính.
- Kết luận: BARTpho tốt trên metric synthetic nhưng chưa đạt yêu cầu an toàn y khoa; chưa chạy test audio và chưa chọn làm pipeline chính.
- Notebook mở rộng dữ liệu: `bartpho_build_finetune_data_colab.ipynb`; kết hợp 500 cặp ASR train thật với synthetic/identity pairs từ train text, giữ real-ASR holdout và tạo ZIP dữ liệu. Guard không cho dùng `giai_doan_5/results.jsonl`/test để train.
- Notebook fine-tune mới: `bartpho_correction_finetune_colab.ipynb`; tự upload/giải nén corpus ZIP, smoke 64 cặp, fine-tune BARTpho, đánh giá synthetic + real-ASR holdout và download ZIP checkpoint/metrics riêng.
- Bước tiếp theo: thêm semantic-preservation filter dựa trên content-token overlap/canonical medical vocabulary và kiểm tra thủ công; chấp nhận fallback về ASR nếu thay đổi nội dung quá lớn. Không tối ưu WER đơn độc.

## Giai đoạn 12i — BARTpho correction model validation (cải thiện WER nhưng chưa đạt an toàn)

- Model: `vinai/bartpho-syllable-base`; notebook `bartpho_correction_colab.ipynb`; output `/content/multimed_correction_bartpho/`.
- Validation: `1,000` cặp accent restoration.
- WER identity: `0.87616358842367` (`87.6164%`).
- WER sau BARTpho: `0.27162297679127145` (`27.1623%`).
- Exact recovery: `16/1,000`; empty output: `0`.
- Kết luận tích cực: BARTpho vượt identity baseline rõ rệt và tốt hơn các lần ByT5/ViT5 trước trên metric WER synthetic.
- Kết luận an toàn: output vẫn có semantic drift nguy hiểm trên y tế, ví dụ `nhiễm khuẩn → nhiễm xạ khuất`, `đeo khẩu trang → để kiểm soát`, `cắt/lấy mẫu → làm mau`, `giấy → giáy`, `giấy xét nghiệm → cấy ghép mô`. Vì vậy chưa chạy test audio và chưa đưa model vào pipeline chính.
- Quyết định: giữ checkpoint như candidate nghiên cứu; cần thêm metric bảo toàn nội dung, identity pairs/ASR-noisy pairs và kiểm tra thuật ngữ/số/phủ định trước khi freeze.

## Giai đoạn 12h — BARTpho correction model (đã chuẩn bị notebook)

- Notebook: `bartpho_correction_colab.ipynb`; model: `vinai/bartpho-syllable-base`; output riêng `/content/multimed_correction_bartpho/`.
- Có round-trip tokenizer/vocab check trước train, accent-only pairs, identity pairs, lọc độ dài, smoke model clone tối đa 64 mẫu/100 steps, full train 3 epochs và validation WER guard.
- Đã bổ sung safety filter bảo vệ số/đơn vị/mã y khoa và fallback output bất thường; cell cuối tạo `artifact_manifest.json` và download `/content/multimed_correction_bartpho_results.zip`.
- Đã nâng cấp semantic safety filter: tách `raw_output`/`safe_output`, kiểm tra multiset protected atoms, phủ định, repetition, content-token precision/recall và length ratio; WER raw/safe được tính độc lập. Output mới lưu `semantic_safety_results.jsonl` và status/reason từng mẫu.
- Đã sửa lỗi validation `NameError: statistics is not defined` bằng cách import `statistics` ở cell đầu; bản upload BARTpho đã đồng bộ. Có thể chạy lại từ cell semantic validation, không cần train lại nếu model/biến còn trong runtime.
- Đã sửa cell smoke có `with` viết cùng dòng gây SyntaxError; notebook hiện parse hợp lệ và bản upload đã đồng bộ.
- Không ảnh hưởng ViT5/ByT5/Baseline/Normalize/rulebase artifacts.

## Giai đoạn 12g — ViT5 correction model lần 1 (không đạt, output rỗng)

- Notebook: `vit5_correction_colab.ipynb`; model: `VietAI/vit5-base`; output `/content/multimed_correction_vit5/`.
- Validation: `1,000` cặp accent restoration.
- WER trước: `0.87616358842367`; WER sau: `1.0`.
- Exact recovery: `0`; empty outputs: `1,000/1,000`.
- Kết luận: model sinh EOS/rỗng ngay lập tức hoặc tokenizer/decoder configuration không tương thích; đây là collapse nghiêm trọng, không chạy test và không dùng checkpoint.
- Cần kiểm tra lần sau: `decoder_start_token_id`, `pad/eos_token_id`, tokenizer/model round-trip, label padding, train loss và output ngay sau smoke step. Không tiếp tục tăng epoch trên checkpoint này.

## Giai đoạn 12f — ViT5 correction model (đã chuẩn bị notebook, chưa chạy)

- Notebook độc lập: `vit5_correction_colab.ipynb`.
- Model: `VietAI/vit5-base`; tokenizer chậm `T5Tokenizer`; output riêng `/content/multimed_correction_vit5/`.
- Cấu hình: accent restoration, train `2,773` cặp, validation `1,000` cặp, max length `256`, 3 epochs, learning rate `2e-5`, batch `1`, gradient accumulation `8`.
- Notebook có audit/filter cặp quá dài, lưu `data_audit.json`, checkpoint `final_checkpoint`, validation WER và 10 prediction samples.
- Không ảnh hưởng ByT5 v5/v6/v8, Baseline, Normalize hoặc rulebase.
- Sau cài dependency cần Restart session Colab; chỉ dùng ViT5 notebook mới, không dùng notebook ByT5 cũ.
- Trainer ViT5 đã được sửa để tự phát hiện `eval_strategy`/`evaluation_strategy` và `processing_class`/`tokenizer`, tránh lỗi API runtime Colab; bản upload đã đồng bộ.
- Notebook debug smoke riêng: `vit5_debug_smoke_colab.ipynb`; kiểm tra spiece/tokenizer/config/label padding, output trước-sau và chỉ train 64 cặp tối đa 200 steps; không train full/test.
- Notebook hướng 1 bundle mới: `vit5_tokenizer_bundle_debug_colab.ipynb`; tải toàn bộ tokenizer bundle cùng revision bằng `snapshot_download`, kiểm tra vocab/model round-trip trước smoke; output `/content/multimed_vit5_bundle_debug/`; không train full/test.
- Hướng 1 thất bại lần cuối ngay tại `T5Tokenizer.from_pretrained(BUNDLE_DIR)` với lỗi Rust `Unigram vocab dict` trên Colab Python 3.13 dù bundle đã đồng nhất; không tiếp tục ViT5. Chuyển sang hướng 2 BARTpho.

## Giai đoạn 12e — correction model v8 (không đạt, đã xác nhận)

- Notebook: `multimed_correction_model_colab_byt5_v8_train_diagnostic.ipynb`; model: `google/byt5-small`.
- Validation: `1,000` cặp accent restoration; train `2,773` cặp.
- WER identity: `0.87616358842367`; WER sau correction: `1.03776549341615`; exact recovery: `0`.
- Output mẫu cho thấy hallucination, đảo/trộn nội dung và câu bị cắt; một số output chứa ký tự/chuỗi không liên quan. Đây không phải chỉ là lỗi dấu.
- Warning `early_stopping` bị Transformers bỏ qua không phải nguyên nhân chính; decoding vẫn có guard no-repeat/length.
- Guard dừng trước test; checkpoint v8 không dùng cho pipeline chính.
- Kết luận: v8 không giải quyết được accent restoration dù đã audit byte length, smoke clone, prefix và decoding guard. Không tiếp tục tăng epoch cùng thiết kế; cần đổi dữ liệu/model hoặc dừng nhánh neural correction.

## Giai đoạn 12c — correction model v6 (ổn định hơn nhưng chưa đạt)

- Notebook: `multimed_correction_model_colab_byt5_v6.ipynb`; model: `google/byt5-small`; output riêng `/content/multimed_correction_model_byt5_v6/`.
- Validation: `1,000` cặp accent restoration.
- WER identity/noisy trước: `0.87616358842367` (`87.6164%`).
- WER sau correction: `1.03776549341615` (`103.7765%`).
- Exact recovery: `0`; empty outputs: `0`; repeated outputs: `0`.
- Smoke test: exact `0`, empty `0`, repeated `0`.
- Guard đã dừng trước test vì WER sau vẫn cao hơn identity baseline.
- So với v5, generation collapse đã giảm mạnh (v5 WER sau `1.8269`), nhưng model vẫn chưa học được accent restoration đủ tốt.
- Kết luận: checkpoint v6 không được dùng cho test/pipeline chính. Baseline, Normalize và rulebase không bị ảnh hưởng.
- Bước tiếp theo: notebook `multimed_correction_model_colab_byt5_v7_diagnostic.ipynb` chỉ inference checkpoint v6, lưu prediction từng mẫu, WER/character/length/repetition diagnostics và sample outputs; không train/test.

## Giai đoạn 12b — correction model v5 (không đạt, đã xác nhận)

- Notebook: `multimed_correction_model_colab_byt5_v5.ipynb`; model: `google/byt5-small`.
- Dữ liệu: `2,773` train text, `1,000` validation text; chỉ noise bỏ dấu.
- WER validation trước: `0.87616358842367` (`87.62%`).
- WER validation sau: `1.8269478531259733` (`182.69%`).
- Exact recovery: `0/1,000`.
- Output quan sát: model lặp lại các đoạn input, cắt câu và không khôi phục dấu; đây là generation collapse, không phải cải thiện correction.
- Guard đã hoạt động và dừng trước test (`Validation chưa cải thiện; dừng trước test.`).
- Checkpoint `/content/multimed_correction_model_byt5_v5/final_checkpoint` không được dùng cho test/pipeline chính.
- Kết luận: correction model v5 thất bại trên validation; cần sửa dữ liệu/cấu hình/model trước khi thử test. Baseline, Normalize và rulebase vẫn không bị ảnh hưởng.

## Thí nghiệm bổ sung — so sánh XLM-RoBERTa và PhoBERT NER (đã hoàn thành)

- Notebook: `ner_comparison_phobert_colab/NER_PhoBERT_RunAll.ipynb`, release `v9-full-validation-seeds`.
- Dataset: `leduckhai/VietMed-NER`, split `test`, `3,497` mẫu.
- Baseline: `leduckhai/VietMed-NER/xlm-roberta-base-VietMed-NER`; model so sánh: `vinai/phobert-base-v2`.
- Tuning: 18 trial validation với learning rate `5e-6/1e-5/3e-5`, epoch `4/6/8`, weight decay `0.01/0.05`; 3 seed `42/123/2024`; test chỉ chạy sau lựa chọn validation.
- Cấu hình tốt nhất: learning rate `3e-5`, epoch `8`, weight decay `0.05`, warmup `0.1`, linear scheduler, seed `123`.
- Validation F1: seed 42 `83.20%`, seed 123 `83.95%`, seed 2024 `83.17%`; mean `83.44%`, population std `0.36` điểm phần trăm.
- Gold test với cùng alignment/evaluator: XLM-RoBERTa P/R/F1 `51.82%/62.78%/56.78%`; PhoBERT P/R/F1 `56.20%/66.46%/60.90%`.
- PhoBERT hơn `+4.38` điểm Precision, `+3.68` điểm Recall, `+4.12` điểm F1.
- Kết luận gold: PhoBERT sau full sweep và 3 seed vượt baseline; F1 tăng từ kết quả tuning trước `59.26%` lên `60.90%`.
- Gold artifacts: `colab/ner_gold_comparison.json`, `colab/validation_trials.jsonl`, `colab/best_config_seeds.json`.

### Kiểm tra ASR end-to-end trên cùng 500 audio

- ASR: `leduckhai/MultiMed-ST/asr/whisper-small-vietnamese/checkpoint-5000`; dataset `leduckhai/VietMed`, split `test`.
- Số mẫu `500`; WER trung bình `26.3446%`; WER=0 `2/500`.
- Hai NER chạy trên cùng transcript ASR; retention là consistency giữa reference/ASR prediction, không phải gold recall.
- XLM-RoBERTa: `785/1,487 = 52.7909%` retention.
- PhoBERT seed 123: `741/1,391 = 53.2710%` retention.
- PhoBERT hơn baseline `0.48` điểm phần trăm retention.
- Kết luận thực tế: PhoBERT full-tuned vượt baseline cả gold F1 và ASR retention, nên là ứng viên NER chính hiện tại; mức tăng retention nhỏ và phải báo cáo đúng là consistency metric.
- Artifacts: `colab/asr_ner_comparison_summary.json`, `colab/asr_ner_comparison.jsonl`, `colab/phobert-best-seed.zip`.

## Quy tắc báo cáo các giai đoạn tiếp theo

Mỗi lần chạy cần lưu:

1. Cấu hình dataset/split/index/model/device.
2. Số mẫu thành công và số mẫu lỗi.
3. WER (nếu có transcript chuẩn).
4. Entity count và label distribution.
5. Ít nhất 3–10 ví dụ lỗi hoặc ví dụ tiêu biểu.
6. Kết luận ngắn và quyết định bước tiếp theo.
7. Đường dẫn tới các file JSONL/CSV/summary/error.
