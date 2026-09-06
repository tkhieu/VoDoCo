# Research plan: Hiệu chỉnh lỗi ASR y khoa tiếng Việt với VietMed và text y khoa bổ trợ

- **Ngày lập:** 2026-09-06.
- **Nhánh tài liệu:** `hieutk/research`.
- **Trạng thái:** thiết kế nghiên cứu và protocol triển khai; chưa huấn luyện các cấu hình R3/R4, xây prototype hoặc thực hiện user study được đề xuất bên dưới.
- **Phạm vi dữ liệu nền:** hai snapshot đã tải, `leduckhai/VietMed` và `Viet-Medical/medical_bench_raw`; khảo sát mở rộng đủ 48 kết quả tìm kiếm Hugging Face tại mục 16, chưa tự động đưa các nguồn mới vào training.
- **Quyết định chính:** đóng băng ASR và NER; fine-tune mô-đun correction; dùng VietMed làm supervision chính, text trắc nghiệm đã rà soát làm nguồn phụ có đối chứng.
- **Deliverable cuối:** prototype hỗ trợ phiên âm và rà soát lời nói y khoa tiếng Việt, pipeline/model tái hiện được và báo cáo đánh giá chất lượng cùng công sức sửa thủ công; không phải chatbot bác sĩ hay phần mềm y tế sẵn sàng triển khai.

> Tài liệu này là protocol đề xuất cho nghiên cứu tiếp theo, không phải báo cáo kết quả fine-tune. Số liệu khảo sát được tách khỏi hyperparameter và ngưỡng chấp nhận đề xuất. Cải thiện chất lượng chưa được chứng minh trước khi thực hiện thí nghiệm.

## Mục lục

1. Tóm tắt quyết định và câu hỏi nghiên cứu
2. Bằng chứng hiện có và điều chỉnh so với kế hoạch cũ
3. Nguồn dữ liệu, provenance và quyền sử dụng
4. Chia tập và kiểm soát leakage
5. Kiến trúc hệ thống và luồng training
6. Sinh cache ASR và supervision thật
7. Xử lý medical benchmark và tạo nhiễu tổng hợp
8. Model correction và protocol fine-tune
9. Ma trận thí nghiệm và kiểm soát ngân sách
10. Đánh giá, thống kê và tiêu chí chọn model
11. Artifact, schema và khả năng tái hiện
12. Lộ trình thực hiện và điều kiện chuyển giai đoạn
13. Rủi ro, giới hạn và kết quả âm
14. Phụ lục phương pháp audit
15. Tài liệu tham khảo
16. Khảo sát mở rộng: 48 dataset cho training và hardening

## 1. Tóm tắt quyết định và câu hỏi nghiên cứu

### 1.1. Mục tiêu

Xác định liệu một mô hình hiệu chỉnh văn bản có thể sửa lỗi ASR trên lời nói y khoa tiếng Việt, đồng thời bảo toàn nội dung vốn đúng và không làm chất lượng nhận diện thực thể y tế suy giảm.

Hai nguồn dữ liệu có vai trò khác nhau:

| Nguồn | Supervision thực sự cung cấp | Vai trò trong nghiên cứu |
|---|---|---|
| VietMed | Audio và transcript tham chiếu | Chạy ASR để tạo cặp lỗi thật → reference; train/dev/test cho correction |
| medical_bench_raw | Câu hỏi, lựa chọn và đáp án trắc nghiệm thô | Chỉ lấy text ứng viên đã được rà soát để tạo nhiễu tổng hợp hoặc thuật ngữ ứng viên |

**Không** coi `questions → correct_answer` là cặp correction. **Không** coi các đáp án hoặc lựa chọn trắc nghiệm là kiến thức y khoa đã được xác minh. Cả hai nguồn đều không cung cấp gold BIO/entity spans để trực tiếp supervised fine-tune NER.

### 1.2. Câu hỏi và giả thuyết

| ID | Câu hỏi nghiên cứu | Phép đối chiếu |
|---|---|---|
| RQ1 | Fine-tune bằng lỗi ASR thật có tốt hơn không sửa và correction zero-shot không? | R3 so với R0, R1 và R2 |
| RQ2 | Text y khoa bổ trợ qua nhiễu tổng hợp có giúp thêm không? | R4 so với R3 và R3-budget |
| RQ3 | Mức cải thiện WER có đi kèm bảo toàn thuật ngữ, số, phủ định và nội dung không? | Preservation probe và rà soát lỗi nội dung trước/sau |
| RQ4 | Correction ảnh hưởng thế nào đến NER downstream? | Cùng NER checkpoint trên raw/reference/corrected; gold chỉ khi có nhãn phù hợp |
| RQ5 | Workflow có correction có giúp người dùng hoàn thiện transcript nhanh hơn mà không tăng lỗi còn sót không? | User study đối chứng ASR raw và workflow correction, cùng chất lượng audio và tiêu chuẩn bản cuối; protocol tại mục 10.5 |

Giả thuyết cần kiểm chứng, không phải kết luận sẵn có:

- Supervision lỗi ASR thật có thể hữu ích hơn chỉ dùng checkpoint sửa lỗi văn bản tổng quát.
- Dữ liệu tổng hợp dựa trên phân bố lỗi train có thể bổ sung supervision cho miền y khoa.
- Identity supervision có thể giảm xu hướng sửa văn bản vốn đã đúng.
- Cải thiện WER không tự động đồng nghĩa với cải thiện NER hoặc an toàn nội dung.
- Giảm WER có thể giảm công sửa thủ công, nhưng cũng có thể tăng thời gian kiểm tra do các thay đổi khó phát hiện; phải đo trên workflow có người dùng.

### 1.3. Những việc không thuộc đường nghiên cứu chính

- Không đồng thời fine-tune ASR và NER; thay nhiều mô-đun sẽ làm mất khả năng quy tác động cho correction.
- Không chuyển bài toán thành medical QA, chatbot tư vấn hoặc chẩn đoán.
- Không dùng TTS thay thế audio thật rồi gọi đó là lỗi ASR tự nhiên của VietMed.
- Không tự viết lại reference test, bổ sung lời nói bị thiếu bằng suy đoán, hoặc tạo luật từ các case test đã xem.
- Không yêu cầu một LLM lớn mới khi checkpoint correction hiện tại đã hỗ trợ seq2seq.
- Không tự tạo chẩn đoán, đơn thuốc hoặc tóm tắt bệnh án; không tự ghi output vào hồ sơ bệnh nhân, xây hệ thống search hay bổ sung diarization/streaming trong prototype chính.

### 1.4. Deliverable cuối và luồng sử dụng

**Sản phẩm đích là prototype “hỗ trợ nhập liệu y khoa bằng giọng nói”, với tác vụ ban đầu là phiên âm và rà soát bản ghi âm/bài giảng y khoa.** Output là bản nháp để con người kiểm tra, không phải kết luận chuyên môn. Mục tiêu ứng dụng là giảm công gõ lại và sửa transcript, không chỉ đạt WER thấp hơn.

```text
Audio được phép sử dụng
  → frozen ASR → transcript gốc
  → phương án correction/baseline được chọn → transcript đề xuất
  → frozen NER → thực thể dự đoán trên đúng phiên bản text
  → người dùng nghe đối chiếu, rà soát và chỉnh sửa
  → xuất bản nháp TXT/JSON, giữ riêng bản gốc, đề xuất và bản đã rà soát
```

Ba nhóm deliverable phải được bàn giao cùng nhau:

| Nhóm | Bàn giao cụ thể | Điều kiện nghiệm thu |
|---|---|---|
| Prototype sử dụng được | Giao diện web chạy local: upload audio, phát lại audio, xem ASR gốc và bản đề xuất, tô thay đổi, xem entity, chỉnh sửa và xuất TXT/JSON | Chạy end-to-end trên audio hợp lệ trong phạm vi hỗ trợ; người dùng kiểm tra và xuất được bản cuối; không dùng kết quả giả thay cho inference |
| Model và pipeline tái hiện được | Code inference/training/evaluation; cấu hình ASR/correction/NER; adapter/checkpoint của các run đã thực hiện; revisions, môi trường, preprocessing và hướng dẫn chạy | Tải lại artifact và tái hiện output/metric theo protocol deterministic hoặc tolerance đã công bố; ghi rõ cách lấy trọng số hợp lệ thay vì yêu cầu đưa mọi trọng số vào Git |
| Bằng chứng nghiên cứu và sử dụng | Bảng R0–R4/R3-budget cho các run đủ điều kiện, seed/uncertainty, preservation, NER, runtime, case studies, user study và quyết định pipeline | Kết luận trả lời RQ1–RQ5 hoặc nêu rõ câu chưa có đủ bằng chứng; báo kết quả âm, run bị chặn và giới hạn, không chỉ chọn con số đẹp |

Workflow demo tối thiểu:

1. Người dùng chọn audio được phép xử lý. Công bố định dạng, thời lượng tối đa và phần cứng đã kiểm tra; audio không hỗ trợ phải báo rõ, không âm thầm cắt bỏ phần còn lại. Khả năng chạy trên utterance VietMed không chứng minh xử lý được toàn bộ một cuộc khám dài.
2. Hiển thị transcript ASR gốc và transcript đề xuất cạnh nhau, với các thao tác thêm/xóa/thay từ được tô rõ. Khi chọn R0, hiển thị rõ “không correction”, không giả vờ đã cải thiện text.
3. Hiển thị entity theo label schema thực sự có trong checkpoint NER, kèm text nguồn tương ứng. Không hứa nhận diện mọi loại bệnh, thuốc hoặc thông tin hành chính ngoài schema và chất lượng đã đo.
4. Cho nghe lại audio và sửa bản nháp; luôn giữ được bản ASR gốc và bản đề xuất để đối chiếu. Các thay đổi về thuốc, số, đơn vị và phủ định cần được kiểm tra; tô thay đổi không phải bộ phát hiện đầy đủ mọi lỗi nguy hiểm.
5. Khi export, phân biệt `transcript_raw`, `transcript_corrected` và `transcript_reviewed`, cùng `review_status`, model/run provenance và nguồn text của entity. Việc người dùng sửa transcript không tự xác nhận entity là đúng; không gắn span của text cũ lên text mới. Nếu không chạy lại NER, giữ entity ở phiên bản text cũ và ghi rõ trạng thái.
6. Bản xuất chưa được người dùng xác nhận phải mang trạng thái chưa rà soát. Trạng thái “đã rà soát” chỉ ghi nhận thao tác của người dùng trong demo, không phải chứng nhận an toàn y khoa.

**Hoàn tất deliverable không đồng nghĩa chứng minh correction có lợi.** Nếu R3/R4 không vượt các mốc phù hợp, vẫn bàn giao nghiên cứu và prototype với R0 hoặc R1 được chọn theo protocol. Giữ adapter/kết quả thí nghiệm để tái hiện, nhưng không ép neural correction vào đường dùng thực tế chỉ vì đã train.

### 1.5. Ứng dụng thực tế và phạm vi phù hợp

| Ứng dụng | Giá trị mong muốn | Phạm vi/giới hạn |
|---|---|---|
| Chép ghi âm/bài giảng, hội thảo y khoa | Tạo bản nháp transcript, hỗ trợ kiểm tra thuật ngữ và đoạn còn sai | Use case đầu tiên để demo; chỉ nhận định hiệu quả trên loại audio, độ dài và người dùng đã đánh giá |
| Hỗ trợ nhập liệu y khoa bằng giọng nói | Giảm việc gõ lại nội dung đã nói và công rà soát bản nháp | Hướng ứng dụng tiếp theo; nhân viên y tế phải duyệt, không tự ghi vào hồ sơ và không tự tổng hợp thành bệnh án |
| Chuẩn bị dữ liệu nghiên cứu/gán nhãn | Cung cấp transcript và entity dự đoán để người gán nhãn chỉnh sửa | Output model không phải gold annotation; phải đo công sửa và chất lượng nhãn cuối |
| Tra cứu nội dung ghi âm tư vấn | Text và entity có thể làm đầu vào cho tìm kiếm | Hướng mở rộng, chưa thuộc deliverable demo; cần lớp lưu trữ/search, quyền truy cập và kiểm chứng riêng |

**Chọn tác vụ phiên âm và rà soát trước, không bắt đầu bằng tích hợp bệnh án thật.** Tác vụ này có output quan sát được, cho phép đối chiếu với audio và đo thời gian sửa; ít rủi ro hơn tự động đưa thông tin vào quy trình khám chữa bệnh, nhưng vẫn có rủi ro sai thuật ngữ và lộ dữ liệu.

Prototype mặc định chạy local với dữ liệu đã được phép sử dụng; không yêu cầu đưa audio người bệnh thật lên dịch vụ bên ngoài. Trước khi dùng dữ liệu nhạy cảm phải có sự đồng ý/cơ sở sử dụng phù hợp, hạn chế định danh, giới hạn người truy cập và quy định lưu/xóa audio, transcript, log, bản export. Không commit hoặc công bố chúng trong artifact demo. Local inference không tự giải quyết mọi nghĩa vụ bảo vệ dữ liệu.

Phân biệt ba mức: **nghiên cứu** kiểm chứng giả thuyết; **prototype** chứng minh workflow có thể sử dụng và đo được; **triển khai thực tế** còn cần kiểm chứng trên miền đích, bảo vệ dữ liệu, quy trình chuyên môn và các yêu cầu pháp lý áp dụng. Tài liệu này cam kết hai mức đầu theo lộ trình, không cam kết sẵn sàng triển khai lâm sàng.

## 2. Bằng chứng hiện có và điều chỉnh so với kế hoạch cũ

### 2.1. Baseline và độ phủ mẫu

Nguồn: [train results](multimed_results_500_train_rerun/results.jsonl), [test results](giai_doan_5/results.jsonl), [thí nghiệm 001](experiments/001-zeroshot-correction-vietmed/README.md).

