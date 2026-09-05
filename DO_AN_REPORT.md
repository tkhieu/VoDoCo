# Xây dựng pipeline nhận diện thực thể y tế tiếng Việt từ tiếng nói

**Sinh viên:** `[Điền tên thành viên]`  
**Môn học:** `[Điền tên môn học]`  
**Giảng viên:** `[Điền tên giảng viên]`  
**Lớp/Trường:** `[Điền thông tin lớp và trường]`

## Tóm tắt

Đồ án xây dựng pipeline xử lý tiếng nói y khoa tiếng Việt gồm hai mô-đun: Automatic Speech Recognition (ASR) và Named Entity Recognition (NER). Audio được chuyển thành transcript bằng Whisper fine-tune trên dữ liệu y khoa VietMed, sau đó XLM-RoBERTa fine-tune trên VietMed-NER nhận diện các thực thể y tế. Hệ thống được kiểm tra trên Google Colab với GPU Tesla T4.

Trên 500 mẫu test VietMed, ASR đạt WER trung bình 26,1163%. Trên test set VietMed-NER gồm 3.497 mẫu, NER đạt micro Precision 52,58%, micro Recall 66,2389% và micro F1 58,6243%; macro F1 đạt 48,3849%. Phân tích 500 mẫu test cho thấy khi WER tăng trên 30%, tỷ lệ entity được giữ lại giảm còn 35,0467%.

## 1. Đặt vấn đề

Trong hội thoại bác sĩ–bệnh nhân, thông tin như bệnh, triệu chứng, thuốc, cơ quan và phương pháp điều trị có giá trị cho việc tạo hồ sơ, tìm kiếm và hỗ trợ tóm tắt. Việc nhập thủ công tốn thời gian, trong khi dữ liệu đầu vào thường là tiếng nói tự nhiên có lỗi phát âm, giọng vùng miền và thuật ngữ chuyên ngành.

Mục tiêu của đồ án là xây dựng và đánh giá quy trình:

```text
Audio → ASR → Transcript → BERT-based NER → Medical entities
```

Đồ án không chẩn đoán bệnh và không đưa ra quyết định điều trị.

## 2. Cơ sở lý thuyết

### 2.1. ASR

ASR chuyển tín hiệu tiếng nói thành văn bản. Đồ án sử dụng mô hình Whisper-small fine-tune tiếng Việt y khoa. Chỉ số WER được tính bằng số thao tác thay thế, xóa và chèn tối thiểu để biến transcript tham chiếu thành transcript dự đoán, chia cho số từ trong tham chiếu.

### 2.2. NER

NER gán nhãn cho từng từ để xác định thực thể và loại thực thể. Dữ liệu dùng định dạng BIO:

- `B-TYPE`: bắt đầu thực thể.
- `I-TYPE`: tiếp tục thực thể.
- `0`/`O`: không thuộc thực thể.

Mô hình sử dụng là XLM-RoBERTa fine-tune cho token classification trên VietMed-NER.

### 2.3. Chỉ số NER

- Precision = TP / (TP + FP)
- Recall = TP / (TP + FN)
- F1 = 2 × Precision × Recall / (Precision + Recall)

NER gold metrics được tính theo entity span và nhãn bằng `seqeval`. Các consistency metrics trong phần phân tích lỗi không được thay thế cho Precision/Recall/F1 gold.

## 3. Dữ liệu và mô hình

### 3.1. VietMed

- Dataset: `leduckhai/VietMed`
- Các trường chính: `audio`, `text`, `duration` và metadata.
- Dùng cho đánh giá ASR và pipeline Audio → ASR → NER.
- Trong batch test, lấy 500 mẫu có thời lượng không quá 30 giây.

### 3.2. VietMed-NER

- Dataset: `leduckhai/VietMed-NER`
- Split đánh giá: `test`
- Số mẫu: 3.497.
- Trường nhãn: `words`, `labels`/`tags`.
- Có 18 nhóm thực thể trong schema.

### 3.3. Checkpoint

