# VoDoCo — UI Direction

**Hướng chọn: Calm Clinical Notebook — một trang phiên âm dễ đọc, có thực thể để đối chiếu.** Không làm dashboard bệnh viện hoặc chatbot. Điểm nổi bật khi demo là người xem nghe một đoạn audio, thấy văn bản và thực thể xuất hiện, rồi hiểu được hai model NER khác nhau ở đâu.

- **Ngày nghiên cứu:** 2026-09-17, 12:35 +07:00.
- **Trạng thái (cập nhật 2026-09-18):** Các frame Pencil đã được xác nhận và xuất ở kích thước gốc; ứng dụng React/BFF và luồng GPU thật đã chạy local theo định hướng này. Chưa có nghiệm thu triển khai công khai hoặc usability test. Xem `docs/demo-readiness.md` và `docs/demo-design/frame-map.md` để phân biệt bằng chứng thực tế với các gate còn mở.
- **Report:** `UI_DIRECTION.md` tại repo root, theo tên người dùng yêu cầu và vị trí các tài liệu nghiên cứu hiện có. Không tạo thêm report trùng nội dung.
- **Đối tượng:** Người trình diễn và người xem đồ án; không giả định đây là phần mềm đã được bác sĩ dùng trong khám chữa bệnh.
- **Nền tảng:** Web, ưu tiên laptop/màn chiếu; vẫn dùng được trên điện thoại. Tiếng Việt là ngôn ngữ giao diện.
- **Phạm vi nghiên cứu gốc (2026-09-17):** Nghiên cứu UI liên quan, chọn visual direction, định nghĩa 3 màn hình và các trạng thái đủ cho một demo trọn vẹn; phiên nghiên cứu đó không triển khai app, không sửa `design.pen`, không đổi pipeline nghiên cứu. Phần triển khai tiếp theo được theo dõi riêng trong plan và tài liệu demo, không thay đổi phạm vi hành vi đã duyệt dưới đây.

## Mục lục