| Artifact đã lưu | ASR | Độ phủ và giới hạn |
|---|---|---|
| 500 mẫu train của Tài | MultiMed-ST Whisper-small Vietnamese checkpoint-5000 | Chỉ thuộc `VietMed_011`, một trong năm recording của train |
| 500 mẫu test của Tài | Cùng checkpoint MultiMed-ST | `VietMed_028`: 127 mẫu; `VietMed_015`: 373 mẫu; chỉ hai trong 14 recording test |
| 100 mẫu test của thí nghiệm 001 | PhoWhisper-medium | Lấy ngẫu nhiên, phủ 12/14 recording; chỉ 19 ID trùng bộ 500 test của Tài |

Cả ba tập đã lưu đều join được vào snapshot VietMed hiện tại với **0 ID thiếu và 0 reference khác nguyên văn**. Điều này xác nhận tương thích ID/reference, không chứng minh cấu hình decoding lịch sử đã được pin đầy đủ.

`giai_doan_4/results.jsonl` và `giai_doan_5/results.jsonl` là bản sao byte-identical, không phải hai lượt có tổng cộng 1.000 hypothesis khác nhau.

### 2.2. Identity và supervision lỗi thật

Dùng đúng semantics chuẩn hóa của [text-normalization-utils.py](experiments/001-zeroshot-correction-vietmed/scripts/text-normalization-utils.py): NFC, lowercase, thay ký tự không phải word/whitespace bằng khoảng trắng, gộp khoảng trắng và trim.

Trong 500 mẫu train đã lưu:

- 406 cặp identity, chiếm **81,2%**; 94 cặp có lỗi.
- Tổng cộng 504 word-unit edits trên 13.342 reference units: **corpus WER 3,7775%**.
- WER trung bình theo câu đã báo cáo là **4,1218%**, không phải corpus WER.
- Nếu bỏ mọi identity: chỉ còn 94 cặp và vẫn chỉ 504 edits; corpus WER của phần giữ lại tăng thành 20,6219% do đổi phân bố mẫu, không phải có thêm supervision.

Do tất cả 500 mẫu thuộc một recording, không ngoại suy tỷ lệ identity 81,2% cho toàn bộ train. Cần thống kê lại sau khi có cache toàn train.

### 2.3. Zero-shot chưa chứng minh lợi ích

Nguồn: [evaluation-summary.json](experiments/001-zeroshot-correction-vietmed/outputs/evaluation-summary.json).

| Chỉ số trên 100 test samples của PhoWhisper | Đã quan sát |
|---|---:|
| Corpus WER raw | 22,0680% |
| Corpus WER sau correction | 22,2471% |
| Câu WER tốt lên / xấu đi / bằng nhau | 1 / 6 / 93 |
| ASR text thay đổi sau chuẩn hóa | 8/100 |
| Reference bị thay đổi từ vựng sau chuẩn hóa | 21/100 |
| Reference được giữ nguyên sau chuẩn hóa | 79/100 |

WER bằng nhau không có nghĩa text giống nhau: một thay đổi từ vựng vẫn có thể giữ cùng edit distance. Tương tự, 79 reference được giữ nguyên là theo scoring normalization, không phải raw-string equality; cả 100 raw reference outputs có thay đổi định dạng hoặc nội dung.

Các ví dụ đã xem như thay `hcg` hoặc tên thuốc thành từ phổ thông chỉ là bằng chứng chẩn đoán về overcorrection. Không đưa trực tiếp các ví dụ test này vào lexicon, noise generator hoặc train pairs.

### 2.4. Các điều chỉnh bắt buộc

Tài liệu này thay thế các quyết định tương ứng trong [CORRECTION_IMPLEMENTATION_PLAN.md](CORRECTION_IMPLEMENTATION_PLAN.md) và [ROADMAP_CORRECTION.md](ROADMAP_CORRECTION.md) cho thí nghiệm mới; các tài liệu cũ được giữ làm lịch sử.

1. Sơ đồ `reference transcript train → ASR transcript train` là sai về đầu vào ASR. Phải là **audio train → frozen ASR → hypothesis**, sau đó join với reference.
2. Không lọc bỏ toàn bộ cặp WER bằng 0.
3. VietMed có split **`dev`**, không phải `validation`; `cv` không tương đương dev độc lập.
4. Dùng corpus WER làm metric chính và cùng implementation cho mọi run.
5. Không chạy test để chọn normalization rồi tiếp tục thiết kế/fine-tune model theo kết quả đó. Chốt các phương án trên development trước đợt đánh giá test cuối.
6. Không gọi NER consistency là gold F1; không dùng gold F1 lịch sử của một dataset khác để đánh giá correction hiện tại.

## 3. Nguồn dữ liệu, provenance và quyền sử dụng

### 3.1. Snapshot cố định

| Dataset | Revision đã tải | Vị trí local |
|---|---|---|
| `leduckhai/VietMed` | `cc7980cd1392d2d85cf1c692b1d96e8581fc7eec` | `datasets/leduckhai/VietMed/` |
| `Viet-Medical/medical_bench_raw` | `61861b94ba9c43f618b6ec5fbb32c9c492039d75` | `datasets/Viet-Medical/medical_bench_raw/` |

Manifest local `datasets/sources.json` lưu đường dẫn, revision, kích thước và hash từng file. Các đường dẫn dưới `datasets/` là dữ liệu local, không phải file mặc định có trên GitHub.

Đã tải đủ 16 file nguồn VietMed (~370,4 MB) và 3 file medical benchmark (~1,21 MB), đối chiếu hash nguồn; năm Parquet đọc được, archive ZIP/XLSX qua kiểm tra CRC. VietMed bao gồm cả Parquet và ZIP audio/transcript gốc; đây không phải toàn bộ kho audio không nhãn được liên kết riêng trên Google Drive.

Tải lại snapshot khi cần, với `uv` được cài sẵn:

```bash
uvx --from huggingface_hub hf download leduckhai/VietMed \
  --repo-type dataset \
  --revision cc7980cd1392d2d85cf1c692b1d96e8581fc7eec \
  --local-dir datasets/leduckhai/VietMed

uvx --from huggingface_hub hf download Viet-Medical/medical_bench_raw \
  --repo-type dataset \
  --revision 61861b94ba9c43f618b6ec5fbb32c9c492039d75 \
  --local-dir datasets/Viet-Medical/medical_bench_raw
```

Trước khi tải/tạo dữ liệu trong một clone mới, cấu hình `/datasets/` trong `.gitignore` hoặc `.git/info/exclude`, rồi kiểm tra bằng `git check-ignore`. Không stage cả cây dự án để commit kết quả nghiên cứu.

### 3.2. VietMed

| Split | Số dòng | Thời lượng xấp xỉ | Recording IDs | Speaker IDs |
|---|---:|---:|---:|---:|
| train | 2.773 | 4,80 giờ | 5 | 13 |
| dev | 2.912 | 4,96 giờ | 10 | 21 |
| test | 3.437 | 6,02 giờ | 14 | 27 |
| cv | 85 | 0,15 giờ | 5 | 13 |
| Tổng | 9.207 | 15,93 giờ | Không cộng các tập có giao nhau | Không cộng các tập có giao nhau |

Schema: `audio`, `text`, `duration`, `utterance_id`, `speaker_name`, `seq_name`, `audio_name`, `role`, `gender`, `accent`, `icd10_code`, `rec_condition`.

- Parquet chứa `audio.bytes` cùng metadata; ưu tiên đọc Parquet để giữ liên kết audio/reference.
- ZIP chứa 9.207 đoạn `.ogg`; không cần giải nén để dùng Parquet.
- Paper mô tả audio 8 kHz; mẫu WAV lấy từ viewer đã được kiểm tra là mono 8 kHz. Khi thực thi cần kiểm tra sampling rate thực của từng audio và resample đúng sang 16 kHz cho Whisper, không chỉ đổi nhãn rate.
- Metadata test có duration tối đa 49 giây. Không mặc định mọi mẫu dưới 30 giây.
- `icd10_code` là metadata, không phải gold entity spans hoặc đáp án chẩn đoán.
- Card cảnh báo audio có thể có 1–2 từ đầu/cuối vắng trong transcript. Reference là nhãn tham chiếu cần audit, không phải bản ghi hoàn hảo tuyệt đối.

Card khai báo MIT; paper mô tả nguồn video công khai và lập luận fair use. Không suy từ một tag license rằng mọi hình thức tái phân phối audio hoặc sử dụng thương mại đều đã được thẩm định pháp lý.

### 3.3. Medical benchmark raw

Schema: `questions`, `a`, `b`, `c`, `d`, `source_link`, `correct_answer`. Chỉ có split `train`; không có audio hoặc nhãn NER.

| Kết quả audit toàn bộ Parquet | Số lượng |
|---|---:|
| Tổng dòng | 31.272 |
| Dòng rỗng hoàn toàn | 841 |
| Dòng dư do trùng nguyên văn cả bảy trường | 23.533, tương đương 75,25% |
| Dòng phân biệt nếu chỉ loại trùng cả bảy trường | 7.739, vẫn có dòng lỗi/rỗng |
| Dòng thiếu đáp án | 1.593 |
| Nhóm cùng nguyên văn câu hỏi và bốn lựa chọn nhưng khác đáp án | 831 |
| Câu hỏi phân biệt sau chuẩn hóa tiền tố và casefold | 5.184 |
| Text ứng viên sau bộ lọc thận trọng ở phụ lục | 3.991 |

Ví dụ kiểm chứng được: cùng câu hỏi về đơn vị cấu tạo và chức năng của phổi, cùng lựa chọn và URL nguồn, các row index 781/810/839/868 lần lượt ghi đáp án A/D/B/C. Không tự sửa nhãn bằng majority vote rồi coi là ground truth.

Card không khai báo license và snapshot không có file license riêng. **Nhánh huấn luyện dùng nguồn phụ chỉ được bật sau khi làm rõ quyền sử dụng và hoàn thành rà soát text.** Có thể tiếp tục nghiên cứu VietMed-only trong khi điều kiện này chưa được đáp ứng.

## 4. Chia tập và kiểm soát leakage

### 4.1. Split protocol đề xuất

| Tập làm việc | Nguồn | Quyền sử dụng |
|---|---|---|
| `train_real` | 2.773 dòng VietMed/train trước audit duplicate | Huấn luyện, học noise profile, xây lexicon |
| `dev_tune` | 2.769 dòng dev, loại `audio_name=VietMed_019` | Chọn checkpoint, sampling, decoding và ngưỡng |
| `dev_shared_recording` | 143 dòng dev của `VietMed_019` | Giữ riêng; báo cáo phụ sau khi khóa thiết kế, không train/tune |
| `test_official` | Toàn bộ 3.437 dòng test | Đánh giá benchmark cuối |
| `cv_diagnostic` | 85 dòng cv | Kiểm tra phụ; không thay main development |
| `aux_train` / `aux_check` | Nhóm text medical benchmark đã duyệt, dự kiến chia 90/10 theo nhóm nguồn | Train nhiễu tổng hợp / kiểm tra cơ chế denoising, không thay dev ASR thật |

Lý do dev_tune: dev và test cùng recording `VietMed_019`, dù khác speaker IDs. Tách 143 dòng khỏi tuning giữ test chính thức nguyên vẹn và giảm dùng chung ngữ cảnh recording. Phải báo cáo đây là protocol khác full dev của benchmark gốc.

`cv` chia sẻ cả năm recording và 13 speaker IDs với train. Speaker IDs cũng có phạm vi theo recording, nên không dùng chúng để tuyên bố đã xác minh mọi người thật là khác nhau trên toàn corpus.

### 4.2. Duplicate và đơn vị nhóm

Audit text/metadata thấy hai cặp train và một cặp test có cùng `seq_name`, reference và duration nhưng khác utterance ID:

- train: `000114/000355` và `000229/000472`;
- test: `000025/000094`.

Đây là **metadata-identical records**, chưa phải bằng chứng audio byte-identical. Một số hypothesis đã lưu cho các ID này khác nhau. Trước khi dedup train, kiểm tra audio content/hash và quy định chọn đại diện độc lập với WER, ví dụ ID nhỏ nhất trong nhóm đã xác nhận trùng. Không chọn hypothesis có WER đẹp hơn.

Giữ nguyên official test làm kết quả chính; có thể báo thêm sensitivity analysis trên bản dedup theo quy tắc chốt trước, không âm thầm bỏ dòng test.

Với nguồn phụ: cùng stem, stem gần trùng đã xác nhận, các bản nhiễu của stem và các trang nguồn liên kết bởi cùng stem phải nằm cùng phía train/check. URL trống không phải một document ID chung. Không random-split sau khi tạo synthetic variants.

### 4.3. Quy tắc không leakage

- Chỉ train được dùng để học confusion pairs, tần suất thuật ngữ, insertion/deletion/substitution probabilities và lexicon sửa lỗi.
- Dev chỉ chấm phương án; không đưa reference dev thành target train, noise dictionary hoặc ví dụ sửa lỗi.
- Test reference chỉ phục vụ audit contamination định trước và chấm điểm, không phục vụ lựa chọn mô hình.
- Một audit loại trùng nguồn phụ với held-out text không được biến thành việc khai thác thuật ngữ hoặc quy tắc từ held-out text.
- Không lấy dự đoán entity của NER làm gold correction target.
- Mọi synthetic variant giữ `parent_id`, source group và split của text gốc.

**Giới hạn phải công bố:** test đã được xem trong các thí nghiệm/báo cáo trước. Đợt đánh giá mới là benchmark evaluation sau khi khóa thiết kế, không được gọi là một test set hoàn toàn chưa từng được quan sát. Không tiếp tục đổi hyperparameter theo test mới rồi vẫn gọi đó là đánh giá một lần.

## 5. Kiến trúc hệ thống và luồng training

### 5.1. Inference

```text
Audio
  → decode + resample 16 kHz + xử lý đoạn dài đã chốt
  → ASR cố định
  → transcript raw
  → correction được chọn hoặc baseline không sửa
  → NER cố định
  → entities + artifact để audit
```