- ASR: `leduckhai/MultiMed-ST/asr/whisper-small-vietnamese/checkpoint-5000`
- NER: `leduckhai/VietMed-NER/xlm-roberta-base-VietMed-NER`
- Thiết bị: Google Colab Tesla T4.

## 4. Phương pháp

1. Tải audio VietMed bằng streaming.
2. Resample audio về 16 kHz.
3. Whisper tạo transcript tiếng Việt.
4. Tính WER với trường `text` tham chiếu.
5. XLM-RoBERTa nhận transcript và trả về entity, label, confidence, start/end.
6. Loại nhãn nền `0`, `O`, `dum` khỏi output hiển thị.
7. Lưu kết quả JSONL/CSV.
8. Chạy NER trên transcript chuẩn và transcript ASR để đo tác động của lỗi ASR.

## 5. Kết quả thực nghiệm

### 5.1. ASR trên train sample kiểm tra

| Chỉ số | Kết quả |
|---|---:|
| Số mẫu | 500 |
| WER trung bình | 4,1218% |
| WER trung vị | 0% |
| WER = 0 | 406/500 (81,2%) |
| Lỗi runtime | 0 |

Đây là kết quả kiểm tra trên train, không dùng làm kết quả tổng quát hóa chính. Kết quả đã được chạy lại độc lập trong `multimed_results_500_train_rerun/`, nên có thể đối chiếu riêng với test.

### 5.2. ASR và pipeline trên test

| Chỉ số | Kết quả |
|---|---:|
| Số mẫu | 500 |
| WER trung bình | 26,1163% |
| WER trung vị | 25% |
| WER = 0 | 2/500 (0,4%) |
| WER cao nhất | 92,8571% |
| Lỗi runtime | 0 |
| Entity NER dự đoán | 1.274 |

Phân bố entity dự đoán nhiều nhất: `DISEASESYMTOM=226`, `ORGAN=175`, `DATETIME=114`, `GENDER=113`, `OCCUPATION=113`.

### 5.3. NER trên gold labels

| Metric | Kết quả |
|---|---:|
| Micro Precision | 52,58% |
| Micro Recall | 66,2389% |
| Micro F1 | 58,6243% |
| Macro Precision | 43,5589% |
| Macro Recall | 57,3819% |
| Macro F1 | 48,3849% |
| Weighted F1 | 59,3108% |

Các nhãn có F1 cao: `OCCUPATION=87,9599%`, `DRUGCHEMICAL=76,1162%`, `DATETIME=70,8148%`.

Các nhãn có F1 thấp: `ORGANIZATION=9,8039%`, `PREVENTIVEMED=0%`, `TRANSPORTATION=0%`, `MEDDEVICETECHNIQUE=14,2721%`.

### 5.4. Tác động của lỗi ASR lên NER

| Nhóm WER | Số mẫu | Tỷ lệ | WER trung bình | Entity retention |
|---|---:|---:|---:|---:|
| 0% | 2 | 0,4% | 0% | 100% |
| 0–10% | 34 | 6,8% | 7,5291% | 80,4878% |
| 10–30% | 317 | 63,4% | 20,9297% | 59,6509% |
| >30% | 147 | 29,4% | 41,9554% | 35,0467% |

Trên toàn bộ 500 mẫu, 800/1.487 entity trùng nhau theo `text + label`, tương đương retention 53,7996%. Tương quan Pearson giữa WER và retention là -0,405867, cho thấy xu hướng WER cao đi kèm khả năng giữ entity thấp hơn.

## 6. Phân tích lỗi

### 6.1. Lỗi ASR

- Thuật ngữ `cắt túi mật` bị nhận thành `cắt cứu bật`.
- `chảy máu não` bị nhận thành `chày máu não`.
- Một số câu bị thêm, xóa hoặc thay thế nhiều từ.
- Các mẫu WER trên 30% chiếm 29,4% batch test.

### 6.2. Lỗi lan truyền sang NER

