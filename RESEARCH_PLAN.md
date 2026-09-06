# Research plan: Hiệu chỉnh lỗi ASR y khoa tiếng Việt với VietMed và text y khoa bổ trợ

- **Ngày lập:** 2026-09-06.
- **Nhánh tài liệu:** `hieutk/research`.
- **Trạng thái:** thiết kế nghiên cứu và protocol triển khai; chưa huấn luyện các cấu hình R3/R4 được đề xuất bên dưới.
- **Phạm vi dữ liệu:** hai snapshot đã tải, `leduckhai/VietMed` và `Viet-Medical/medical_bench_raw`.
- **Quyết định chính:** đóng băng ASR và NER; fine-tune mô-đun correction; dùng VietMed làm supervision chính, text trắc nghiệm đã rà soát làm nguồn phụ có đối chứng.

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

Giả thuyết cần kiểm chứng, không phải kết luận sẵn có:

- Supervision lỗi ASR thật có thể hữu ích hơn chỉ dùng checkpoint sửa lỗi văn bản tổng quát.
- Dữ liệu tổng hợp dựa trên phân bố lỗi train có thể bổ sung supervision cho miền y khoa.
- Identity supervision có thể giảm xu hướng sửa văn bản vốn đã đúng.
- Cải thiện WER không tự động đồng nghĩa với cải thiện NER hoặc an toàn nội dung.

### 1.3. Những việc không thuộc đường nghiên cứu chính

- Không đồng thời fine-tune ASR và NER; thay nhiều mô-đun sẽ làm mất khả năng quy tác động cho correction.
- Không chuyển bài toán thành medical QA, chatbot tư vấn hoặc chẩn đoán.
- Không dùng TTS thay thế audio thật rồi gọi đó là lỗi ASR tự nhiên của VietMed.
- Không tự viết lại reference test, bổ sung lời nói bị thiếu bằng suy đoán, hoặc tạo luật từ các case test đã xem.
- Không yêu cầu một LLM lớn mới khi checkpoint correction hiện tại đã hỗ trợ seq2seq.

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

Manifest JSON phải serializable và có schema được kiểm tra khi triển khai. Một hash manifest không thay thế việc kiểm tra ID coverage hoặc nguồn dữ liệu đúng split.

### 11.3. Pin môi trường và kiểm tra trước lượt chính

Ghi Python, PyTorch, CUDA/driver, Transformers, PEFT, Datasets, audio backend, tokenizer và JiWER versions. Checkpoint hiện tại từng chạy với Transformers khác version trong config; không coi version ghi trong model config là môi trường bắt buộc hoặc môi trường local hiện hành.

Lượt kiểm tra nhỏ phải chứng minh: audio decode/resample đúng, batch padding và labels đúng, forward/backward có gradient ở adapter, save/load adapter bảo toàn output trong điều kiện deterministic, generated metrics hoạt động và peak VRAM chấp nhận được. Đây là công việc của giai đoạn triển khai, chưa được thực hiện bởi việc viết tài liệu này.

## 12. Lộ trình thực hiện và điều kiện chuyển giai đoạn

| Giai đoạn | Công việc | Điều kiện hoàn tất |
|---|---|---|
| G0 — Đóng băng protocol | Lưu revision/hash; xác định split, ID/group policy, metric và quyền dữ liệu | Manifest rõ; không có ambiguity về train/dev/test; R4 còn bị chặn nếu quyền nguồn phụ chưa rõ |
| G1 — Cache ASR chuẩn | Pin model/preprocessor/decoder; sinh full train/dev; kiểm tra cache reuse và audio dài | Coverage đủ, ID/reference join đúng, không trộn signatures, lỗi kỹ thuật được giải quyết hoặc báo thành thiếu coverage |
| G2 — D_real và mốc | Audit train pairs; giữ identity; chạy R0/R1/R2 trên dev_tune | Có metric chung, per-recording breakdown và preservation baseline |
| G3 — Fine-tune real-only | Kiểm tra lượt nhỏ, rồi train R3 | Adapter tái tải được; generated dev metrics và review đủ để quyết định |
| G4 — Nguồn phụ | Rights/text review, source grouping, train-only noise profile, D_aux | Không dùng QA labels; parent/source IDs rõ; synthetic noise được kiểm tra |
| G5 — Ablation | R4 và R3-budget; khóa sampling/hyperparameters; ba seed | So sánh có kiểm soát updates và biến động, không chỉ một run đẹp |
| G6 — Test lock và đánh giá | Khóa manifest/model/metrics, chạy matrix test và NER/review tương ứng | Đủ official test coverage, báo mọi seed/run và giới hạn gold NER |
| G7 — Báo cáo | Bảng metrics, uncertainty, cost, case studies, quyết định pipeline | Phân biệt số đã đo với giả thuyết; có negative results và reproduction manifest |

Có thể khảo sát và rà soát nguồn phụ song song với cache/train real-only. Không để G4 chặn R0–R3. Không thực thi G5 dùng nguồn phụ khi G4 chưa đạt điều kiện.

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

Các kết quả âm vẫn trả lời câu hỏi nghiên cứu: R3 không hơn R2; R4 không hơn real-only; lợi ích biến mất ở matched budget; WER giảm nhưng medical review hoặc NER xấu đi; hoặc nguồn phụ không đủ chất lượng/quyền để dùng. Trong các trường hợp đó giữ baseline phù hợp và báo trung thực.

Hệ thống là công cụ nghiên cứu xử lý tiếng nói, không đưa chẩn đoán hoặc khuyến nghị điều trị. Một mẫu review nhỏ không chứng minh an toàn triển khai lâm sàng.

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

Chưa làm trong đợt khảo sát/tài liệu: sinh full ASR cache mới; xác nhận audio-byte duplicates; review và cấp phép clean auxiliary corpus; implement noise generator; train LoRA; đo peak VRAM training; đánh giá R3/R4; gán gold NER mới. Các mục này là công việc research theo lộ trình, không được ghi thành kết quả đã hoàn thành.

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