Reference và gold annotations chỉ thuộc nhánh đánh giá; không được truyền cho ASR, corrector hay NER trong inference.

### 5.2. Tạo supervision và huấn luyện

```text
VietMed/train audio → frozen ASR → hypothesis ──┐
VietMed/train reference ───────────────────────┴→ D_real
                                                 │
                                                 └→ train-only error profile
                                                                  │
medical_bench_raw → dedup → rights/text review → text đã duyệt ──────┤
                                                                  ▼
                                                         synthetic noise
                                                                  │
                                                                  ▼
                                                                D_aux

Nhánh R3: checkpoint gốc → LoRA trên D_real + identity → dev_tune
Nhánh R4: checkpoint gốc → LoRA warm-up D_aux → cùng real stage → dev_tune

Chốt cấu hình + checkpoint của các seed → test_official → báo cáo ASR/NER/nội dung
```

## 6. Sinh cache ASR và supervision thật

### 6.1. Chọn một ASR chính

Giữ ASR của Tài cho đường chính nhằm so sánh liên tục với baseline:

- Repo: `leduckhai/MultiMed-ST`.
- Model subfolder: `asr/whisper-small-vietnamese/checkpoint-5000`.
- Processor subfolder: `asr/whisper-small-vietnamese`.
- NER: `leduckhai/VietMed-NER/xlm-roberta-base-VietMed-NER`.

PhoWhisper-medium là nhánh cross-ASR riêng về sau, không trộn vào cache chính và không đổi ASR để chọn kết quả test thuận lợi. Model/processor commit SHA chưa được khóa cho lượt mới; bước G1 phải resolve và lưu trước khi sinh cache. Tên checkpoint không thay thế revision/hash.

### 6.2. Cache signature

Một cache signature bao gồm:

- dataset repo, revision, split và hash manifest;
- ASR/processor repo, subfolder, revision, local weight hashes nếu dùng file local;
- toàn bộ resolved generation config: language/task, beam, sampling, token cap và các default có hiệu lực;
- audio decode, resampling, segmentation/long-form policy;
- precision, thiết bị và phiên bản thư viện liên quan.

Khóa logic của bản ghi: `(dataset_revision, split, utterance_id, asr_signature)`; `dataset_index` chỉ là metadata chẩn đoán. Không dùng index đơn lẻ để resume vì train/test có cùng các index số học.

Khi signature khác, tạo namespace cache khác, không nối file cũ. Mọi join input/reference/corrected phải kiểm tra uniqueness, missing IDs, tập ID và reference; không dùng `zip()` theo vị trí làm điều kiện đủ.

### 6.3. Độ phủ và khả năng tái sử dụng

Nếu xác nhận cache lịch sử tương thích signature mới, số hypothesis còn thiếu cho ASR MultiMed-ST là:

| Split | Tổng | Đã lưu | Còn thiếu |
|---|---:|---:|---:|
| train | 2.773 | 500 | 2.273 |
| dev | 2.912 | 0 | 2.912 |
| test | 3.437 | 500 | 2.937 |

Tổng thiếu 8.122 trên ba split, không tính cv. Nếu không xác nhận được signature, tạo cache chuẩn mới cho cả 9.122 mẫu train/dev/test; không giả định cache lịch sử đủ provenance chỉ vì ID khớp.

Ưu tiên hoàn tất train và dev trước. Sau khi khóa ASR preprocessing/decoding, cache test có thể được sinh độc lập, nhưng không dùng kết quả test để đổi thiết kế correction. Xử lý audio >30 giây phải chốt ở cấp ASR trước đó; không âm thầm bỏ những mẫu dài hoặc cắt reference theo output.

### 6.4. Chính sách lỗi và reference

- Lỗi hạ tầng/decode được ghi riêng và xử lý để hoàn tất coverage; không thay bằng text bịa hoặc coi mẫu đó có WER bằng 0.
- ASR trả hypothesis rỗng là một kết quả nhận dạng thất bại hợp lệ để chấm; phải tính deletions thay vì bỏ khỏi summary.
- Reference rỗng sau chuẩn hóa cần được báo cáo và có chính sách nhất quán; không tự gán sentence WER bằng 0. Không có lý do bỏ numerator insertion của trường hợp này khỏi corpus score.
- Cặp train có dấu hiệu sai ranh giới, audio không khớp hoặc target thiếu cần rà soát và lưu quyết định, không lọc chỉ bằng một ngưỡng WER.
- Nếu sửa nhãn train sau nghe audio, lưu cả bản gốc và bản adjudicated cùng lý do. Không sửa test reference cho phù hợp model.

### 6.5. Identity supervision

D_real giữ cả hypothesis đã đúng và hypothesis có lỗi. Có thể bổ sung view `reference_train → reference_train`, chỉ từ train, để dạy preservation. Dedup identity views và ghi nguồn, không tính các bản sao như câu mới.

Tỷ lệ khởi đầu đề xuất cho real-stage sampler: **70% errorful / 30% identity**. Đây là tỷ lệ lấy mẫu, không phải tuyên bố phân bố của dataset. Chỉ cân nhắc đối chiếu 50/50 nếu dev cho thấy đánh đổi rõ; không mở một sweep không giới hạn. Mọi run đối chứng dùng cùng sampler, seed, số update và cách weight loss tương ứng.

## 7. Xử lý medical benchmark và tạo nhiễu tổng hợp

### 7.1. Tách candidate extraction khỏi xác nhận clean target

Chuỗi trạng thái:

```text
raw row → normalized stem → deduplicated candidate
        → kiểm tra nguồn/quyền sử dụng
        → rà soát text độc lập
        → approved auxiliary text
        → synthetic noisy/clean pair
```

Bộ lọc tự động 3.991 ứng viên chỉ là hàng chờ. Nó vẫn giữ các câu như `Bộ máy gongi có chức năng?`, nên không được đổi tên hàng chờ thành clean corpus rồi train ngay.

Quyết định nguồn phụ phải ghi: text gốc, text sau review nếu có, người/quy trình review, lý do, source URLs, nhóm nguồn, raw row IDs và revision. Không tự lấp chỗ trống bằng `correct_answer`; không coi câu yêu cầu chọn đúng/sai là một mệnh đề được y khoa xác nhận.

Nguồn thiếu license là điều kiện chặn R4, không chặn R0–R3. Dữ liệu hoặc lexicon dẫn xuất chưa được phép phân phối không được commit chỉ vì kích thước nhỏ.

### 7.2. Chia nhóm trước tạo nhiễu

- Dedup stem trước sampling; không dùng tần suất scraper làm trọng số huấn luyện.
- Giữ hợp của source URLs cho mỗi stem. Có ứng viên xuất hiện ở nhiều URL hoặc cả hai host.
- Chia khoảng 90/10 theo nhóm nguồn/stem liên thông cho `aux_train/aux_check`; lưu assignment cụ thể vì kích thước nhóm làm tỷ lệ thực tế không nhất thiết đúng 90/10.
- `aux_check` chỉ kiểm tra denoising ngoài mẫu của nguồn phụ; lựa chọn cho ASR correction vẫn dựa vào dev_tune thật.
- 734 ứng viên chỉ có URL trống cần xử lý provenance riêng; không khẳng định source-independent evaluation cho phần chưa xác minh.

### 7.3. Noise generator dựa trên train

1. Align reference train với hypothesis của ASR chính bằng một implementation edit alignment cố định.
2. Thu thập substitutions, insertions, deletions và span confusions có bằng chứng trong train; ghi số lần và ngữ cảnh hỗ trợ.
3. Phân bố số edits/độ dài và loại lỗi lấy từ train, không từ dev/test.
4. Áp dụng corruption theo chiều **reference-like text → ASR-like noisy text**; target vẫn là text gốc đã duyệt.
5. Khởi đầu 1–2 biến thể cho mỗi text được duyệt, kèm identity supervision; lưu seed, operations và parent ID.
6. Một corruption không làm thay đổi text không được ghi nhãn giả là errorful; phân loại identity hoặc bỏ variant dư một cách có ghi nhận.

Không chỉ bỏ dấu/đảo ký tự kiểu Telex rồi gọi đó là mô phỏng ASR. Không để noise generator tự tạo tên thuốc, liều lượng hoặc một câu văn mới ngoài các phép corruption đã định nghĩa. Nhiễu tổng hợp luôn mang nhãn nguồn synthetic, không được dùng để báo cáo chất lượng lỗi ASR thật.

Kiểm tra generator trên train/aux_check: histogram edit rate, độ dài, tỷ lệ identity, lỗi lặp và các ví dụ biến đổi. Nếu generator làm toàn câu thành vô nghĩa, giảm/đổi corruption dựa trên train/aux_check rồi chốt; không tìm hình thức noise cho kết quả test đẹp.

## 8. Model correction và protocol fine-tune

### 8.1. Checkpoint và tokenizer

Dùng `bmd1905/vietnamese-correction-v2` làm điểm khởi đầu để nối với thí nghiệm 001. Local config xác nhận `MBartForConditionalGeneration`, nền `vinai/bartpho-syllable`, encoder/decoder 12 layers, hidden size 1.024 và vocabulary 40.030.

Checkpoint lưu khoảng 396 triệu phần tử tham số/buffer. Model card có ví dụ sửa lỗi văn bản nhưng không cung cấp đầy đủ provenance corpus training; không khẳng định đã chứng minh miền dữ liệu gốc hoặc việc không từng thấy benchmark.

Giữ tokenizer BARTpho-syllable; không thêm word segmentation bằng dấu gạch dưới theo pipeline của một model word-based khác. Chuẩn hóa input/target training ở mức bảo toàn nội dung: NFC, khoảng trắng và các thay đổi định dạng đã quy định; giữ bản raw. Scoring normalization là một bước riêng, dùng thống nhất khi tính metric.

### 8.2. Tài nguyên đã kiểm tra

Máy local có NVIDIA GeForce RTX 5060 Ti, NVML báo **16.311 MiB VRAM tổng**. Đây là dung lượng thiết bị đã đo, không phải kết quả benchmark fine-tune hoặc cam kết mọi cấu hình sẽ vừa bộ nhớ.

Trong checkpoint có 72 ma trận `q_proj/v_proj`. Với rank 16, adapter cho các ma trận này có khoảng **2.359.296 tham số trainable**, khi không mở thêm bias/embedding/head để train. Không cần giữ ASR và NER cùng GPU trong giai đoạn fine-tune: cache text trước, giải phóng hai model đó rồi train corrector.

### 8.3. Cấu hình khởi đầu đề xuất

| Thành phần | Giá trị ban đầu |
|---|---|
| Phương pháp | LoRA, base weights frozen |
| PEFT task | Seq2seq language modeling |
| Target modules | `q_proj`, `v_proj` của encoder/decoder attention |
| Rank / alpha / dropout | 16 / 32 / 0,05 |
| Bias / modules mở train thêm | Không, ở baseline LoRA |
| Learning rate | `1e-4` |
| Optimizer | AdamW; weight decay 0,01; gradient clipping 1,0 |
| LR schedule | Linear decay; warm-up 5% optimizer steps mỗi stage |
| Batch / gradient accumulation | 2 / 8; effective batch 16 trên một GPU |
| Precision | BF16 khi PyTorch/runtime xác nhận hỗ trợ; nếu không, FP16 có kiểm tra ổn định |
| Memory | Dynamic padding; gradient checkpointing; tắt generation cache khi train |
| Max source / target tokens | 512 / 512, đo bằng tokenizer thực |
| Loss | Token cross-entropy; padding labels = -100 |
| Auxiliary stage | Tối đa một epoch ban đầu |
| Real stage | Tối đa năm epoch; early stopping patience hai lần đánh giá |
| Evaluation | Generated outputs trên toàn dev_tune ở cuối epoch/checkpoint interval đã chốt |
| Correction decoding | Deterministic, không sampling; beam 4 và giới hạn độ dài cố định cho các run neural |
| Seeds chính | 42, 43, 44; dataset/noise assignment được pin riêng |

Đây là recipe ban đầu, không phải hyperparameter đã tối ưu. Kiểm tra một lượt nhỏ có forward/backward, save/load adapter và generate trước khi chạy chính. Ghi peak VRAM và token lengths; không âm thầm truncate mẫu vượt giới hạn hoặc tăng giới hạn cho một run mà không cập nhật protocol đối chứng.

### 8.4. Các nhánh training

**R3 — real-only:** khởi tạo từ checkpoint gốc; học D_real và identity views từ train. Không dùng medical benchmark.

**R4 — auxiliary rồi real:** khởi tạo lại từ cùng checkpoint gốc, không tiếp tục từ R3; warm-up LoRA bằng D_aux, sau đó tiếp tục adapter trên real stage giống R3. Reset optimizer/LR schedule và sampler seed tại đầu real stage theo cùng policy giữa các seed; không reset adapter đã học ở auxiliary stage.

Auxiliary stage luôn kết thúc trước real stage. Không lấy kết quả QA hoặc synthetic validation làm bằng chứng model đã sửa được lỗi lời nói thật.

**R3-budget:** real-only có max optimizer-update budget tương đương tổng auxiliary + real của R4, nhằm phân biệt giá trị text phụ với lợi ích train lâu hơn. Lưu cả budget và actual updates nếu early stopping xảy ra; dùng cùng quy tắc chọn checkpoint, không cố tình chọn checkpoint tệ cho đối chứng.

## 9. Ma trận thí nghiệm và kiểm soát ngân sách

| Run | Nội dung | Train correction | Mục đích |
|---|---|---|---|
| R0 | ASR raw → NER | Không | Mốc không sửa |
| R1 | Rule-based normalization/lexicon → NER | Không gradient; luật/lexicon chỉ từ train | Mốc đơn giản, giải thích được |
| R2 | Checkpoint correction zero-shot → NER | Không | Mốc model hiện có |
| R3 | LoRA real-only → NER | VietMed train + identity | Giá trị lỗi ASR thật |
| R3-budget | Real-only cùng max update budget với R4 | Như R3 | Kiểm soát training compute |
| R4 | Auxiliary warm-up rồi cùng real stage → NER | Text phụ đã duyệt + VietMed train | Giá trị tăng thêm của dataset thứ hai |