- Entity bị mất khi ASR xóa hoặc biến đổi thuật ngữ.
- Entity bị mở rộng hoặc tách sai span.
- `ngưng` bị tách thành `ng` và `ưng`.
- `thuốc tránh thai` có thể biến thành dự đoán sai từ transcript ASR.
- Confidence cao không đảm bảo nhãn đúng; ví dụ một số từ thông thường bị gán nhãn y tế hoặc ngược lại.

### 6.3. Mất cân bằng nhãn

Các nhãn ít mẫu có F1 thấp, đặc biệt `PREVENTIVEMED` và `TRANSPORTATION`. Macro F1 thấp hơn micro F1 cho thấy hiệu năng không đồng đều giữa các nhóm nhãn.

## 7. Hạn chế

1. Kết quả ASR test mới dùng 500 mẫu và giới hạn audio 30 giây.
2. Kết quả train và test có chênh lệch lớn; train chỉ là kiểm tra, không dùng để kết luận tổng quát hóa.
3. Pipeline chưa fine-tune thêm model trong phạm vi đồ án.
4. Một số NER metrics dùng word-level alignment, lấy dự đoán subword đầu tiên của mỗi từ.
5. Dataset VietMed không có gold NER labels cho 500 audio pipeline, nên entity retention không phải NER recall gold.
6. Confidence score của model không phải xác suất accuracy tổng thể.
7. Dữ liệu y khoa nhạy cảm; hệ thống cần được kiểm định chuyên môn trước khi dùng thực tế.

## 8. Kết luận

Đồ án đã xây dựng thành công pipeline nhận diện thực thể y tế từ tiếng nói tiếng Việt. Pipeline hoạt động end-to-end trên GPU Tesla T4 và tạo được transcript, entity cùng các file kết quả có thể tái hiện. ASR đạt WER 26,1163% trên 500 mẫu test. NER đạt micro F1 58,6243% trên test set có gold labels, trong khi macro F1 48,3849% cho thấy sự khác biệt đáng kể giữa các nhãn.

Phân tích lỗi cho thấy chất lượng ASR là yếu tố quan trọng đối với downstream NER: retention giảm từ 80,4878% ở nhóm WER 0–10% xuống 35,0467% ở nhóm WER trên 30%. Hướng phát triển gồm tăng dữ liệu huấn luyện cho nhãn hiếm, cải thiện ASR cho thuật ngữ y khoa, và đánh giá NER trực tiếp trên transcript ASR có gold annotations.

## 9. Tái hiện

Notebook train: [multimed_train_colab.ipynb](multimed_train_colab.ipynb)

Notebook test: [multimed_test_colab.ipynb](multimed_test_colab.ipynb)

Nhật ký số liệu: [REPORT_LOG.md](REPORT_LOG.md)

Hướng dẫn: [PIPELINE_GUIDE.md](PIPELINE_GUIDE.md)

Các thư mục kết quả: `multimed_results_500_train_rerun/`, `giai_doan_4/`, `giai_doan_5/`.

## 10. Tài liệu tham khảo

1. Le-Duc, K. và cộng sự. *VietMed: A Dataset and Benchmark for Automatic Speech Recognition of Vietnamese in the Medical Domain*. LREC-COLING 2024. [arXiv:2404.05659](https://arxiv.org/abs/2404.05659)
2. Le-Duc, K. và cộng sự. *Medical Spoken Named Entity Recognition*. NAACL 2025 Industry Track. [arXiv:2406.13337](https://arxiv.org/abs/2406.13337)
3. Radford, A. và cộng sự. *Robust Speech Recognition via Large-Scale Weak Supervision*. 2022. [arXiv:2212.04356](https://arxiv.org/abs/2212.04356)
4. Lample, G. và cộng sự. *Cross-lingual Language Model Pretraining*. NeurIPS 2020. [arXiv:1901.07291](https://arxiv.org/abs/1901.07291)
5. Hugging Face. [VietMed dataset](https://huggingface.co/datasets/leduckhai/VietMed), [VietMed-NER dataset](https://huggingface.co/datasets/leduckhai/VietMed-NER), và [MultiMed-ST models](https://huggingface.co/leduckhai/MultiMed-ST).