1. [Quyết định thiết kế](#quyet-dinh)
2. [Xu hướng và nguồn tham khảo](#xu-huong)
3. [Visual direction](#visual)
4. [Luồng và ba màn hình](#man-hinh)
5. [Trạng thái và tính trung thực](#trang-thai)
6. [Responsive và accessibility](#responsive)
7. [Kịch bản demo và tiêu chí nghiệm thu](#demo)
8. [Nguồn và phương pháp](#nguon)
9. [Bước tiếp theo và điểm còn mở](#tiep-theo)

<a id="quyet-dinh"></a>
## 1. Quyết định thiết kế

### Người xem cần hiểu được ba điều

1. **Đầu vào:** Một đoạn tiếng nói y khoa tiếng Việt.
2. **Model làm gì:** ASR tạo transcript; NER nhận diện các cụm từ và gán loại thực thể.
3. **Con người làm gì:** Nghe đối chiếu, sửa bản riêng và xuất kết quả; model không đưa ra chẩn đoán.

**Câu định vị trên UI:** “Phiên âm tiếng nói y khoa. Nhận diện thực thể. Rà soát trước khi sử dụng.”

### Phạm vi giao diện đã chọn

| Có trong demo | Không đưa vào demo này |
|---|---|
| Audio mẫu, upload, ghi âm ngắn | Đăng nhập, quản lý bệnh nhân, lịch khám, billing |
| Audio player và transcript gốc | Chatbot, hỏi đáp, chẩn đoán, tóm tắt bệnh án tự sinh |
| Thực thể dự đoán theo nhóm | Dashboard KPI, pie chart hoặc heatmap để trang trí |
| Bản rà soát riêng, chạy lại NER, xuất TXT/JSON | Sửa transcript tự động hoặc tự ghi đè bản gốc |
| Đối chiếu XLM-R và PhoBERT trên cùng văn bản | Triage/ranking đoạn lỗi của experiment 003 |
| Thông tin model và benchmark gọn, mở khi cần | Trang hyperparameter, training console, quản trị hệ thống |

**Một phiên audio tại một thời điểm.** Không cần sidebar lịch sử. Kết quả giữ trong phiên; không hứa có lưu bền vững hoặc tự khôi phục khi reload. Có cảnh báo rời phiên chưa xuất dữ liệu.

**Model đích:** MultiMed-ST Whisper-small → PhoBERT fine-tuned. XLM-R là đối chứng được ghi tên rõ. Correction tắt và không có toggle trên luồng chính. Việc thiếu PhoBERT là trạng thái thật cần hiển thị, không được âm thầm đổi model mà vẫn giữ nhãn PhoBERT.

<a id="xu-huong"></a>
## 2. Xu hướng và nguồn tham khảo

Đây là các **pattern đang được sản phẩm lân cận sử dụng**, không phải bảng xếp hạng độ phổ biến UI năm 2026. Hai website sản phẩm được đọc ở phiên bản hiện hành; hướng dẫn NHS/Google được dùng làm nền tảng thiết kế, không gán cho chúng một ngày phát hành mới chưa xác minh.

| Pattern phù hợp | Bằng chứng | Áp dụng cho VoDoCo | Không sao chép |
|---|---|---|---|
| **Nội dung là giao diện chính** | Granola đặt trải nghiệm quanh notepad; Descript dùng văn bản làm bề mặt thao tác với bản ghi [S1][S2] | Transcript ở trung tâm; phần điều khiển gọn, ít chrome | Không thêm AI viết lại nội dung hoặc meeting bot |
| **Đi hết một tác vụ trong một workspace** | Descript thể hiện chuỗi Record → Edit → Refine → Share [S2] | Audio, transcript, thực thể và xuất file nằm trong cùng khung | Sửa chữ không cắt/sửa audio như Descript |
| **Cho người dùng hiểu và kiểm soát AI** | Google PAIR tổ chức hướng dẫn quanh mental models, trust, feedback/controls và graceful failures [S3] | Hiện tên model thật, giữ bản gốc, cho sửa và chạy lại; lỗi có đường phục hồi | Không dùng score làm huy hiệu “đúng 99%”, không giả live transcript |
| **Chữ rõ, cấu trúc rõ hơn hiệu ứng** | NHS quy định heading nhất quán; body mặc định 19px trên màn lớn, 16px trên màn nhỏ [S4] | Transcript lớn, line-height thoáng; nền sáng và tương phản cao | Không dùng logo, Frutiger có điều kiện cấp phép hoặc nhận diện NHS |
| **Chi tiết kỹ thuật chỉ mở khi cần** | Quyết định thiết kế tổng hợp từ [S2][S3], không phải số liệu xu hướng | So sánh model là nhánh phụ; thông tin phiên/benchmark nằm trong khối mở rộng | Không bắt người dùng chọn GPU, tokenizer, seed trước khi thử |

### Ba hướng hình ảnh đã cân nhắc

| Hướng | Ưu điểm | Đánh đổi | Quyết định |
|---|---|---|---|
| **Calm Clinical Notebook**: sáng, chữ lớn, điểm nhấn teal, panel gọn | Đọc transcript tốt; demo dễ hiểu; đủ nghiêm túc cho nội dung y khoa | Ít hiệu ứng gây ấn tượng tức thời | **Chọn. Sự chỉn chu đến từ bố cục và tương tác.** |
| **Research Workbench**: dense, nhiều bảng số, màu tối | Thuận tiện debug/đánh giá model | Trông như công cụ nội bộ; người xem phải hiểu metric trước | Chỉ mượn cấu trúc đối chiếu cho màn 03 |
| **Conversational AI**: ô chat, orb/gradient, streaming | Quen thuộc với ứng dụng LLM | Gợi sai kỳ vọng rằng app biết tư vấn hoặc sinh câu trả lời | Không chọn |

Các tên direction trên là phương án đề xuất cho dự án, không phải danh mục xu hướng đã được khảo sát định lượng.

<a id="visual"></a>
## 3. Visual direction

### Hình dung tổng thể

Một mặt bàn xám rất nhạt, trên đó là trang transcript trắng. Header thấp, wordmark “VoDoCo” bên trái, nhãn “Demo nghiên cứu” kế bên. Audio player là một thanh ngang gọn. Bên dưới: văn bản chiếm phần lớn diện tích, thực thể nằm ở panel phải. Không có sidebar, ảnh bác sĩ stock, nền lưới, gradient tím hoặc hiệu ứng kính mờ.

**Tỷ lệ ưu tiên:** transcript > thực thể > audio controls > thông tin kỹ thuật. Màn 01 là ngoại lệ: vùng đưa audio vào giữ trọng tâm.

### Màu sắc

| Token | Giá trị | Dùng cho |
|---|---|---|
| `canvas` | `#F7F8FA` | Nền ứng dụng |
| `surface` | `#FFFFFF` | Trang transcript, panel, dialog |
| `ink` | `#18212F` | Chữ chính |
| `muted` | `#526174` | Metadata, mô tả phụ; không dùng xám quá nhạt |
| `primary` / `primary-hover` | `#0F766E` / `#115E59` | CTA chính, trạng thái chọn |
| `soft-border` | `#E2E8F0` | Phân nhóm trang trí, không làm dấu hiệu duy nhất của input |
| `control-border` | `#64748B` | Viền input và control cần nhận biết |
| `focus` | `#2563EB` | Focus ring 2px, offset 2px |

**Màu entity là loại thông tin, không phải mức nguy hiểm:**

| Nhóm trình bày | Chữ / nền | Quy tắc |
|---|---|---|
| Bệnh / triệu chứng | `#9A3412` / `#FFF7ED` | Nhãn nghiệp vụ `DISEASESYMTOM` |
| Cơ quan | `#1E40AF` / `#EFF6FF` | `ORGAN` |
| Thuốc / hóa chất | `#5B21B6` / `#F5F3FF` | `DRUGCHEMICAL` |
| Các loại còn lại | `#475569` / `#F1F5F9` | Giữ tên tiếng Việt cụ thể; không ép tất cả thành nhãn “Khác” |

Không tạo 18 màu cho 18 loại entity. Mỗi hàng luôn có tên loại bằng chữ; màu chỉ hỗ trợ quét mắt. Mỗi occurrence là một hàng, không nhập hai lần xuất hiện thành một entity duy nhất.

### Chữ, kích thước và nhịp điệu

- **Một font:** Noto Sans có bộ ký tự tiếng Việt; fallback `system-ui, sans-serif`. Khi triển khai, ưu tiên self-host để tránh request font bên thứ ba không cần thiết.
- H1 32/40px, weight 600; tiêu đề panel 18/28px, weight 600; UI body 16/24px; metadata 14/20px.
- **Transcript:** 19/32px trên desktop, 17/29px trên mobile; canh trái; tối đa khoảng 65–75 ký tự/dòng khi bố cục cho phép. Không căn đều hai bên.
- Số thời gian dùng tabular numerals; không dùng monospace cho toàn bộ transcript.
- Spacing 4–8–12–16–24–32–48px. Container tối đa 1200px; gutter desktop 32px, mobile 16px.
- Card radius 12px; button/input 8px; badge pill. Panel padding 24px desktop, 16px mobile.
- Shadow chỉ nhẹ trên dialog/menu; panel chính dùng nền và đường chia. Một bộ icon outline Lucide, 18–20px, không emoji.
- Control chính cao 44px. Mỗi trạng thái chỉ có **một CTA màu teal**; hành động còn lại outline hoặc text.
- Motion 150–200ms cho opacity/state. Không typewriter transcript, không waveform nhảy ngẫu nhiên, không kéo dài animation để giả model đang suy nghĩ.

**Các cặp màu đã tính contrast:** ink/white 16,19:1; muted/white 6,32:1; muted/canvas 5,95:1; white/primary 5,47:1; bốn cặp entity lần lượt 6,88 / 8,01 / 8,19 / 6,92:1. Đây là kiểm tra palette, chưa phải chứng nhận accessibility của app.

<a id="man-hinh"></a>
## 4. Luồng và ba màn hình

```text
01 Bắt đầu
   ├─ Thử audio mẫu / tải file / ghi âm
   └─ Xem lại đầu vào → Phiên âm và nhận diện
                           │
                    Trạng thái xử lý
                           │
02 Rà soát kết quả ─────────┼────→ Xuất TXT/JSON → Bản ghi mới
   │                       │
   ├─ Nghe audio           └────→ Lỗi từng bước → Thử lại bước lỗi
   ├─ Xem bản ASR gốc
   ├─ Sửa bản rà soát → Cập nhật NER → Xác nhận đã rà soát
   └─ 03 So sánh model → Quay lại màn 02, giữ nguyên phiên
```

**Chỉ có hai trang logic:** Bắt đầu và Workspace. Màn 02/03 là hai view của Workspace; xuất file là dialog nhỏ, loading/error là state, không thêm route chỉ để tăng số màn hình.

Các wireframe dưới mô tả cấu trúc, không phải screenshot app. `[Tên nút]` là control; chữ mô tả vùng kết quả không phải dữ liệu được phép hardcode khi triển khai.

### Màn 01 — Bắt đầu một bản ghi

**Mục tiêu:** Người mới nhìn vào biết ngay cách thử, không phải đọc hướng dẫn model.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ VoDoCo   Demo nghiên cứu                         Thông tin mô hình    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│                Từ tiếng nói đến thực thể y tế                         │
│          Đưa vào một đoạn audio để phiên âm và rà soát.               │
│                                                                      │
│          ┌────────────────────────────────────────────────┐          │
│          │ [Tải tệp — đang chọn]      [Ghi âm]            │          │
│          │                                                │          │
│          │       Kéo thả audio vào đây                     │          │
│          │       hoặc [Chọn tệp]                           │          │
│          │       WAV, MP3, M4A, WebM · tối đa 30 giây      │          │
│          │                                                │          │
│          │       [Phiên âm và nhận diện]                   │          │
│          └────────────────────────────────────────────────┘          │
│                                                                      │
│          Chưa có file? Thử audio mẫu · 6 giây                         │
│          Model NER: PhoBERT · trạng thái do backend cung cấp          │
│                                                                      │
│          Chỉ dùng audio được phép sử dụng.                            │
│          Bản demo nghiên cứu, không dùng để chẩn đoán.                │
└──────────────────────────────────────────────────────────────────────┘
```

**Hành vi và copy:**

- “Thử audio mẫu” chọn file mẫu thật [L3], đưa vào cùng bước preview như upload; không mở kết quả dựng sẵn và không gọi đó là inference live.
- Sau khi chọn: thay dropzone bằng tên file, duration, audio player và nút text “Đổi tệp”. CTA xử lý chỉ bật khi audio và model đã sẵn sàng.
- Tab “Ghi âm”: “Bắt đầu ghi” → timer thật, nhãn “Đang ghi âm”, nút “Dừng”; sau đó nghe lại hoặc “Ghi lại”. Không cấp quyền micro trước khi người dùng bấm ghi; dừng micro tracks khi dừng/rời tab.
- **Quyết định phạm vi demo đề xuất:** upload tối đa 30 giây / 10 MiB; ghi âm tối đa 10 giây. Đây là policy cần backend thực thi, không phải giới hạn đã có sẵn trong app. WAV/MP3/M4A/WebM chỉ được quảng bá sau khi decoder được kiểm tra.
- Nếu PhoBERT chưa có: dòng amber “Chưa nạp checkpoint PhoBERT”; hành động riêng “Dùng XLM-R baseline”. Sau lựa chọn này, toàn bộ metadata đổi sang XLM-R; không tự đổi ngầm.
- Thông tin mô hình mở popover nhỏ: ASR, NER/checkpoint, correction tắt. Không có menu cấu hình dài.

### Màn 02 — Rà soát kết quả

**Đây là màn hình trọng tâm và là hình nên dùng để giới thiệu app.** Layout desktop khoảng 2/3 transcript, 1/3 entities; khoảng cách 24px. Player nằm ngay trên hai panel và vẫn dễ truy cập khi đọc.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ VoDoCo   Demo nghiên cứu                [Bản ghi mới] [Xuất kết quả] │
├──────────────────────────────────────────────────────────────────────┤
│ audio.wav · 00:06                  ASR: Whisper-small · NER: XLM-R   │
│ [Phát] ────────────── 00:00 / 00:06       [1×]       [Nghe từ đầu]   │
│                                                                      │
│ [Rà soát — đang chọn]   [So sánh model]                               │
│ ┌─────────────────────────────────────┐ ┌──────────────────────────┐ │
│ │ Bản phiên âm                        │ │ Thực thể dự đoán · 4     │ │
│ │ [ASR gốc] [Bản rà soát]              │ │ Nguồn: ASR gốc           │ │
│ │                                     │ │                          │ │
│ │ bệnh đau xương khớp thì nhiều        │ │ đau         Bệnh/triệu chứng│
│ │ người cũng bị tái phát vậy thì       │ │ xương khớp  Cơ quan      │ │
│ │ trong cái thời tiết hiện tại thì     │ │ tái phát    Bệnh/triệu chứng│
│ │ bác sĩ cũng lời khuyên nào           │ │ bác sĩ      Nghề nghiệp  │ │
│ │                                     │ │                          │ │
│ │ Bản ASR gốc luôn được giữ lại.      │ │ Lọc theo loại [Tất cả]   │ │
│ │ [Tạo bản rà soát]                   │ │ Chi tiết khi chọn một mục│ │
│ └─────────────────────────────────────┘ └──────────────────────────┘ │
│ Kết quả do model dự đoán; cần nghe đối chiếu.                          │
└──────────────────────────────────────────────────────────────────────┘
```

**Dữ liệu minh họa màn này:** transcript và bốn entity ở trên là output ASR + XLM-R đã chạy local trong phiên khảo sát trước trên [L3], không phải output PhoBERT, không phải transcript chuẩn. Giữ cả chỗ câu chưa tự nhiên; không sửa tay rồi trình bày như model đã sinh đúng. Giao diện chạy thật dùng dữ liệu response, không hardcode bốn entity này.

**Panel transcript:**

- Mặc định “ASR gốc”, chỉ đọc. “Tạo bản rà soát” tạo bản copy để sửa, không đổi `raw_text` và không chỉnh audio.
- “Bản rà soát” có trạng thái “Chưa rà soát” / “Đã chỉnh sửa — cần cập nhật thực thể” / “Đã rà soát”. Trạng thái cuối do người dùng xác nhận, không do model tự gán.
- Chỉnh text làm entity của bản đó **stale ngay**: ẩn highlights cũ; panel ghi “Văn bản đã thay đổi. Cập nhật thực thể để tiếp tục.” Nút “Cập nhật thực thể” trở thành CTA chính; chỉ chạy NER, không chạy ASR lại.
- Kết quả NER phải gắn với đúng phiên bản text và đúng model. Response của phiên bản cũ đến muộn không được thay entity của phiên bản đang xem.
- Trong lúc gõ, dùng editor văn bản thường; chỉ highlight trong chế độ đọc có offsets hợp lệ. Không làm rich-text editor phức tạp cho demo.
- Sau khi cập nhật NER thành công, bật lại “Xuất kết quả”; checkbox “Tôi đã nghe đối chiếu bản này” là tùy chọn. Xuất bản chưa rà soát vẫn được, nhưng phải giữ nhãn đó trong file.

**Panel entity:**

- Heading luôn ghi nguồn “ASR gốc” hoặc “Bản rà soát”; số lượng là occurrences được trả về, không phải số bệnh phát hiện.
- Một danh sách gọn, từng hàng gồm cụm từ và loại; chi tiết kỹ thuật/score chỉ mở khi chọn. Không có donut chart.
- Nếu có offsets đã xác minh: click hàng focus đúng span trong transcript; click span chọn hàng tương ứng. Keyboard có hành vi tương đương.
- Nếu offsets thiếu/không khớp: vẫn hiển thị danh sách, ghi “Chưa có vị trí chính xác trong văn bản”; không tự match occurrence đầu tiên rồi giả là span đúng. Không có click entity → nhảy tới audio khi chưa có timestamp.
- Các nhãn UI dịch sang tiếng Việt, còn export giữ đúng nhãn model, kể cả spelling `DISEASESYMTOM`.

**Xuất kết quả:** dialog rộng khoảng 420px, gồm “TXT — bản văn bản đang xem” và “JSON — toàn bộ phiên”. CTA “Tải xuống”. JSON giữ ASR gốc, bản rà soát nếu có, nguồn text, phiên bản text/model của entities và trạng thái rà soát; không tự đính kèm audio hoặc đường dẫn riêng tư trên máy chủ. Không xuất entities stale như thể thuộc text mới; vẫn cho tải TXT để tránh mất bản sửa khi NER lỗi.

### Màn 03 — So sánh model

**Mục tiêu:** Giải thích đóng góp nghiên cứu của Tài mà không biến app thành dashboard. Cùng một transcript, hai bộ entity, không chạy lại ASR để so NER.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ VoDoCo   Demo nghiên cứu                      [Quay lại rà soát]     │
├──────────────────────────────────────────────────────────────────────┤
│ So sánh nhận diện thực thể                                            │
│ Nguồn: cùng bản ASR gốc · audio và transcript không thay đổi           │
│ [Phát audio] ──────────────────────────── thời gian thực của file      │
│                                                                      │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Bản ASR gốc — cùng đầu vào cho hai model, chỉ đọc                 │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌──────────────────────────────┐ ┌────────────────────────────────┐ │
│ │ XLM-R · baseline             │ │ PhoBERT · fine-tuned           │ │
│ │                              │ │                                │ │
│ │ Danh sách thực thể trả về    │ │ Danh sách thực thể trả về      │ │
│ │ Nhãn loại cạnh từng cụm từ   │ │ Nhãn loại cạnh từng cụm từ     │ │
│ │ Số occurrences từ response  │ │ Số occurrences từ response    │ │
│ └──────────────────────────────┘ └────────────────────────────────┘ │
│ Hai model có thể cùng sai. Nhiều thực thể hơn không có nghĩa tốt hơn. │
│                                                                      │
│ [Mở thông tin benchmark đã lưu]                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Quy tắc đơn giản:**

- Màn này cố định trên **ASR gốc** để đối chiếu research rõ ràng. Nếu đang sửa bản rà soát ở màn 02, giữ nguyên draft và thông báo nguồn so sánh là bản gốc; quay lại không mất draft.
- Chỉ chạy NER đối chứng còn thiếu; mỗi cột có loading/error riêng, không xóa kết quả cột còn lại. So sánh live dùng đúng cùng chuỗi text và metadata model được trả về.
- Không tô xanh “đúng”, đỏ “sai” khi không có nhãn chuẩn. Không chọn “winner” từ số entities hoặc average score. Không cần thuật toán diff/entity matching để hoàn thành màn này.
- Thiếu PhoBERT: cột phải hiện “Chưa nạp checkpoint PhoBERT”, không lấy kết quả XLM-R thay vào. Kết quả lịch sử nếu có phải nằm ở khối riêng, ghi rõ là dữ liệu đã lưu.
- Khối benchmark đóng mặc định. Khi mở, dùng bảng nhỏ: **XLM-R F1 58,62%; PhoBERT F1 62,42%; 3.497 câu VietMed-NER test; nguồn notebook giai đoạn 14 [L2].** Chú thích: metric offline trên văn bản có nhãn, không phải chất lượng audio vừa upload; không dùng bảng stage 13 chưa chuẩn hóa nhãn nền `0`.
- Không có tab “Training”, chart loss hoặc bộ chọn 18 hyperparameter. Artifact/checkpoint details nằm trong thông tin model.

<a id="trang-thai"></a>
## 5. Trạng thái và tính trung thực

| Trạng thái | UI cụ thể | Hành động phục hồi |
|---|---|---|
| Chưa chọn audio | Dropzone, link audio mẫu, CTA xử lý chưa bật | Chọn file hoặc ghi âm |
| Micro bị từ chối/không hỗ trợ | “Không truy cập được micro. Bạn có thể tải tệp audio.” | Chuyển upload; không mắc kẹt trong modal quyền |
| File hỏng/sai định dạng/quá giới hạn | Lỗi ngay dưới file; nêu lý do và giới hạn thật | “Chọn tệp khác”; không âm thầm cắt audio |
| Model đang nạp | “Đang nạp mô hình…”; chưa cho gửi inference | Chờ hoặc thông báo lỗi nạp; không giả đã sẵn sàng |
| Đang inference | Nếu backend có events: “Chuẩn bị audio → Phiên âm → Nhận diện thực thể”; nếu không: chỉ “Đang xử lý audio…” | Giữ layout, khóa gửi trùng; không tự tăng phần trăm/ETA |
| ASR thành công, NER lỗi | Hiện transcript, entity panel có lỗi riêng | “Thử nhận diện lại”; vẫn nghe/xuất transcript được |
| ASR không trả văn bản | “Chưa tạo được bản phiên âm. Hãy nghe lại và thử đoạn rõ hơn.” | Nghe lại hoặc đổi audio; không khẳng định im lặng nếu không có phép đo |
| Không có entity | “Model chưa nhận diện được thực thể trong bản này.” | Cho rà soát/chạy lại; không viết “Không có bệnh” |
| Text vượt giới hạn NER | Giữ transcript, chỉ rõ NER chưa xử lý toàn văn | Dùng đoạn ngắn hơn; không lặng lẽ cắt ở 256 subtokens |
| Text thay đổi | Entity/highlight cũ được gỡ khỏi bản sửa; banner stale | “Cập nhật thực thể”; xuất TXT vẫn được |
| Bản ghi mới/rời trang khi có draft | Hộp xác nhận “Bỏ phiên chưa xuất?” | Ở lại hoặc bỏ có chủ ý; không hứa autosave |
| Lỗi tải file xuất | Giữ phiên và nội dung trên màn hình | Thử tải lại; không reset về trang đầu |

**Không dùng:** phần trăm confidence như “độ chính xác”; timestamp entity giả; nhãn bác sĩ/bệnh nhân khi chưa có diarization; progress giả; sample output thay live output mà không nói; badge “an toàn”, “chuẩn y khoa”, “đã chẩn đoán”.

**Dữ liệu nhạy cảm:** ưu tiên audio mẫu được phép dùng. UI phải nói đúng nơi xử lý/lưu/xóa audio do bản triển khai thực tế cung cấp; không tự gắn “100% local”, “không lưu dữ liệu” hoặc “HIPAA compliant”. Không public-share link, third-party analytics hay tự đưa transcript vào URL trong demo này. Micro chỉ thu khi người dùng chủ động bật và luôn có trạng thái đang ghi dễ thấy.

<a id="responsive"></a>
## 6. Responsive và accessibility

- **Desktop ≥1024px:** header 64px; container tối đa 1200px; workspace 2 cột, entity panel tối thiểu khoảng 320px. Màn 03 có hai cột kết quả bằng nhau.
- **Tablet 768–1023px:** một cột; transcript trước, entities sau. So sánh hai panel xếp dọc, giữ tên model và nguồn text cạnh kết quả.
- **Mobile 375–767px:** gutter 16px; H1 26/34px. Player → transcript → entities; “Xuất” ở thanh hành động trong document flow. Không nhét ba cột hoặc tạo bảng kéo ngang.
- Ưu tiên một vùng scroll trang; không tạo ba vùng cuộn lồng nhau. Player sticky trên desktop phải có offset không che nội dung; mobile cho cuộn bình thường.
- Body/control text tối thiểu 16px; metadata 14px; mục tiêu thao tác tối thiểu 44×44px. Nội dung tiếng Việt dài được wrap, không che bằng ellipsis thiếu cách đọc đầy đủ.
- Heading semantic, label thật cho upload/record/editor. Button có chữ; icon-only chỉ dùng khi có accessible name và tooltip không phụ thuộc hover.
- Tab/Enter/Space dùng được; focus rõ. Mở dialog đưa focus vào, Escape đóng, đóng trả focus về nút mở. Không chiếm Space khi người dùng đang gõ để điều khiển audio.
- Thông báo thay đổi trạng thái qua live region, không đọc lại toàn transcript sau mỗi thao tác. Lỗi và nhóm thực thể luôn có chữ, không chỉ màu.
- Tôn trọng `prefers-reduced-motion`; hỗ trợ zoom 200%; ưu tiên native audio controls nếu custom player chưa đảm bảo keyboard semantics.
- Chỉ thiết kế **light theme** cho phạm vi này; không thêm dark-mode toggle chưa được thiết kế/kiểm tra đầy đủ.

<a id="demo"></a>
## 7. Kịch bản demo và tiêu chí nghiệm thu

### Kịch bản trình diễn đề xuất, khoảng 2–3 phút

1. Mở màn 01; nói một câu về mục tiêu. Chọn audio mẫu thật hoặc một clip ngắn đã được phép sử dụng.
2. Nghe preview, bấm “Phiên âm và nhận diện”. UI phản ánh trạng thái inference thật, không dựng animation kéo dài.
3. Màn 02: nghe audio, đọc transcript, chỉ ra một entity và loại của nó. Nếu có lỗi, giữ lỗi để giải thích ranh giới ASR/NER.
4. Mở màn 03: cho thấy hai model xử lý cùng văn bản. Mở bảng benchmark nếu cần giải thích đóng góp fine-tune; không hứa PhoBERT thắng trên mọi câu.
5. Quay lại màn 02; tạo bản rà soát, sửa sau khi nghe, cập nhật NER. Cho thấy ASR gốc không bị mất.
6. Xuất JSON/TXT; kết thúc bằng output thực người xem có thể mang đi, không kết thúc ở spinner hoặc màn hình kết quả không có hành động tiếp.

Không lấy thời lượng kịch bản làm cam kết latency. Lượt smoke local trước chỉ xác nhận một audio 6 giây chạy được ASR + XLM-R; không đại diện latency của PhoBERT hoặc mọi thiết bị.

### Tiêu chí để gọi UI demo là trọn vẹn

- [ ] Từ trang đầu thử được audio mẫu, upload hoặc ghi âm mà không chọn hyperparameter.
- [ ] Một lượt inference thật nối được audio → transcript → entity; tên model hiển thị khớp model thực chạy.
- [ ] Có player, bản gốc bất biến và bản rà soát tách biệt; sửa text không giữ entity stale.
- [ ] Màn đối chiếu dùng cùng ASR gốc; hai cột có provenance, trạng thái thiếu model và lỗi riêng.
- [ ] Không có model score/benchmark nào bị trình bày thành độ chính xác của ca hiện tại.
- [ ] Xuất dữ liệu thực, chọn được TXT/JSON; mất NER không làm mất transcript/draft.
- [ ] Empty/loading/error/không có entity được thiết kế, không chỉ happy path.
- [ ] Hiển thị tốt ở 1440×900, 1024×768 và 390×844; keyboard và zoom 200% không mất chức năng chính.
- [ ] Mọi dữ liệu minh họa đều ghi nguồn; không dùng text hoặc kết quả dựng sẵn để giả inference.

### Handoff để dựng thiết kế

Dựng đúng **3 frame desktop** theo màn 01/02/03, thêm variant nhỏ cho recording, processing, missing-model, stale-entities và export dialog; thêm **1 frame mobile của màn 02**. Đây là yêu cầu cho bước thiết kế tiếp theo, chưa phải các frame đã tồn tại trong `design.pen`.

Nếu tiếp tục trên Pencil, tái sử dụng bộ component shadcn đã thấy trong canvas ở phiên kiểm tra trước: Button, Input, Tabs, Badge, Card, Dialog. Không dùng Sidebar/Data Table chỉ vì thư viện có sẵn. Áp palette/type scale ở mục 3; phần transcript là vùng đọc/editor, entity là list hàng gọn.

<a id="nguon"></a>
## 8. Nguồn và phương pháp

### Phương pháp

- **Câu hỏi:** Pattern nào giúp demo ASR → NER rõ ràng, dễ đọc và trung thực với năng lực model, với ít màn hình nhất?
- **Nguồn ngoài:** 4 nguồn first-party dưới đây; 1 lượt tìm kiếm discovery với từ khóa `2025 2026 transcription app interface design transcript editor Granola Descript Linear UI redesign official`, sau đó đọc trực tiếp nguồn chính thức. Không lấy nhận định từ bài affiliate/review làm bằng chứng.
- **Độ mới:** Website sản phẩm được đọc ngày 2026-09-17, không xác nhận ngày publish của trang động. NHS/PAIR là hướng dẫn nền tảng đang truy cập được, không coi là bằng chứng một trend mới ra trong 12 tháng qua.
- **Giới hạn nguồn:** Nội dung sản phẩm là thông tin do nhà cung cấp công bố, không phải thử nghiệm usability độc lập. `read` chỉ trả app shell của PAIR; đã kiểm tra trang render bằng browser, dùng các nhóm nguyên tắc hiện trên trang tổng quan, không trích dẫn chi tiết chương chưa đọc được.
- **Nguồn nội bộ:** Ba artifact chính [L1]–[L3], cộng kết quả khảo sát model ở lượt trước. Không suy rằng các tương tác review/export/compare trong tài liệu này đã có backend.
- **Thiết kế:** Công cụ gợi ý design system nội bộ được dùng để tham khảo; đề xuất newsletter/landing page không phù hợp đã bị loại. Direction và palette cuối là quyết định riêng cho VoDoCo, không phải sao chép output công cụ hoặc website đối chiếu.
- **Xác minh trong lượt này:** Đã tính contrast của palette. Wireframe là đặc tả Markdown; chưa dựng high-fidelity UI, chưa thử usability hay đo performance của UI mới.

### Nguồn ngoài

- **[S1] Granola — website sản phẩm:** https://www.granola.ai/ — mô hình notepad, luồng trước/trong/sau cuộc họp. Chỉ mượn cách đặt nội dung ở trung tâm; không nhận các tính năng AI notes/privacy của họ thành khả năng của VoDoCo.
- **[S2] Descript — website sản phẩm:** https://www.descript.com/ — text-based editing và workflow Record/Edit/Refine/Share. Chỉ mượn ý tưởng một workspace xuyên suốt; VoDoCo không chỉnh media khi sửa transcript.
- **[S3] Google PAIR — People + AI Guidebook:** https://pair.withgoogle.com/guidebook/ — trang tổng quan Mental Models + Expectations, Trust + Explanations, Feedback + Controls, Errors + Graceful Failures.
- **[S4] NHS — Typography:** https://service-manual.nhs.uk/design-system/styles/typography — cấu trúc heading, kích thước chữ và tính nhất quán trong giao diện dịch vụ y tế; không dùng nhận diện thương hiệu NHS.

### Nguồn nội bộ

- **[L1] [Audio demo notebook](giai_doan_14_hoan_thien/multimed_audio_demo_colab.ipynb):** cell 2, 4–8; upload/record, decode WebM, ASR, NER, correction tắt mặc định, cấu trúc JSON. Notebook này chưa có saved execution outputs trong bản đã khảo sát.
- **[L2] [Integrated benchmark notebook](giai_doan_14_hoan_thien/integrated_multimed_benchmark_colab.ipynb):** cell 3, 5–6, 8–9; nạp checkpoint PhoBERT từ Drive, metric gold đã lưu và đối chiếu hai NER. Cell index tính từ 0.
- **[L3] [Audio mẫu](giai_doan_14_hoan_thien/audio.wav):** 6 giây, mono 8 kHz; đã chạy smoke offline ASR + XLM-R ở lượt khảo sát trước, không phải gold reference hay bằng chứng PhoBERT local đã sẵn sàng.

<a id="tiep-theo"></a>
## 9. Bước tiếp theo và điểm còn mở

### Thứ tự thực hiện sau khi dùng direction này

1. Dựng màn **02 trước** để chốt cảm giác đọc transcript và entity; sau đó dựng 01, 03 cùng các variants đã nêu. Không mở thêm screen vì một trạng thái có thể xử lý ngay trong workspace.
2. Lấy checkpoint PhoBERT đầy đủ; kiểm tra tokenizer, offsets và model identity. Không dựng lời hứa tương tác dựa trên timestamps chưa có.
3. Nối luồng inference thực; kiểm tra audio mẫu → bản gốc → bản rà soát → đối chiếu → xuất file. Sau đó kiểm tra các trạng thái thiếu model/lỗi/empty/stale.
4. Chạy kịch bản demo với người chưa biết dự án; kiểm tra họ có phân biệt được ASR, NER và bản đã được con người sửa không. Chỉ sau đó điều chỉnh mật độ/chữ/nút nếu có vướng mắc quan sát được.

### Điểm còn mở — không chặn việc dựng UI, nhưng chặn cam kết tính năng

- **PhoBERT artifact:** Trong lượt khảo sát trước chưa có `phobert-best-seed.zip` hoặc weights PhoBERT ở checkout. Cần lấy lại artifact Tài đã xuất; nếu demo chỉ có XLM-R phải ghi rõ giới hạn, không coi đã hoàn thành demo PhoBERT.
- **Offsets:** Chưa xác minh span offsets của tokenizer PhoBERT trên đường inference thực. Entity list vẫn dùng được; highlight chính xác chỉ bật khi có dữ liệu đúng.
- **Giới hạn đầu vào:** 30 giây/10 MiB và ghi âm 10 giây là quyết định UI đề xuất. Cần xác nhận/enforce với backend, bao gồm NER không bị cắt ngầm.
- **Dữ liệu demo và retention:** Cần xác nhận quyền sử dụng/phát lại audio mẫu trước khi trình diễn công khai, và công bố đúng cách lưu/xóa audio của bản triển khai. Không dùng dữ liệu bệnh nhân thật để làm màn hình đẹp.