R1 phải lưu rõ từng rule/lexicon entry và nguồn; không âm thầm chuyển R1 thành mô hình sinh. Nếu muốn tách tác động normalization và lexicon, khai báo R1-normalize/R1-lexicon trước khi chấm test, không thêm nhánh sau khi thấy kết quả test.

Các điều kiện phải giống nhau giữa các run liên quan:

- sample IDs, audio, ASR cache/signature và reference;
- scoring normalization và implementation metric;
- correction tokenizer/decoding của các run neural, trừ yếu tố đang làm ablation;
- NER checkpoint, tokenizer, aggregation và entity filtering;
- real-stage sampler, evaluation cadence và checkpoint-selection rule;
- cách tính runtime, GPU memory và training updates.

Chạy thăm dò trên train/dev với seed 42; khóa lựa chọn trước khi thực hiện bộ seed 42/43/44. Báo cáo từng seed và tổng hợp, không chỉ seed đẹp nhất. Không mở sweep model, rank, learning rate và noise vô hạn trên cùng dev nhỏ; mọi mở rộng phải ghi trong protocol log.

## 10. Đánh giá, thống kê và tiêu chí chọn model

### 10.1. WER/CER và metric theo câu

Metric chính:

```text
Corpus WER = tổng(S + D + I) trên mọi mẫu / tổng số reference units
Relative WER reduction = (WER_R0 - WER_run) / WER_R0
```

S/D/I là số thay/xóa/chèn từ edit alignment. Unit hiện tại là chuỗi tách bằng whitespace, thường là âm tiết tiếng Việt, không phải linguistic word segmentation.

Dùng một scoring function chung bắt nguồn từ `text-normalization-utils.py` cho tất cả run. NFC/lowercase/bỏ dấu câu không được dùng để che mất thay đổi nguy hiểm: normalization hiện tại có thể làm mất dấu hoặc cách viết số, nên kiểm tra bảo toàn số/đơn vị phải đọc raw text và audio/reference tương ứng.

Báo thêm CER, mean/median sentence WER, số câu improved/worsened/tied, và raw-string/normalized-string change rates. Không suy ra text bằng nhau từ WER bằng nhau.

Với hypothesis rỗng và reference không rỗng, tính đầy đủ deletion errors. Với reference rỗng, lưu count/policy; sentence WER có thể không xác định và được báo riêng, nhưng corpus numerator phải xử lý insertion nhất quán. Implementation cũ đang bỏ một số trường hợp rỗng cần được sửa trước khi dùng cho full-split evaluation; các kết quả khảo sát đã lưu đều có text không rỗng.

### 10.2. Preservation và lỗi nội dung

Trên dev/test, reference chỉ có thể dùng để **đánh giá** preservation:

```text
Reference overcorrection rate
  = số mẫu C(reference) khác reference sau normalization / số mẫu đã đánh giá
```

Đo thêm WER/CER của `C(reference)` so với reference và raw formatting changes. Probe này không đồng nhất với tỷ lệ hallucination hoặc sai y khoa; reference cũng có giới hạn annotation.

Rà soát thủ công so sánh raw ASR/corrected với audio và reference, phân biệt:

- sửa đúng lỗi ASR;
- giữ lỗi cũ;
- thêm lỗi mới hoặc xóa nội dung vốn đúng;
- tên thuốc/thuật ngữ, số/liều/đơn vị, phủ định;
- completion ở ranh giới đoạn nhưng không có bằng chứng được nói;
- nghi ngờ lỗi reference thay vì lỗi model.

Đề xuất một mẫu review cố định 200 dev utterances, phân tầng theo recording và mức lỗi ASR, pin trước khi so các corrector; xem riêng các thay đổi được flag là nghiêm trọng. Reviewer nên không biết run ID khi gán nhãn; bất đồng được adjudicate và lưu. Không ngoại suy tỷ lệ toàn corpus từ tập case cố tình chọn lỗi nặng; báo sampling và denominator cụ thể.

### 10.3. NER: consistency trước, gold khi thực sự có

Giữ NER hiện có cố định. Chạy trên raw ASR, corrected text và reference; giữ cùng entity filtering (`0`, `O`, `dum` là nhãn nền theo pipeline hiện tại).

Consistency có thể dùng multiset `(normalized entity text, label)`:

```text
M = tổng min(count_reference_prediction, count_candidate_prediction) cho từng key
Consistency precision = M / số candidate predicted entities
Consistency retention = M / số reference-text predicted entities
Consistency F1 = 2M / (số candidate + số reference-text predicted entities)
```

Ghi rõ các quy ước zero-denominator. Đây là so sánh giữa **hai bộ dự đoán**, không phải gold evaluation. Không tối ưu chỉ số này như bằng chứng duy nhất về chất lượng y khoa.

Hai nguồn đã tải không có BIO/entity-span gold. Số micro F1 58,6243% trong [ner_gold_metrics.json](giai_doan_4/ner_gold_metrics.json) đến từ **VietMed-NER/test**, là một dataset thứ ba và bài đánh giá độc lập.

Muốn có kết luận end-to-end gold NER phải mở một nhánh riêng: gán nhãn subset audio/reference cố định hoặc xác minh mapping với VietMed-NER. Chốt schema entity, cách xử lý trùng, normalization và metric trước khi chạy. Không ghép theo row index, không copy BIO tags sang transcript đã đổi độ dài, không so raw character offsets giữa hai text khác nhau. Nếu chấm entity content+type thay vì span-F1 chuẩn, đặt tên metric đúng và báo quy trình đó.

### 10.4. Chọn checkpoint, uncertainty và test lock

Chọn checkpoint theo generated-output dev metrics, không chỉ teacher-forced loss. Policy đề xuất:

1. Loại lượt lỗi kỹ thuật hoặc có coverage không đủ.
2. Xem corpus WER, preservation và review nội dung trên cùng dev_tune.
3. Trong các ứng viên qua kiểm tra nội dung, ưu tiên corpus WER thấp; khi bằng nhau, ưu tiên ít overcorrection và mô hình đơn giản/ít chi phí hơn.
4. Nếu R3/R4 không tốt hơn các mốc phù hợp, giữ baseline; không bắt buộc chọn neural correction.

**Mức cải thiện thực dụng đề xuất trước test:** relative WER reduction ít nhất 2% so với R0, kèm tính ổn định qua seed và không có bằng chứng làm nội dung y khoa tệ hơn trong review. Mốc 2% là tiêu chí thiết kế, không phải mức cải thiện đã đo hoặc bằng chứng ý nghĩa thống kê.

Báo cáo mean/std và từng seed. Dùng paired bootstrap cho delta corpus WER, resample theo `audio_name` cluster để không giả định mọi đoạn cùng recording là độc lập; tính lại corpus ratio ở mỗi bootstrap sample. Đề xuất 2.000 bootstrap replicates với seed cố định và CI 95%. Dataset có ít recording nên phải báo giới hạn độ chắc chắn; không pool các bản dự đoán của ba seed thành nhiều audio samples độc lập.

R4 phải được đối chiếu với cả R3 và R3-budget. Nếu lợi ích chưa phân biệt được với biến động hoặc chỉ xuất hiện khi train nhiều hơn, không kết luận nguồn phụ giúp.

Trước test lock lưu: nguồn/split manifest, model revisions, dữ liệu derived, seeds, hyperparameters, decoder, normalization, checkpoint rule, review sampling, matrix run và metric definitions. Chạy toàn bộ matrix đã khai báo; báo cả thất bại. Nếu test làm thay đổi ý tưởng nghiên cứu, đó là chu kỳ nghiên cứu mới có khai báo, không phải tiếp tục tuning rồi tái sử dụng nhãn “test chưa thấy”.

### 10.5. User study: đo công sửa và chất lượng bản cuối

**Câu hỏi:** workflow có correction có giảm công hoàn thiện transcript mà không làm tăng lỗi còn sót, đặc biệt các lỗi quan trọng, hay không? WER/CER tự động chỉ đánh giá output model; không thay cho phép đo này.

**Thiết kế pilot đề xuất, chưa thực hiện:**

- Tuyển khoảng 8–12 người thông thạo tiếng Việt, ưu tiên sinh viên y hoặc nhân viên có nhiệm vụ ghi chép; ghi mức quen thuật ngữ và kinh nghiệm phiên âm. Đây là pilot khả thi, chưa có tính toán statistical power; không coi nhóm thuận tiện này là đại diện mọi bác sĩ/người dùng.
- Chốt 24–40 audio clips từ official test cho user study trước khi xem mức lợi/hại của correction trên từng clip; phân tầng theo metadata recording và thời lượng. Pin IDs, tiêu chí lấy mẫu và assignment tại G0, không cần đọc lỗi correction/test để chọn mẫu. Tách tập này khỏi 200 dev utterances dùng cho content review tại mục 10.2; không sử dụng kết quả pilot để tune rồi gọi cùng test là chưa thấy.
- Chọn một cấu hình/checkpoint dùng cho prototype bằng dev theo mục 10.4, kể cả quy tắc chọn seed, và khóa trước test. Không chọn model hoặc seed tốt nhất trên test để đưa vào user study.
- So sánh **A: ASR raw + nghe/sửa thủ công** và **B: transcript correction + đối chiếu bản gốc/tô thay đổi + nghe/sửa thủ công**. Cùng audio player, editor, máy và tiêu chuẩn bản cuối; người dùng không được xem reference chuẩn. B đo giá trị của cả workflow hỗ trợ correction, không tách riêng tác động của model và giao diện tô thay đổi.
- Mỗi người làm cả A và B trên các clip khác nhau, cân bằng recording/thời lượng và thứ tự A/B bằng randomization đã chốt. Không cho cùng người sửa cùng clip ở cả hai điều kiện để tránh nhớ nội dung. Mỗi clip được gán cho cả A và B qua những người khác nhau; lưu seed và assignment. Sau khi chạy, báo cả mức lỗi ASR raw và mất cân bằng mức khó nếu có, không đổi assignment theo kết quả. Lượt tập làm quen dùng audio ngoài tập đánh giá và không tính vào kết quả.
- Nếu không có corrector vượt các điều kiện chọn model, vẫn có thể khảo sát đối chứng ứng viên đã khóa dưới nhãn thử nghiệm và có người kiểm tra; không gọi B là pipeline được khuyến nghị. Prototype bàn giao giữ baseline phù hợp, không tạo so sánh giả giữa hai output giống nhau.

| Chỉ số | Cách đo | Cách diễn giải |
|---|---|---|
| Thời gian sửa chủ động `T_edit` | Từ khi transcript sẵn sàng để xem/nghe đến khi xác nhận bản cuối; gồm thời gian nghe lại, đối chiếu và sửa; nghỉ có chủ đích được ghi riêng theo cùng policy | Báo theo người/điều kiện, median/IQR và thời gian sửa trên mỗi phút audio; không trộn chờ inference với thao tác người dùng |
| Thời gian chờ và thời gian end-to-end | Đo riêng upload/decode/inference/export và tổng thời gian tới bản cuối; ghi phần cứng, cold/warm load, độ dài audio | Có thể dùng outputs đã cache cho `T_edit` để tránh nhiễu, nhưng phải ghi rõ và không gọi thời gian đó là end-to-end live inference |
| Công chỉnh sửa | Ghi event thêm/xóa/thay, undo và nghe lại nếu giao diện có instrument; lưu text ban đầu và text cuối để tính edit distance bổ sung | Edit distance giữa hai bản không phải số thao tác hoặc số phím bấm thực tế; không suy số thao tác từ diff cuối |
| Chất lượng bản cuối | WER/CER theo metric chung và reviewer đối chiếu audio; reviewer không biết điều kiện A/B, bất đồng được adjudicate | Phân biệt lỗi model đầu vào với lỗi vẫn còn sau khi người dùng duyệt; reference nghi ngờ sai phải được ghi, không âm thầm sửa gold test |
| Lỗi quan trọng còn sót | Reviewer có năng lực miền kiểm tra tên thuốc/thuật ngữ, số/liều/đơn vị, phủ định và thông tin được thêm không có trong audio | Ghi số lỗi, số clip bị ảnh hưởng và denominator cụ thể; không có lỗi trong pilot nhỏ không chứng minh an toàn |
| Cảm nhận sử dụng | Hỏi ngắn về độ dễ đối chiếu, mức phải kiểm tra lại và phần gây khó hiểu | Kết quả bổ trợ; thích giao diện không đồng nghĩa transcript đúng hơn |

Giữ cùng tiêu chuẩn bản cuối ở A/B; không chấp nhận việc sửa nhanh hơn nhờ bỏ qua các lỗi còn lại. Người dùng xác nhận “xong” không được dùng làm gold chất lượng; cần review độc lập nói trên.

Phân tích phải báo từng người và cả hai điều kiện, chênh lệch thời gian/công sửa, chất lượng cuối và case study. Không coi mọi edit/clip là quan sát độc lập vì lặp theo cả người và recording; với pilot nhỏ ưu tiên thống kê mô tả, nêu rõ giới hạn. Nếu báo CI/kiểm định, khai báo phương pháp xử lý cấu trúc lặp này trước khi phân tích, không tái dùng bootstrap WER theo recording như thể đã xử lý khác biệt người dùng.

**Tiêu chí diễn giải giá trị ứng dụng:** chỉ kết luận có tín hiệu giảm công khi thời gian/công sửa giảm mà chất lượng cuối không cho thấy đánh đổi bất lợi, nhất là lỗi quan trọng. Nếu WER giảm nhưng `T_edit` tăng hoặc lỗi còn sót tăng, lợi ích sử dụng chưa được chứng minh. Không đặt phần trăm tiết kiệm kỳ vọng thành kết quả, không suy ROI hoặc hiệu quả lâm sàng từ pilot.

