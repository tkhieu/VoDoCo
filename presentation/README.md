# VietMed-NER Presentation

Bài thuyết trình HTML cho đồ án **VietMed-NER: Medical Spoken Named Entity Recognition** sử dụng Reveal.js.

## 📋 Mục lục

- [Giới thiệu](#giới-thiệu)
- [Cấu trúc Presentation](#cấu-trúc-presentation)
- [Cài đặt và Sử dụng](#cài-đặt-và-sử-dụng)
- [Các tính năng](#các-tính-năng)
- [Demo Interactive](#demo-interactive)
- [Tùy chỉnh](#tùy-chỉnh)
- [Troubleshooting](#troubleshooting)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

## 🎯 Giới thiệu

Presentation này được thiết kế cho đồ án tốt nghiệp về **Medical Spoken Named Entity Recognition** (NER y tế từ giọng nói tiếng Việt). Bao gồm 16 slides với:

- Lý do chọn đề tài
- Baseline của dự án (ASR → TEXT → NER → RESULT)
- So sánh 2 models NER (BERT-based vs Seq2Seq)
- Correction methods (Model-based vs Rule-based)
- Demo interactive (Pre-recorded audio + Live recording)
- Kết quả và hướng phát triển

## 📂 Cấu trúc Presentation

```
presentation/
├── index.html              # Main presentation file (16 slides)
├── css/
│   └── custom.css         # Custom medical theme styling
├── js/
│   └── demo.js            # Interactive demo functionality
├── assets/
│   ├── images/            # Diagrams, logos (add your own)
│   ├── audio/             # Sample audio files (add your own)
│   └── data/
│       └── sample-results.json  # Sample metrics and results
└── README.md              # This file
```

## 🚀 Cài đặt và Sử dụng

### Cách 1: Mở trực tiếp (Khuyến nghị)

1. **Mở file `index.html`** bằng trình duyệt web (Chrome, Edge, Firefox)
   ```bash
   # Windows
   start index.html
   
   # hoặc double-click vào file index.html
   ```

2. **Không cần cài đặt thêm** - Tất cả dependencies (Reveal.js, Font Awesome) đều load từ CDN

### Cách 2: Sử dụng Local Server (Cho demo recording)

Nếu muốn test live recording demo, cần chạy local server:

```bash
# Python 3
python -m http.server 8000

# hoặc Python 2
python -m SimpleHTTPServer 8000

# hoặc Node.js
npx http-server -p 8000
```

Sau đó mở browser tại: `http://localhost:8000`

## ✨ Các tính năng

### 1. **Navigation**

- **Arrow keys** (←↑→↓): Di chuyển giữa các slides
- **Space**: Slide tiếp theo
- **Esc**: Overview mode (xem tất cả slides)
- **S**: Speaker notes (ghi chú cho người thuyết trình)
- **F**: Fullscreen mode
- **B** hoặc **.**:  Pause (màn hình đen)

### 2. **Medical Theme**

- Color palette chuyên nghiệp cho y tế
- Entity color coding:
  - 🔴 **SYMPTOM** (Triệu chứng): Đỏ #E74C3C
  - 🟠 **DISEASE** (Bệnh): Cam #E67E22
  - 🟣 **DRUG** (Thuốc): Tím #9B59B6
  - 🔵 **TEST** (Xét nghiệm): Xanh dương #3498DB
  - 🟢 **ANATOMY** (Giải phẫu): Xanh lá #1ABC9C
  - 🟡 **DURATION** (Thời gian): Vàng #F39C12

### 3. **Interactive Demos**

#### Pre-recorded Audio Demo (Slide 12)
- Chọn file audio từ máy tính
- Tự động phân tích ASR → NER
- Hiển thị entities với màu sắc
- Bảng chi tiết entities với confidence scores

#### Live Recording Demo (Slide 13)
- Thu âm trực tiếp từ microphone
- Waveform animation trong khi recording
- Xử lý và hiển thị kết quả NER
- **Note**: Cần chạy local server và cho phép quyền microphone

### 4. **Sample Data**

File `assets/data/sample-results.json` chứa:
- Metrics của ASR models
- So sánh BERT-based vs Seq2Seq models
- Correction methods comparison
- 5 sample texts với entities
- Dataset statistics

## 🎮 Demo Interactive

### Sử dụng Pre-recorded Audio Demo

1. Đi đến **Slide 12** (Demo - Pre-recorded Audio)
2. Click nút **"Chọn file audio"**
3. Chọn file âm thanh từ máy tính (`.wav`, `.mp3`, `.ogg`, v.v.)
4. Click **"Phân tích"**
5. Xem kết quả ASR và NER với entities được highlight

### Sử dụng Live Recording Demo

1. Đi đến **Slide 13** (Demo - Live Recording)
2. Click **"Bắt đầu thu âm"** (cần cho phép quyền microphone)
3. Nói câu y tế tiếng Việt (ví dụ: "bệnh nhân bị đau đầu và sốt cao")
4. Click **"Dừng"**
5. Nghe lại recording và xem kết quả NER

**Note**: Live recording demo hiện tại sử dụng placeholder data. Để kết nối với backend API thực tế, cần chỉnh sửa `js/demo.js`.

## 🎨 Tùy chỉnh

### Thay đổi màu sắc

Edit file `css/custom.css` ở section **Color Palette**:

```css
:root {
    --primary-color: #2C3E50;
    --secondary-color: #3498DB;
    --accent-color: #E74C3C;
    /* ... thay đổi các màu khác */
}
```

### Thêm audio samples

1. Copy file audio vào `assets/audio/`
2. Update `js/demo.js` để sử dụng audio files

### Cập nhật metrics thực tế

1. Edit file `assets/data/sample-results.json`
2. Thay thế placeholder metrics bằng kết quả training thực tế
3. Demo sẽ tự động load data mới

### Thêm slides

Edit `index.html` và thêm section mới:

```html
<section>
    <h2>Slide Title</h2>
    <p>Slide content here...</p>
</section>
```

## 🔧 Troubleshooting

### Vấn đề: Slides không hiển thị đúng

**Giải pháp**: 
- Kiểm tra kết nối internet (Reveal.js load từ CDN)
- Mở Developer Console (F12) để xem lỗi
- Thử refresh lại page (Ctrl+F5)

### Vấn đề: Demo không hoạt động

**Giải pháp**:
- Đảm bảo đã mở file qua HTTP server (không phải file://)
- Check console log (F12) để xem lỗi JavaScript
- Đảm bảo file `js/demo.js` đã được load

### Vấn đề: Live recording không hoạt động

**Giải pháp**:
- Cần chạy presentation qua HTTP/HTTPS (không phải file://)
- Browser sẽ hỏi quyền microphone - cần cho phép
- Chỉ hoạt động trên Chrome, Edge (Web Speech API support)
- Firefox có thể không support đầy đủ

### Vấn đề: Fonts không đẹp

**Giải pháp**:
- Đảm bảo có kết nối internet để load Google Fonts
- Hoặc download fonts và host locally

## 📱 Responsive Design

- **Desktop (khuyến nghị)**: Full experience với tất cả tính năng
- **Tablet**: Layout điều chỉnh, demos vẫn hoạt động
- **Mobile**: Read-only mode, hạn chế interactions
- **Projection (16:9)**: Tối ưu cho projector/màn hình thuyết trình

## 🖨️ Export PDF

Để export presentation ra PDF:

1. Thêm `?print-pdf` vào URL:
   ```
   http://localhost:8000/index.html?print-pdf
   ```

2. Print từ browser (Ctrl+P):
   - Destination: Save as PDF
   - Layout: Landscape
   - Margins: None
   - Background graphics: Checked

3. Save file PDF

## ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| → / Space | Next slide |
| ← | Previous slide |
| ↑↓ | Vertical navigation |
| Esc | Overview mode |
| S | Speaker notes |
| F | Fullscreen |
| B / . | Pause (blank screen) |
| Alt+Click | Zoom in/out |

## 📊 Speaker Notes

Mỗi slide có speaker notes với:
- Key points cần nhấn mạnh
- Time estimates
- Demo instructions
- Tips for Q&A

Nhấn phím **S** để mở Speaker View (hiện notes + timer + preview slide tiếp theo).

## 🎓 Tips for Presentation

### Trước khi present:

1. ✅ Test presentation trên máy tính/projector sẽ dùng
2. ✅ Chuẩn bị audio samples trong `assets/audio/`
3. ✅ Test demo functionality (cả 2 loại)
4. ✅ Chuẩn bị backup: export PDF cho trường hợp khẩn cấp
5. ✅ Đọc speaker notes (nhấn S) để biết flow
6. ✅ Practice timing (aim for 15-20 phút)

### Trong khi present:

- Sử dụng **Space** hoặc **→** để di chuyển slides
- Nhấn **S** để mở Speaker View (nếu có 2 màn hình)
- Sử dụng **B** để pause khi cần tương tác với audience
- Live demo: chuẩn bị fallback nếu demo fail

### Sau khi present:

- Share slides link hoặc PDF với audience
- Cung cấp GitHub repo link cho code

## 🔗 Tài liệu tham khảo

### VietMed-NER Project

- **Paper**: https://arxiv.org/abs/2406.13337
- **GitHub**: https://github.com/leduckhai/MultiMed/tree/master/VietMed-NER
- **Dataset**: https://huggingface.co/datasets/leduckhai/VietMed-NER
- **Models**: https://huggingface.co/leduckhai/VietMed-NER

### Technologies Used

- **Reveal.js**: https://revealjs.com/
- **Font Awesome**: https://fontawesome.com/
- **Web Speech API**: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API

## 🛠️ Development

Nếu muốn customize sâu hơn:

1. **HTML Structure**: Edit `index.html` để thay đổi slides
2. **Styling**: Edit `css/custom.css` để thay đổi màu sắc, layout
3. **Functionality**: Edit `js/demo.js` để thêm features hoặc connect backend
4. **Data**: Edit `assets/data/sample-results.json` với metrics thực tế

## 📝 Notes

- Presentation này sử dụng **placeholder data** cho metrics comparison
- Cần thay thế bằng kết quả training thực tế từ project
- Live recording demo là **placeholder UI** - cần backend API để hoạt động thực tế
- Tất cả dependencies load từ CDN - cần internet connection

## 🤝 Support

Nếu có vấn đề:

1. Check console log (F12) để xem error messages
2. Đảm bảo đang chạy qua HTTP server (không phải file://)
3. Test trên browser khác (Chrome recommended)
4. Check speaker notes (S key) để biết cách sử dụng mỗi slide

## 📄 License

Presentation template này được tạo cho mục đích academic. 

VietMed-NER project và data theo license của original authors.

---

**Prepared for**: Đồ án Tốt nghiệp  
**Date**: Tháng 9, 2026  
**Topic**: VietMed-NER - Medical Spoken Named Entity Recognition

Good luck với presentation! 🎉