User study hoàn tất khi có assignment, dữ liệu đo hợp lệ, review bản cuối và báo cáo cả kết quả âm. Nếu chưa tuyển được người hoặc chưa có quyền dùng audio, ghi “chưa đánh giá giá trị sử dụng”; demo chạy được không đủ để đóng RQ5 hoặc tuyên bố tiết kiệm thời gian.

## 11. Artifact, schema và khả năng tái hiện

### 11.1. Bố trí đề xuất

Chỉ tạo artifact khi đến giai đoạn tương ứng; đây không phải danh sách file đã tồn tại.

```text
datasets/
  sources.json
  leduckhai/VietMed/                         # snapshot raw bất biến
  Viet-Medical/medical_bench_raw/             # snapshot raw bất biến
  derived/correction/
    manifests/                              # split/source/model signatures
    audit/                                  # duplicate, rejection, review decisions
    asr_cache/                              # theo ASR signature và split
    auxiliary/                              # candidates, approved text, group assignments
    pairs/                                  # real, identity, synthetic và parent IDs

experiments/002-vietmed-correction-training/
  scripts/                                  # code thực thi khi triển khai
  models/                                   # adapters/checkpoints; bỏ qua bởi Git
  outputs/                                  # summary, predictions, review và run manifests
```

Giữ nguyên `experiments/001-*`, `giai_doan_4/`, `giai_doan_5/` và train rerun lịch sử. Không overwrite kết quả cũ bằng lượt mới. Chỉ commit code, config, tài liệu và output nhỏ được phép công bố; dữ liệu raw, trọng số và text nguồn phụ chưa đủ quyền không được stage tự động.

### 11.2. Trường dữ liệu tối thiểu

| Artifact | Trường bắt buộc/ý nghĩa |
|---|---|
| Source manifest | Repo ID, revision, file paths, bytes, hash algorithm/hash |
| Split manifest | Dataset revision, original split, derived split, utterance/stem IDs, group IDs, exclusion reason, assignment seed |
| ASR record | Utterance ID, source revision/split, ASR signature, raw reference/hypothesis, duration, audio/speaker/seq metadata, trạng thái lỗi |
| Training pair | Pair ID, parent ID, source revision, split, `pair_type` = real/identity/synthetic, input/target text, ASR/noise signature, review state |
| Auxiliary provenance | Raw row IDs, original/reviewed stem, source URL set, group ID, reviewer decision, quyền sử dụng và rejection reason |
| Run manifest | Code commit, model/tokenizer hashes, data-manifest hashes, seeds, LoRA/training config, actual optimizer steps, hardware/library versions |
| Prediction record | Run/seed/checkpoint, utterance ID, raw/corrected/reference, edit counts, change flags, NER predictions khi có |
| Review record | Sample ID, blinded variant ID, audio reference, error category/severity, reviewer và adjudication |
| Prototype export | Audio/sample ID, pipeline/run signature, `transcript_raw`, `transcript_corrected`, `transcript_reviewed` khi có, `review_status`, entity predictions và phiên bản text nguồn; dữ liệu nhạy cảm không tự đưa vào Git |
| User-study record | Participant ID giả danh, sample/recording ID, condition/order, assignment seed, timing/pause policy, edit-event counts khi có, bản cuối, blinded review/adjudication; consent và thông tin định danh quản lý riêng |

Manifest JSON phải serializable và có schema được kiểm tra khi triển khai. Một hash manifest không thay thế việc kiểm tra ID coverage hoặc nguồn dữ liệu đúng split.

### 11.3. Pin môi trường và kiểm tra trước lượt chính

Ghi Python, PyTorch, CUDA/driver, Transformers, PEFT, Datasets, audio backend, tokenizer và JiWER versions. Checkpoint hiện tại từng chạy với Transformers khác version trong config; không coi version ghi trong model config là môi trường bắt buộc hoặc môi trường local hiện hành.

Lượt kiểm tra nhỏ phải chứng minh: audio decode/resample đúng, batch padding và labels đúng, forward/backward có gradient ở adapter, save/load adapter bảo toàn output trong điều kiện deterministic, generated metrics hoạt động và peak VRAM chấp nhận được. Đây là công việc của giai đoạn triển khai, chưa được thực hiện bởi việc viết tài liệu này.

## 12. Lộ trình thực hiện và điều kiện chuyển giai đoạn

| Giai đoạn | Công việc | Điều kiện hoàn tất |
|---|---|---|
| G0 — Đóng băng protocol | Lưu revision/hash; xác định split, ID/group policy, metric, quyền dữ liệu và sampling/assignment user study | Manifest rõ; không có ambiguity về train/dev/test; R4 còn bị chặn nếu quyền nguồn phụ chưa rõ |
| G1 — Cache ASR chuẩn | Pin model/preprocessor/decoder; sinh full train/dev; kiểm tra cache reuse và audio dài | Coverage đủ, ID/reference join đúng, không trộn signatures, lỗi kỹ thuật được giải quyết hoặc báo thành thiếu coverage |
| G2 — D_real và mốc | Audit train pairs; giữ identity; chạy R0/R1/R2 trên dev_tune | Có metric chung, per-recording breakdown và preservation baseline |
| G3 — Fine-tune real-only | Kiểm tra lượt nhỏ, rồi train R3 | Adapter tái tải được; generated dev metrics và review đủ để quyết định |
| G4 — Nguồn phụ | Rights/text review, source grouping, train-only noise profile, D_aux | Không dùng QA labels; parent/source IDs rõ; synthetic noise được kiểm tra |
| G5 — Ablation | R4 và R3-budget; khóa sampling/hyperparameters; ba seed | So sánh có kiểm soát updates và biến động, không chỉ một run đẹp |
| G6 — Test lock và đánh giá | Khóa manifest/model/metrics và checkpoint/seed cho prototype, chạy matrix test và NER/review tương ứng | Đủ official test coverage, báo mọi seed/run và giới hạn gold NER; không dùng kết quả test để chọn lại model cho pilot |
| G7 — Prototype và user study | Hoàn thiện workflow tại mục 1.4; smoke test upload → inference → nghe/sửa → export; pilot theo mục 10.5 | Demo dùng được với dữ liệu hợp lệ; có số đo và review chất lượng bản cuối; nếu pilot bị chặn thì G7 chưa hoàn tất |
| G8 — Báo cáo và bàn giao | Gói demo, code/model/config, reproduction manifest; metrics, uncertainty, cost, case studies và báo cáo sử dụng | Đủ ba nhóm deliverable tại mục 1.4; phân biệt số đã đo/giả thuyết, báo negative results và phần còn bị chặn; không gọi delivery hoàn chỉnh nếu pilot chưa thực hiện |

Có thể khảo sát và rà soát nguồn phụ song song với cache/train real-only. Không để G4 chặn R0–R3. Không thực thi G5 dùng nguồn phụ khi G4 chưa đạt điều kiện.

Có thể xây giao diện prototype khi các lượt train đang chạy, nhưng chỉ kết nối pipeline/checkpoint đã được khóa để đánh giá cuối. Việc demo hoạt động không cho phép bỏ qua G6 hoặc thay user study bằng video minh họa. Lượt nghiệm thu phải kiểm tra cả audio hợp lệ, input ngoài phạm vi hỗ trợ, trạng thái chưa/đã rà soát, giữ bản gốc và export đúng phiên bản text/entity.

Sau mỗi lượt, bổ sung kết quả vào [REPORT_LOG.md](REPORT_LOG.md) bằng entry mới, ghi cả cấu hình, lỗi, quyết định và đường dẫn artifact; không sửa lịch sử để khớp kết quả mới.

## 13. Rủi ro, giới hạn và kết quả âm

| Rủi ro | Xử lý trong protocol | Điều không được khẳng định |
|---|---|---|
| Reference thiếu từ đầu/cuối | Nghe/audit train; giữ raw; chấm test theo policy công bố | Mọi khác biệt với reference đều là lỗi y khoa |
| Train ASR quá dễ hoặc hẹp | Dùng đủ năm recording train; báo identity/error distribution | Tỷ lệ lỗi 500 mẫu là tỷ lệ toàn train hoặc bằng chứng chắc chắn overfit |
| Model sửa thuật ngữ đúng thành từ phổ thông | Identity supervision, preservation probe, review nội dung | WER giảm nghĩa là an toàn |
| Text QA bị scrape lặp/sai | Dedup, bỏ answer supervision, review text và provenance | 31.272 dòng là 31.272 câu clean độc lập |
| Nhiễu synthetic lệch lỗi ASR | Học profile từ train; real stage cuối; R3/R3-budget đối chứng | Denoising synthetic tốt đồng nghĩa sửa speech tốt |
| Model pretrained đã thấy dữ liệu liên quan | Ghi model provenance và giới hạn model card | Đã chứng minh không pretraining contamination |
| Dev/test dùng chung recording | dev_tune tách recording chung; công bố protocol | Speaker-ID-disjoint là source-independent tuyệt đối |
| Dataset/record duplicates | Kiểm tra audio hash trước merge; group policy độc lập WER | Metadata giống nhau chắc chắn là cùng audio/hypothesis |
| Không có gold NER trong hai nguồn | Đặt tên consistency đúng; nhánh gold riêng khi đủ điều kiện | Có thể lấy F1 lịch sử áp cho corrected text |
| Chưa rõ quyền nguồn phụ | Chặn R4 cho đến khi làm rõ, vẫn thực hiện VietMed-only | Dataset public tự động cho phép mọi sử dụng/phân phối |
| WER giảm nhưng công kiểm tra tăng | User study đối chứng, đo thời gian và chất lượng bản cuối | Metric tự động tốt hơn chắc chắn tiết kiệm công |
| Người dùng tin quá mức vào text/entity được tô | Giữ bản gốc/audio, phân biệt đề xuất và đã rà soát, review độc lập | Người dùng bấm xác nhận hoặc NER có nhãn nghĩa là đúng y khoa |
| Audio/transcript có dữ liệu nhạy cảm | Dữ liệu được phép sử dụng, chạy local, giới hạn truy cập/lưu trữ và công bố | Public demo hoặc local inference tự động đáp ứng mọi yêu cầu bảo vệ dữ liệu |

Các kết quả âm vẫn trả lời câu hỏi nghiên cứu: R3 không hơn R2; R4 không hơn real-only; lợi ích biến mất ở matched budget; WER giảm nhưng medical review hoặc NER xấu đi; hoặc nguồn phụ không đủ chất lượng/quyền để dùng. Trong các trường hợp đó giữ baseline phù hợp và báo trung thực.

Hệ thống là công cụ nghiên cứu xử lý tiếng nói và hỗ trợ tạo bản nháp, không đưa chẩn đoán hoặc khuyến nghị điều trị. Một mẫu review/user study nhỏ, prototype chạy được hoặc WER tốt hơn đều không chứng minh an toàn triển khai lâm sàng. Chưa có kiểm chứng riêng thì không chuyển kết luận từ utterance VietMed sang toàn bộ cuộc khám, bệnh án thật hoặc workflow của mọi cơ sở y tế.

## 14. Phụ lục phương pháp audit

### 14.1. Định nghĩa số lượng câu hỏi ứng viên

Các số dưới đây được tính trên revision medical benchmark ở mục 3, không phải một file cleaned đã được phát hành.

1. Null → rỗng; NFC; gộp Unicode whitespace; trim.
2. Lặp việc bỏ prefix đánh số neo ở đầu, không sửa nội dung câu. Pattern case-insensitive:

```text
^(?:câu(?:\s+hỏi)?\s*\d+(?:\s*[:.)/\-–—]\s*|\s+)|\d+\s*[.)/](?!\d)\s*)
```

Negative lookahead tránh xóa tử số của prefix dạng `9/10`. Giữ nguyên spelling/punctuation/capitalization trong candidate, chỉ dùng casefold cho dedup key.

- 30.431 dòng có câu hỏi không rỗng.
- 5.625 câu phân biệt sau NFC/whitespace, còn đánh số.
- 5.189 stem phân biệt nếu giữ case; 5.184 khi casefold.

| Bộ lọc tuần tự | Số stem loại thêm | Còn lại |
|---|---:|---:|
| Không có ký tự đặc trưng tiếng Việt | 904 | 4.280 |
| Prefix câu hỏi tiếng Anh | 0 thêm, đã nằm trong hàng trên | 4.280 |
| Dưới 5 whitespace tokens hoặc dưới 20 Unicode alphabetic characters | 201 | 4.079 |
| Chỉ là hướng dẫn chọn đáp án, không có nội dung | 6 | 4.073 |
| Markup/control-character flag | 1 | 4.072 |
| Tham chiếu ngữ cảnh hoặc chỗ trống theo rule rộng | 78 | 3.994 |
| Ít nhất hai nhãn lựa chọn A.–D. nhúng trong stem | 0 | 3.994 |
| Prefix đánh số bị vỡ | 3 | 3.991 |

Chi tiết để diễn giải bộ lọc, không xem như chuẩn nhận diện ngôn ngữ/quality gold:

- Ký tự tiếng Việt: ít nhất một chữ có dấu tiếng Việt hoặc `đ`; có thể loại nhầm tiêu đề Latin hữu ích.
- English start: `what|which|how|when|where|why|who|a patient|the patient` ở đầu stem, không phân biệt hoa thường. 899 stems khớp, nhưng đó không phải toàn bộ câu tiếng Anh.
- Generic option-only: tập chữ sau casefold chỉ nằm trong vocabulary hướng dẫn chọn đáp án bên dưới; cần tập không rỗng.

```text
biểu bạn bị cho chính chưa chọn các câu có cũng cần cụm của dung dưới hoặc hãy hợp
không là mà mệnh một ngoại nhất những nào nội phát phù rằng sai sau số thích trong
trừ tìm tập tổ từ và với xác án ý đáp đây đúng được đề đều định ở
```

- Markup flag: HTML tag-like, HTML entity, URL, LaTeX `begin/frac/text/left/right`, dollar sign, `**` hoặc Markdown image; Unicode categories Cc/Cf/Cs sau whitespace normalization. Không dùng `<.*>` đơn giản vì có thể bắt nhầm biểu thức so sánh số. Một stem có U+00AD SOFT HYPHEN bị flag.
- Context/gap flag case-insensitive:

```text
hình (?:bên|sau|dưới|trên)|(?:trong|trên|theo|xem) hình|bảng (?:sau|dưới|trên)|(?:trường hợp|tình huống|bệnh án) (?:trên|sau)|bệnh nhân (?:trên|này)|áp dụng|\b(?:ở|trong|với|cho|từ) câu \d|\btrên đây\b|điền vào chỗ trống|\.{3,}|…|_{2,}|\[\s*\]
```

- Embedded labels: ít nhất hai match `(?:^|\s)[A-D][.)]\s`.
- Broken prefix: `^(?:[a-d][.)]\s*|\S{1,3}\s+)câu\s*\d`, case-insensitive.

Rule context/gap cố ý rộng, có thể bắt cả câu tự đủ ngữ cảnh hoặc dấu ba chấm bình thường. Các rejected items phải được giữ trong audit để review, không coi mọi item bị flag là chắc chắn sai.

Trong 3.991 candidates: 734 chỉ có source URL trống; 151 xuất hiện ở nhiều URL. Số câu thực sự được chấp thuận sau review chưa được đo. Nếu thay bộ lọc, tạo version mới và tính lại số lượng, không tiếp tục dùng con số 3.991 cho một pipeline khác.

### 14.2. Kiểm tra giao nhau giữa hai nguồn

So sánh toàn bộ 5.184 stems, và riêng 3.991 candidates, với từng split VietMed:

- Whole-text: NFC + whitespace + casefold, bỏ numbering ở question; chạy thêm biến thể punctuation-insensitive. Không thấy exact match.
- Substring: tokenize Unicode letters/numbers, coi punctuation là ranh giới; không nối các utterance với nhau.
- Ngưỡng chính: đoạn trùng liên tiếp ít nhất 8 tokens **và** 40 ký tự sau join bằng khoảng trắng. Không thấy match ở train/dev/test/cv.
- Sensitivity 6 tokens và 25 ký tự: chạm 4 train rows, 1 dev, 8 test, 0 cv; chủ yếu cụm chung như cách nói về phương pháp điều trị. Không có whole-question/reference containment theo kiểm tra này.

Không kiểm tra paraphrase, bản dịch, option text, tái dựng hội thoại nhiều đoạn hoặc audio overlap. Zero exact overlap không chứng minh không có mọi loại contamination.

### 14.3. Phân biệt sự kiện đã kiểm tra và việc chưa làm

Đã kiểm tra: snapshot/hash; Parquet/archive đọc được; schema/split/metadata; chất lượng text raw; ID/reference joins; thống kê trên hypothesis đã lưu; kiến trúc checkpoint và VRAM qua NVML.

Khảo sát mở rộng tại mục 16 đã kiểm tra metadata/card của 48 repo, đọc dữ liệu của 25 repo trong phạm vi ghi rõ và ghi nhận 23 repo gated. Khảo sát này không phải full download/full semantic audit của 48 corpus, không xác nhận quyền dùng hoặc chất lượng lâm sàng của chúng.

Chưa làm trong đợt khảo sát/tài liệu: sinh full ASR cache mới; xác nhận audio-byte duplicates; review và cấp phép clean auxiliary corpus; implement noise generator; train LoRA; đo peak VRAM training; đánh giá R3/R4; gán gold NER mới; xây và nghiệm thu prototype; thực hiện user study hoặc đo mức tiết kiệm công. Các mục này là công việc research theo lộ trình, không được ghi thành kết quả đã hoàn thành.

## 15. Tài liệu tham khảo

### Nguồn trong repository

- [CORRECTION_IMPLEMENTATION_PLAN.md](CORRECTION_IMPLEMENTATION_PLAN.md): kế hoạch cũ, có các điểm được thay thế trong mục 2.4.
- [ROADMAP_CORRECTION.md](ROADMAP_CORRECTION.md): roadmap baseline/normalization/correction trước đây.
- [REPORT_LOG.md](REPORT_LOG.md): nhật ký baseline và thực nghiệm lịch sử.
- [DO_AN_REPORT.md](DO_AN_REPORT.md), [FINAL_RESULTS.md](FINAL_RESULTS.md): báo cáo baseline, không phải kết quả fine-tune mới.
- [Thí nghiệm zero-shot 001](experiments/001-zeroshot-correction-vietmed/README.md) và [summary](experiments/001-zeroshot-correction-vietmed/outputs/evaluation-summary.json).
- [Train baseline summary](multimed_results_500_train_rerun/summary.json), [test baseline summary](giai_doan_5/summary.json), [gold NER lịch sử](giai_doan_4/ner_gold_metrics.json).

### Nguồn công khai

- [VietMed dataset card](https://huggingface.co/datasets/leduckhai/VietMed), [snapshot đã tải](https://huggingface.co/datasets/leduckhai/VietMed/tree/cc7980cd1392d2d85cf1c692b1d96e8581fc7eec).
- [VietMed paper](https://arxiv.org/abs/2404.05659); [cấu hình chia train/cv gốc](https://github.com/leduckhai/MultiMed/blob/master/VietMed/config/wav2vec2/configA_data/configA01_data_VietMed.py).
- [medical_bench_raw](https://huggingface.co/datasets/Viet-Medical/medical_bench_raw), [snapshot đã audit](https://huggingface.co/datasets/Viet-Medical/medical_bench_raw/tree/61861b94ba9c43f618b6ec5fbb32c9c492039d75).
- [MultiMed-ST models](https://huggingface.co/leduckhai/MultiMed-ST).
- [Vietnamese correction v2](https://huggingface.co/bmd1905/vietnamese-correction-v2).
- [PhoWhisper](https://github.com/VinAIResearch/PhoWhisper): ASR đối chiếu, không gộp vào cache chính.
- [BARTpho documentation](https://huggingface.co/docs/transformers/model_doc/bartpho).
- [PEFT LoRA documentation](https://huggingface.co/docs/peft/en/package_reference/lora).
- [VietMed-NER](https://huggingface.co/datasets/leduckhai/VietMed-NER): nguồn gold riêng, ngoài hai snapshot của nghiên cứu chính.

## 16. Khảo sát mở rộng: 48 dataset cho training và hardening

### 16.1. Phạm vi, độ phủ và cách đọc kết quả

Nguồn yêu cầu: [Hugging Face — medical vietnam, sort by downloads](https://huggingface.co/datasets?sort=downloads&search=medical+vietnam). Lúc **2026-09-06 07:08 UTC**, trang tìm kiếm báo **48 repo**; [API tương ứng](https://huggingface.co/api/datasets?search=medical%20vietnam&sort=downloads&direction=-1&limit=100&full=true) trả 48 ID duy nhất, không có trang tiếp theo. Đã khảo sát cả 48, không dừng ở 30 kết quả trang đầu. Đây là tập kết quả của truy vấn cụ thể, không phải mọi dataset y khoa tiếng Việt trên Internet; VietMed và medical_bench_raw nền không nằm trong 48 kết quả này.

**Độ phủ thực tế:**

- **48/48 repo:** kiểm tra card/metadata công khai, revision, cấu trúc file, schema/split được công bố và điều kiện truy cập.
- **25 repo:** đọc được dữ liệu thực qua viewer hoặc file gốc; lấy mẫu ở các vị trí cách nhau khi có thể. Ngôn ngữ trong bảng là ngôn ngữ đã quan sát ở mẫu, không phải thống kê language-ID toàn corpus.
- **23 repo:** dữ liệu gated, các đường viewer/raw-file trả HTTP 401; chỉ có metadata/card công khai. Không suy ra ngôn ngữ, độ sạch hoặc chất lượng từ tên repo/tổ chức. HTTP 429 tạm thời được xử lý bằng đọc tuần tự/range fallback; không đánh đồng rate limit với gating.
- Kiểm tra cơ học sâu hơn: toàn bộ 85.525 dòng metadata noise; toàn bộ 658 text của bộ hội chẩn; toàn bộ các bảng benchmark/log public trong nhóm evaluation. “Kiểm tra cơ học toàn bảng” không có nghĩa đã nghe mọi audio, đọc mọi đoạn hoặc xác minh từng phát biểu y khoa.

Audit chi tiết lưu local ở `datasets/derived/correction/audit/hf-medical-vietnam-survey-2026-09-06.json`: đủ 48 ID/revisions, configs/splits, phạm vi mẫu, provenance/license, quyết định và evidence URLs; có kết quả hash/header/noise/overlap. File nằm dưới `/datasets/` được ignore, không tự có trong clone Git. Bảng bên dưới là kết quả khảo sát trong tài liệu; các trang dataset có thể thay đổi sau thời điểm khảo sát. Trước sử dụng, lấy revision đã ghi trong audit và tạo source manifest/hash như mục 3/11.

**Kết luận:** có ứng viên đáng khảo sát tiếp, nhưng **chưa có bộ nào được phê duyệt để nạp nguyên trạng vào correction training**. Giữ VietMed làm supervision chính. “Harden” ở đây là giữ đúng nội dung dưới lỗi ASR, tiếng ồn và tình huống dễ overcorrect; không chuyển model thành chatbot trả lời hoặc sửa kiến thức y khoa của người nói.

### 16.2. Shortlist và thứ tự ưu tiên

| Ưu tiên | Dataset | Giá trị đối với pipeline | Điều kiện trước khi dùng |
|---|---|---|---|
| A — audio bổ sung | [HieuNguyen203/Vietnamese_Medical_Consultation](https://huggingface.co/datasets/HieuNguyen203/Vietnamese_Medical_Consultation) | 460 train + 198 test, có audio và text; gần nhất với supervision cần thiết ngoài VietMed | License/consent, nguồn recording/speaker, chất lượng audio–text và overlap; sinh hypothesis bằng đúng frozen ASR, không mặc định text là gold đã duyệt |
| N — acoustic hardening | [manhcuong2005/vietnam_medical_noise_dataset](https://huggingface.co/datasets/manhcuong2005/vietnam_medical_noise_dataset) | 85.525 đoạn noise theo metadata; thêm nhiễu vào audio rồi đo pipeline và/hoặc sinh thêm training pairs | Quyền từng nguồn, original-noise/mixture parent mapping và split, kiểm tra speech lẫn trong noise; WHAM gốc có điều kiện phi thương mại |
| T — text phụ nhỏ để review | [hungnm/vietnamese-medical-qa](https://huggingface.co/datasets/hungnm/vietnamese-medical-qa) | 9.335 QA; câu hỏi gần văn phong người bệnh, có phủ định và cách diễn đạt tự nhiên | Loại thông tin định danh, tách các ca bị ghép, sửa lỗi crawl/orthography bằng review, dedup; chỉ lấy text độc lập đã duyệt, không học question → answer |
| T — dự phòng, ưu tiên thấp | [Dqdung205/medical-vietnamese-qa](https://huggingface.co/datasets/Dqdung205/medical-vietnamese-qa), [mtue29/vietnamese-medical-dataset](https://huggingface.co/datasets/mtue29/vietnamese-medical-dataset) | Nguồn câu hỏi hoặc prose/thuật ngữ bổ sung sau trích lọc | Dqdung có PHI-like text/lỗi crawl và overlap; mtue là triplets retrieval, nhiều snippet lặp hoặc bị cắt giữa câu, article_id không đủ để chia nguồn an toàn |
| B — chỉ xét held-out diagnostics | [II-Vietnam/Medical-VN-Benchmark](https://huggingface.co/datasets/II-Vietnam/Medical-VN-Benchmark) | Câu hỏi thi tiếng Việt để thiết kế probe bảo toàn thuật ngữ/số/phủ định đã review | Giữ ngoài training, dedup/group câu hỏi, xác minh nguồn/quyền; đáp án MCQ không phải reference correction hoặc gold NER |

Ưu tiên này dựa trên độ khớp bài toán và bằng chứng kiểm tra, **không phải cải thiện WER đã đo**. Không thay medical_bench_raw bằng nguồn mới âm thầm trong R4: mỗi nguồn được chấp thuận phải là một nhánh ablation có manifest, ngân sách và tên riêng.

### 16.3. Inventory đầy đủ 48 repo

Quy ước:

- **A/N/T:** ứng viên audio/noise/text có điều kiện; T thấp chỉ đáng trích lọc sau các lựa chọn tốt hơn.
- **G:** dữ liệu gated; số dòng/schema là khai báo, chưa xác minh actual rows. Không đưa vào training khi chưa đủ quyền truy cập và kiểm tra.
- **X:** không dùng nguyên trạng trong pipeline hiện tại do không đúng tác vụ hoặc có vấn đề đã quan sát.
- **B:** benchmark/exclusion list hoặc diagnostic held-out; không biến thành training chỉ vì HF đặt tên split `train`.
- License **A\*** = Apache-2.0 được khai báo; **SA\*** = CC-BY-SA-4.0 được khai báo; **?** = chưa rõ quyền từ tài liệu đã kiểm tra. Dấu `*` không xác nhận upstream rights/consent. Với noise, **NC** là hạn chế phi thương mại của WHAM gốc, không phải license đầy đủ cho mọi thành phần repack.
- Số dòng mặc định là `default/train`, trừ chỗ ghi khác; không cộng các config/derivative thành số ví dụ độc lập.

| # | Dataset | Rows/splits | License | Quan sát và quyết định |
|---|---|---:|---|---|
| 1 | [manhcuong2005/vietnam_medical_noise_dataset](https://huggingface.co/datasets/manhcuong2005/vietnam_medical_noise_dataset) | 85.525 | ? / WHAM NC | **N:** metadata noise, không transcript; 442,072 giờ cộng từ metadata, gồm raw và mixtures |
| 2 | [hungnm/vietnamese-medical-qa](https://huggingface.co/datasets/hungnm/vietnamese-medical-qa) | 9.335 | A* | **T:** QA tiếng Việt; câu hỏi có thể hữu ích sau review, nhưng thấy tên/năm sinh gắn bệnh sử và nhiều ca bị ghép |
| 3 | [manhcuong2005/vietnam_medical_ambient_noise](https://huggingface.co/datasets/manhcuong2005/vietnam_medical_ambient_noise) | 2.250 | ? / WHAM NC | **X:** chỉ thấy wham_raw, khác card bảy nhóm/~442 giờ; một WAV trùng byte với #1 |
| 4 | [mtue29/vietnamese-medical-dataset](https://huggingface.co/datasets/mtue29/vietnamese-medical-dataset) | 463.422 | A* | **T thấp:** anchor/positive/negative + meta, tiếng Việt; retrieval triplets, lặp positive, có fragment |
| 5 | [Dqdung205/medical-vietnamese-qa](https://huggingface.co/datasets/Dqdung205/medical-vietnamese-qa) | 13.594 | SA* | **T thấp:** QA tiếng Việt từ Vinmec/Long Châu theo card; PHI-like text, ghép từ/ca, overlap họ article |
| 6 | [ntkhoi/Medical-Pretrain-Vietnamese](https://huggingface.co/datasets/ntkhoi/Medical-Pretrain-Vietnamese) | 143.310 khai báo | A* / prose NC | **G:** text-only theo schema; chưa xem rows; card giới hạn non-commercial dù tag Apache |
| 7 | [ynguyen1010/medical_vietnamese_datasets](https://huggingface.co/datasets/ynguyen1010/medical_vietnamese_datasets) | cleaned_format 68.498; tfidf 68.494 | A* | **X:** hai biến đổi overlap; thấy thuật ngữ bị tách hỏng và tfidf cắt text, không phải 136.992 ví dụ độc lập |
| 8 | [hungsvdut2k2/vietnamese-medical-chat-data](https://huggingface.co/datasets/hungsvdut2k2/vietnamese-medical-chat-data) | 46.479 | ? | **X:** conversation user/assistant tiếng Việt; không có audio/source/review xác minh |
| 9 | [HieuNguyen203/Vietnamese_Medical_Consultation](https://huggingface.co/datasets/HieuNguyen203/Vietnamese_Medical_Consultation) | train 460; test 198 | ? | **A:** audio + text hội chẩn tiếng Việt; không có speaker/source ID hoặc gold NER trong schema |
| 10 | [khoaliamle/vietnamese-medical-qa](https://huggingface.co/datasets/khoaliamle/vietnamese-medical-qa) | 18.709 | A* | **X:** QA/context tiếng Việt; sáu mẫu trùng #27 sau bỏ classification, không phải nguồn độc lập đã chứng minh |
| 11 | [II-Vietnam/Public-Medical-Reasoning-Dataset](https://huggingface.co/datasets/II-Vietnam/Public-Medical-Reasoning-Dataset) | 181.204 khai báo | ? | **G:** card mô tả reasoning do LLM sinh; chưa quan sát ngôn ngữ rows; không phải transcript targets |
| 12 | [II-Vietnam/Medical-ChatDoctor-HealthCareMagic-100k-Qwen3](https://huggingface.co/datasets/II-Vietnam/Medical-ChatDoctor-HealthCareMagic-100k-Qwen3) | 112.003 khai báo | ? | **G:** schema responses/judge scores; không coi generated answers là gold |
| 13 | [II-Vietnam/Medical-MedQA-Synthetic](https://huggingface.co/datasets/II-Vietnam/Medical-MedQA-Synthetic) | 8.475 khai báo | ? | **G:** schema MCQ, generated responses/rewards; ngôn ngữ thực chưa biết |
| 14 | [II-Vietnam/Medical-Guideline-V0-Prompt](https://huggingface.co/datasets/II-Vietnam/Medical-Guideline-V0-Prompt) | 99.685 khai báo | ? | **G:** question/reference_answer/source theo card; không biết nguồn guideline hay ngôn ngữ thực |
| 15 | [Dqdung205/medical_vietnamese_datasets](https://huggingface.co/datasets/Dqdung205/medical_vietnamese_datasets) | 344.056 | SA* | **T thấp, không dùng raw:** article chunks/QA tiếng Việt, overlap ranh giới, text thiếu thành phần; cùng họ #7/#36 |
| 16 | [II-Vietnam/Medical-Book-V0-Prompt](https://huggingface.co/datasets/II-Vietnam/Medical-Book-V0-Prompt) | 623.229 khai báo | ? | **G:** text QA/source theo schema; quyền sách và nội dung chưa xác minh |
| 17 | [II-Vietnam/Medical-ChatDoctor-HealthCareMagic-100k-Qwen3-verify](https://huggingface.co/datasets/II-Vietnam/Medical-ChatDoctor-HealthCareMagic-100k-Qwen3-verify) | 267.924 khai báo | ? | **G:** verification records theo schema, không coi số record là số ca độc lập |
| 18 | [II-Vietnam/Medical-Web-V0-Prompt](https://huggingface.co/datasets/II-Vietnam/Medical-Web-V0-Prompt) | 430.078 khai báo | ? | **G:** question/reference_answer/source; nguồn web/ngôn ngữ chưa quan sát |
| 19 | [II-Vietnam/Medical-Guideline-V0-Prompt-Traces-Qwen3](https://huggingface.co/datasets/II-Vietnam/Medical-Guideline-V0-Prompt-Traces-Qwen3) | 99.065 khai báo | ? | **G:** generated traces/verification, không audio hoặc correction gold |
| 20 | [II-Vietnam/Medical-Paper-V0-Prompt](https://huggingface.co/datasets/II-Vietnam/Medical-Paper-V0-Prompt) | 524.855 khai báo | ? | **G:** chưa biết paper IDs, nguồn/quyền hoặc ngôn ngữ rows |
| 21 | [II-Vietnam/Medical-Wiki-V0-Prompt](https://huggingface.co/datasets/II-Vietnam/Medical-Wiki-V0-Prompt) | 182.033 khai báo | ? | **G:** chưa có revision/article lineage hoặc mẫu nội dung wiki xác minh |
| 22 | [II-Vietnam/Medical-Patient-V0-Prompt-Qwen3](https://huggingface.co/datasets/II-Vietnam/Medical-Patient-V0-Prompt-Qwen3) | 162.205 khai báo | ? | **G:** question/response/reference/judge metadata; khác nguồn Patient public #43 |
| 23 | [II-Vietnam/Medical-Patient-V0-Prompt-Qwen3-verify](https://huggingface.co/datasets/II-Vietnam/Medical-Patient-V0-Prompt-Qwen3-verify) | 507.855 khai báo | ? | **G:** verification records; không có bằng chứng human gold |
| 24 | [II-Vietnam/Medical-Book-V0-Prompt-Traces-Qwen3](https://huggingface.co/datasets/II-Vietnam/Medical-Book-V0-Prompt-Traces-Qwen3) | 269.444 khai báo | ? | **G:** không ngoại suy lỗi ở sibling #34 sang rows bị khóa này |
| 25 | [II-Vietnam/II-Medical-8B-V2-Health-Bench](https://huggingface.co/datasets/II-Vietnam/II-Medical-8B-V2-Health-Bench) | 5.000 khai báo | ? | **G/B:** schema rubric/score/prompt/completion gợi ý export đánh giá; không training trên benchmark |
| 26 | [II-Vietnam/Medical-MedMCQA-Synthetic](https://huggingface.co/datasets/II-Vietnam/Medical-MedMCQA-Synthetic) | 199.580 khai báo | ? | **G:** schema MCQ/reasoning; rủi ro nguồn benchmark, chưa đo overlap |
| 27 | [dangmanh1811/synthetic-vietnamese-medical-qa](https://huggingface.co/datasets/dangmanh1811/synthetic-vietnamese-medical-qa) | 18.709 | ? | **X:** QA/context tiếng Việt chứa dấu vết reasoning; sáu mẫu trùng #10, doc_0 tái dùng output #30 |
| 28 | [II-Vietnam/EvalMedical_MMLU-Pro_Medical_Test](https://huggingface.co/datasets/II-Vietnam/EvalMedical_MMLU-Pro_Medical_Test) | 1.535 | ? | **B:** MCQ mẫu tiếng Anh, transformed MMLU-Pro test; 1.316 question stems phân biệt |
| 29 | [II-Vietnam/EvalMedical_GPQA_Medical_Test](https://huggingface.co/datasets/II-Vietnam/EvalMedical_GPQA_Medical_Test) | 390 | ? | **B:** MCQ mẫu tiếng Anh; chỉ 78 exact unique rows, mỗi row lặp năm lần |
| 30 | [dangmanh1811/vietnamese-medical-qa](https://huggingface.co/datasets/dangmanh1811/vietnamese-medical-qa) | 7.206 | ? | **X:** instruction/conversation có reasoning markup tiếng Việt, nguồn context cho mẫu #27/#10 |
| 31 | [quannguyen204/vietnamese_medical_corpus_dataset](https://huggingface.co/datasets/quannguyen204/vietnamese_medical_corpus_dataset) | 151.622 | ? | **T thấp:** prose/QA tiếng Việt; thấy quảng cáo, giá dịch vụ, title/body lệch và boilerplate |
| 32 | [tmnam20/vietnamese-medical-article](https://huggingface.co/datasets/tmnam20/vietnamese-medical-article) | default 188.739; 19 source configs khai báo | ? | **G:** tổng 19 config bằng default; không cộng gấp đôi, chưa xem được nội dung/config nào |
| 33 | [hungsvdut2k2/vietnamese-medical-notes](https://huggingface.co/datasets/hungsvdut2k2/vietnamese-medical-notes) | 18.058 | ? | **X:** thực tế là conversations tiếng Việt, có tham chiếu hình không kèm hình và diễn đạt bất thường |
| 34 | [II-Vietnam/Medical-Book-V0-Prompt-Traces-Qwen3-verify-Qwen3-8b](https://huggingface.co/datasets/II-Vietnam/Medical-Book-V0-Prompt-Traces-Qwen3-verify-Qwen3-8b) | 269.444 | ? | **X:** mẫu tiếng Anh; có judge chấm nhầm chủ đề/câu hỏi, không dùng verification scores làm gold |
| 35 | [lengocquangLAB/vietnamese-medical-qa](https://huggingface.co/datasets/lengocquangLAB/vietnamese-medical-qa) | 20.789 | ? | **X mặc định:** MCQ tiếng Việt, nguồn/key chưa xác minh; chỉ xét probe thuật ngữ đã review, không QA→answer training |
| 36 | [quannguyen204/vietnamese-medical-article-corpus](https://huggingface.co/datasets/quannguyen204/vietnamese-medical-article-corpus) | 68.498 | ? | **X:** article-title/question→body tiếng Việt; row 0 bị nhân đôi nguyên nửa, overlap #7/#15 |
| 37 | [vnhkhwa/VMAD-Medical-Vietnamese](https://huggingface.co/datasets/vnhkhwa/VMAD-Medical-Vietnamese) | 3 | ? | **X:** đã đọc cả ba; instruction/input/output thiếu ngữ cảnh, output có lỗi thuật ngữ/khuyến nghị đáng báo động |
| 38 | [II-Vietnam/Medical-VN-Benchmark](https://huggingface.co/datasets/II-Vietnam/Medical-VN-Benchmark) | 12.488 | ? | **B:** MCQ mẫu tiếng Việt; 11.144 stems phân biệt; key nhất quán cơ học không chứng minh đúng chuyên môn |
| 39 | [II-Vietnam/inspect_simpleqa_ii_medical_8b_tool_e5_wikipedia_18_128k](https://huggingface.co/datasets/II-Vietnam/inspect_simpleqa_ii_medical_8b_tool_e5_wikipedia_18_128k) | 4.326 | ? | **X/B:** log SimpleQA, mẫu tiếng Anh/general knowledge; có output model sai, không phải medical text gold |
| 40 | [II-Vietnam/inspect_frames_tue_ii_medical](https://huggingface.co/datasets/II-Vietnam/inspect_frames_tue_ii_medical) | 822 | ? | **X/B:** log FRAMES tiếng Anh trong mẫu; benchmark lineage đã đối chiếu, không corpus training mới |
| 41 | [hungsvdut2k2/raft-vietnamese-medical-chat-data](https://huggingface.co/datasets/hungsvdut2k2/raft-vietnamese-medical-chat-data) | 39.893 | ? | **X:** retrieval QA tiếng Việt; assistant answer nằm nguyên trong user prompt ở cả sáu mẫu |
| 42 | [II-Vietnam/Medical-Reasoning-QwQ](https://huggingface.co/datasets/II-Vietnam/Medical-Reasoning-QwQ) | 20.277 khai báo | ? | **G:** generated reasoning/answer theo schema; không phải human transcript gold |
| 43 | [II-Vietnam/Medical-Patient-V0-Prompt](https://huggingface.co/datasets/II-Vietnam/Medical-Patient-V0-Prompt) | 162.992 | ? | **X:** sáu conversation mẫu đều tiếng Anh; actual schema messages/conversation, không audio |
| 44 | [II-Vietnam/Medical-SFT-Qwen2.5-7B-Instruct-24-april-Rollout](https://huggingface.co/datasets/II-Vietnam/Medical-SFT-Qwen2.5-7B-Instruct-24-april-Rollout) | 231.349 khai báo | ? | **G:** rollout schema, không corpus phát ngôn y khoa đã xác minh |
| 45 | [II-Vietnam/Medical-SFT-Qwen2.5-7B-Instruct-24-april-Rollout-v1](https://huggingface.co/datasets/II-Vietnam/Medical-SFT-Qwen2.5-7B-Instruct-24-april-Rollout-v1) | 368.750 khai báo | ? | **G:** 30/30 Parquet Git objects và sizes trùng #48 theo pinned tree API |
| 46 | [II-Vietnam/Medical-Book-V0-Prompt-Traces-Qwen3-Patch-2](https://huggingface.co/datasets/II-Vietnam/Medical-Book-V0-Prompt-Traces-Qwen3-Patch-2) | 353.785 khai báo | ? | **G:** trace patch family; không coi là nguồn độc lập chỉ vì tên khác |
| 47 | [II-Vietnam/OnPolicy-Medical-SFT-Experiment-v0](https://huggingface.co/datasets/II-Vietnam/OnPolicy-Medical-SFT-Experiment-v0) | 159.186 khai báo | ? | **G:** experiment/rollout metadata, chưa có mẫu ngôn ngữ hoặc gold xác minh |
| 48 | [meoconxinhxan/II-Vietnam_Medical-SFT-Qwen2.5-7B-Instruct-28-april-Rollout](https://huggingface.co/datasets/meoconxinhxan/II-Vietnam_Medical-SFT-Qwen2.5-7B-Instruct-28-april-Rollout) | 368.750 khai báo | ? | **G:** trùng file objects với #45; không cộng thành 737.500 ví dụ mới độc lập |

### 16.4. Các phát hiện ảnh hưởng trực tiếp tới quyết định

**Audio hội chẩn:** kiểm tra cơ học toàn bộ 658 text cho thấy 0 text rỗng, 0 normalized whole-text duplicates trong/giữa train–test và 0 normalized whole-text overlap với từng split VietMed. Normalization là NFC/lowercase, bỏ ký tự ngoài word/whitespace, gộp khoảng trắng. Đọc định tính 12 transcript ở đầu/giữa/cuối hai split; hai WAV header mẫu là mono PCM16, 16 kHz, 30 giây. Đây không phải nghe/align toàn bộ audio, không chứng minh source/speaker-disjoint hoặc text đúng chuyên môn. Không có recording/speaker/consent metadata để xác nhận các điều đó.

**Noise và quyền nguồn:** đọc toàn bộ `metadata.parquet` 494.817 bytes, SHA-256 `64d45f5e425dbc2ccc8e568f5903e00b452a15096649e7a4824fd60368d1abe9`. Có 85.525 paths phân biệt, duration dương và sample_rate metadata đều 16 kHz:

| Nhóm | Rows | Giờ theo metadata |
|---|---:|---:|
| wham_raw | 25.000 | 76,181 |
| hospital_raw | 562 | 0,781 |
| output_raw | 3.321 | 27,444 |
| wham_plus_hospital | 25.000 | 76,181 |
| output_plus_hospital | 3.321 | 27,444 |
| output_plus_wham | 3.321 | 27,444 |
| triple | 25.000 | 206,597 |

Tổng trước làm tròn là 442,072 giờ; phần lớn không phải recordings bệnh viện độc lập. Đã kiểm tra một WAV mỗi nhóm: mono PCM16/16 kHz, duration khớp metadata mẫu. Chưa kiểm tra tồn tại, tính độc lập hoặc chất lượng âm thanh của mọi path.

[Nguồn WHAM gốc](http://wham.whisper.ai/) công bố noise ở San Francisco Bay Area, có train/dev/test gốc, loại các đoạn speech nghe hiểu được và license **CC-BY-NC-4.0**. Bản gốc mô tả 28.000 files, stereo float32, độ dài biến thiên; repack đang có 25.000 wham_raw rows cùng duration 10,97 giây. Cần làm rõ phép biến đổi và khôi phục mapping split gốc; không suy split từ số lượng trùng hợp. License/card của repack không xác minh quyền phần hospital/YouTube/mixtures và không loại bỏ hạn chế phi thương mại của WHAM. Nếu hướng tới sản phẩm thương mại, cần nguồn noise/quyền sử dụng phù hợp khác hoặc được cấp phép riêng.

Repo ambient #3 chỉ có thư mục wham_raw ở root và viewer 2.250 rows với label `wham_raw-0/1/2`. WAV đầu tiên của #1/#3 có cùng SHA-256 `e52aeba1ea01431820b4f280f30ec583d2682a26bbebe1b42a32664f6d2886fc`. Đây là overlap một file đã chứng minh, không phải bằng chứng toàn bộ hai repo giống nhau; không dùng hai repo làm train/test noise “độc lập” nếu chưa group theo nguồn.

**QA và text “cleaned” không tự thành target sạch:**

- Hungnm/Dqdung có mẫu nêu tên đầy đủ, năm sinh gắn bệnh sử và ghép nhiều ca. Không chép dữ liệu nhạy cảm vào demo/report; deidentify và kiểm tra quyền trước mọi trích lọc.
- Dqdung underscore, quannguyen article-corpus và ynguyen cleaned/tfidf có article/QA mẫu dùng chung. Một answer của quannguyen dài 10.678 ký tự gồm hai nửa 5.339 ký tự giống hệt. Ynguyen có thuật ngữ bị tách ký tự; một tfidf answer chỉ còn 300 whitespace tokens trong khi trường đếm vẫn là 1.211. Đây là lỗi dữ liệu gốc đã quan sát, không phải viewer tự cắt.
- Mtue có positives lặp theo negative khác nhau; cùng title xuất hiện ở nhiều article_id. Không random split theo row hoặc tin article_id là ID bài gốc.
- Sáu vị trí kiểm tra của khoaliamle và dangmanh synthetic có payload trùng sau bỏ classification; doc_0 còn tái dùng output reasoning của dangmanh bản khác. Chưa đo tỷ lệ overlap toàn corpus, nhưng đã đủ để không coi ba repo là ba nguồn độc lập.

**“Verify” không phải human gold:** trong #34, 9/11 row được kiểm tra trọn vẹn về alignment có câu hỏi và nội dung judge khác chủ đề; đây là mẫu không đại diện, không phải tỷ lệ lỗi toàn corpus. Hai row đầu đã được kiểm tra lại độc lập: câu hỏi về dinh dưỡng người cao tuổi nhưng judge đánh giá siêu âm định lượng; câu hỏi về hepcidin nhưng judge đánh giá chọc dò thắt lưng. Các mẫu giữa/cuối có thể align đúng. Không dùng score đó làm reward/filter/gold trước khi sửa và audit join; không ngoại suy lỗi sang siblings gated.

**Benchmark contamination:** GPQA fork 390 rows chỉ có 78 exact unique rows, mỗi row lặp năm lần, khớp upstream GPQA. MMLU fork có 1.535 stems khớp official test nhưng một số answer text khác phiên bản hiện tại; khác biệt lịch sử không tự chứng minh answer sai. Các prompt/reference của SimpleQA và FRAMES logs khớp upstream sau xử lý dấu `?` cuối câu; không phải ví dụ medical mới. Medical-VN-Benchmark có 12.488 IDs nhưng 11.144 question stems phân biệt. Tên split `train`, tên tác giả có “Vietnam”, hoặc model outputs kèm `is_correct` không biến chúng thành Vietnamese correction gold.

**License chưa giải quyết:** ntkhoi có tag Apache-2.0 nhưng card ghi chỉ dùng phi thương mại/nghiên cứu/giáo dục, đồng thời gated. Không chọn cách diễn giải thuận lợi rồi ingest. Các tag Apache/CC-BY-SA ở repo crawl cũng không chứng minh quyền upstream hoặc consent. Không có bằng chứng đủ để chọn một bộ gold NER mới từ 48 repo này.

### 16.5. Protocol dùng nguồn mới để training và hardening

Các nhánh dưới đây là đề xuất sau khảo sát, **chưa thực hiện**, và không thay đổi ngầm protocol R0–R4 đã nêu.

**A. Audio thật bổ sung — ưu tiên sát bài toán**

1. Làm rõ nguồn/quyền/consent và recording/speaker groups của bộ hội chẩn; nghe/align, review reference trên train. Không sửa text test để làm model có vẻ tốt hơn.
2. Giữ test 198 mẫu cho external evaluation sau khi xác minh độc lập; không chuyển vào train. Không coi zero exact text overlap là bằng chứng không audio/source leakage.
3. Dùng cùng ASR signature để sinh `hypothesis → reference` từ train được chấp thuận. LoRA real stage tiếp tục giữ identity/preservation; so với R3 và đối chứng cùng budget, không quy lợi ích thêm updates thành lợi ích domain data.

**B. Acoustic hardening — tác động lên audio, không bịa text errors**

```text
VietMed audio x + noise n đã duyệt → audio nhiễu
  → cùng frozen ASR → hypothesis nhiễu
  → correction đang đánh giá → cùng reference của lời nói gốc
```

- Chốt parent/source groups trước chia noise train/dev/test. Một raw noise và mọi mixture/biến đổi chứa nó phải cùng nhóm; split của speech cũng giữ nguyên. Nếu không khôi phục được nguồn/parent mapping, chưa được tuyên bố holdout noise độc lập.
- Chỉ lấy noise được phép dùng và đã kiểm tra không mang speech thứ hai nghe hiểu được. Đặc biệt không mặc định YouTube/hospital noise là non-speech; speech thêm vào có thể làm reference gốc không còn đầy đủ.
- Stress test ban đầu gồm clean và các mức **SNR 20/10/0 dB**, là grid thiết kế chứ không phải điều kiện bệnh viện đã đo. Dùng noise crop/offset/seed cố định; RMS tính trên cùng cửa sổ trộn theo một định nghĩa đã chốt. Với RMS noise bằng 0 phải báo lỗi chọn mẫu, không chia cho 0.

```text
alpha = RMS(x) / (RMS(n) × 10^(SNR_dB / 20))
x_noisy = x + alpha × n
```

- Lưu parent IDs, noise hash/offset, requested/measured SNR, resampling và gain policy; tránh clipping làm sai SNR. Mọi run so sánh dùng đúng cùng audio nhiễu và ASR cache.
- **Chỉ evaluation:** không cập nhật model từ các case test mới xem. **Nếu augmentation training:** chỉ tạo pairs từ speech train và noise train; target vẫn là lời nói thật, không phải label `noise_type`.
- Báo WER/CER, overcorrection/lỗi quan trọng và NER consistency theo noise category/SNR/recording, thêm clean regression và runtime. Không loại các trường hợp khó sau khi xem WER; dữ liệu không nghe hiểu được cần báo riêng nhưng không bị âm thầm bỏ.

**C. Text phụ — một nguồn mỗi ablation**

- Bắt đầu với một tập nhỏ câu hỏi Hungnm đã làm rõ quyền, deidentify, tách ca và review surface text. Dqdung hoặc prose Mtue là nhánh dự phòng, không gộp cả 48 repo.
- Giữ ý nghĩa phát ngôn, số, đơn vị, tên thuốc và phủ định; không “sửa kiến thức” bằng suy đoán. Câu hỏi→đáp án, heading→snippet, MCQ→letter và instruction→reasoning đều không phải correction pairs.
- Dedup cross-repo theo source article/question/context và gần trùng trước chia dữ liệu; không chỉ dedup row IDs. Tạo nhiễu từ train ASR confusion profile như mục 7, không học noise rules từ test.
- So với real-only và matched-budget; chốt số câu độc lập đã duyệt/token budget thay vì dùng số hàng hoặc số repo làm bằng chứng đa dạng. Mỗi nguồn có run/manifest riêng, không tự ghi kết quả là R4 gốc.

**D. Hardening bảo toàn nội dung**

Tạo một tập challenge riêng đã review và khóa trước training, không giao parent/source với train. Bao gồm text vốn đúng phải giữ nguyên; tên thuốc/thuật ngữ dễ bị đổi thành từ phổ thông; số, số thập phân, liều/đơn vị; phủ định; câu cụt đầu/cuối không được tự hoàn thiện; câu hỏi y khoa phải được phiên âm chứ không được trả lời.

Có thể dùng text từ nguồn đã được phép để tạo các case này, nhưng expected output phải là transcript trung thành đã review, không phải đáp án/tư vấn của dataset. Khi dùng Medical-VN-Benchmark làm nguồn diagnostic, giữ nó ngoài training, group câu hỏi lặp và ghi rõ đây không phải đánh giá QA hoặc gold NER. Không dùng case test lịch sử đã thấy lỗi làm train rule; benchmark exclusions áp dụng xuyên các repo derivative.

### 16.6. Quyết định triển khai sau khảo sát

1. **Giữ đường chính VietMed → frozen ASR → correction → frozen NER.** Chưa có thí nghiệm chứng minh nguồn mới nào giúp giảm WER, cải thiện NER hoặc giảm công sửa thủ công.
2. **Ưu tiên audit bộ hội chẩn và nguồn noise**, vì chúng bổ sung đúng yếu tố audio/error distribution mà text QA không cung cấp. Với noise, ưu tiên provenance/split gốc có thể kiểm tra hơn repack hỗn hợp thiếu mapping; tôn trọng điều kiện phi thương mại.
3. **Text phụ chỉ thử nhỏ, đã duyệt, từng nguồn một**; Hungnm là ứng viên review đầu tiên, không phải corpus clean đã phê duyệt. Không tăng quy mô bằng cách cộng các bản lặp, cleaned variants hoặc model traces.
4. **Chưa dùng 23 repo gated** khi không có quyền truy cập hợp lệ. Khi được cấp quyền, cần inspect rows/language/provenance/quality rồi mới đổi quyết định; card/schema không đủ.
5. **Giữ benchmark và evaluation logs ngoài training.** Hardening cần đo khả năng bảo toàn lời nói dưới nhiễu, không phải học đáp án từ tập đánh giá.
6. Nghiệm thu vẫn theo mục 1.4, 10 và 12: pipeline tái hiện được, demo, số đo chất lượng/cost và user study. Dataset nhiều hơn hoặc training loss thấp hơn không thay thế bằng chứng người dùng sửa ít hơn mà không tăng lỗi còn sót.
