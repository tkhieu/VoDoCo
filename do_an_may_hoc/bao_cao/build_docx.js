// Builds the course report (.docx) from ../results (written by VietMed_NER_MayHoc.ipynb) and ../ket_qua_goc.
// Usage (inside bao_cao/): npm install docx && node build_docx.js
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ShadingType, ImageRun, LevelFormat, PageBreak, TableOfContents, Footer, PageNumber, BorderStyle,
} = require('docx');

const PKG = path.resolve(__dirname, '..');
const ASSETS = path.join(PKG, 'results');
const OUT = path.join(__dirname, 'BaoCao_DoAn_MayHoc_VietMedNER.docx');
const FONT = 'Times New Roman';
const TABLE_WIDTH = 9000;

const J = (f) => JSON.parse(fs.readFileSync(path.join(ASSETS, f), 'utf8'));
const MC = J('model_comparison.json');
const M = MC.models;
const EDA = J('eda.json');
const CURVE = J('vihealthbert_epoch_curve.json');
const SPEED = JSON.parse(fs.readFileSync(path.join(PKG, 'ket_qua_goc/speed_benchmark.json'), 'utf8'));
const ORDER = ['Logistic Regression', 'Linear SVM', 'CRF', 'XLM-R', 'PhoBERT', 'ViHealthBERT'];

// ---------- number formatting (Vietnamese: comma decimal, dot thousands)
const pct = (x, d = 2) => (x * 100).toFixed(d).replace('.', ',');
const num = (x, d = 2) => Number(x).toFixed(d).replace('.', ',');
const int = (x) => Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const pts = (x) => `${x >= 0 ? '+' : '−'}${pct(Math.abs(x))}`;
const ci = ([a, b]) => `[${pts(a)}; ${pts(b)}]`;
const pair = (k) => MC.pairs[k];
const sig = (k) => (pair(k).ci95[0] > 0 || pair(k).ci95[1] < 0 ? 'có ý nghĩa thống kê' : 'không có ý nghĩa thống kê');
const best = ORDER.reduce((a, b) => (M[a].test_f1 >= M[b].test_f1 ? a : b));
const bestSlue = ORDER.reduce((a, b) => (M[a].test_slue_f1 >= M[b].test_slue_f1 ? a : b));
const bestUnseen = ORDER.reduce((a, b) => (M[a].recall_unseen >= M[b].recall_unseen ? a : b));
const H = CURVE.history;
const lastEp = H[H.length - 1];
const bestValEp = H.reduce((a, b) => (a.validation_f1 >= b.validation_f1 ? a : b));
const minValLossEp = H.reduce((a, b) => (a.validation_loss <= b.validation_loss ? a : b));
const clsLog = MC.classical_training;
const crfCurve = MC.crf_learning_curve;
const PRED = J('test_predictions.json');
const invalidBio = Object.fromEntries(ORDER.map((m) => [m, PRED[m].reduce((acc, row) => {
  let prev = 'O';
  row.forEach((t) => { if (t.startsWith('I-') && !(prev !== 'O' && prev.slice(2) === t.slice(2))) acc += 1; prev = t; });
  return acc;
}, 0)]));

// ---------- document helpers
const runs = (text, size) => text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) => (part.startsWith('**')
  ? new TextRun({ text: part.slice(2, -2), bold: true, size }) : new TextRun({ text: part, size })));
const p = (text, opts = {}) => new Paragraph({ children: runs(text), spacing: { after: 120, line: 300 }, alignment: AlignmentType.JUSTIFIED, ...opts });
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)], pageBreakBefore: true });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
const bullet = (text) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: runs(text), spacing: { after: 80, line: 290 } });
const numbered = (text, ref = 'numbers') => new Paragraph({ numbering: { reference: ref, level: 0 }, children: runs(text), spacing: { after: 80, line: 290 } });
const caption = (text) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text, italics: true, size: 22 })] });
const code = (lines) => lines.map((l, i) => new Paragraph({ keepLines: true, keepNext: i < lines.length - 1, spacing: { after: 0, line: 240 }, shading: { fill: 'F2F2F2', type: ShadingType.CLEAR, color: 'auto' },
  children: [new TextRun({ text: l.length ? l : ' ', font: 'Consolas', size: 17 })] }));

let figNo = 0;
let tabNo = 0;
function figure(file, widthPx, title) {
  const buf = fs.readFileSync(path.join(ASSETS, file));
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  figNo += 1;
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120 }, keepNext: true, children: [
      new ImageRun({ type: 'png', data: buf, transformation: { width: widthPx, height: Math.round(widthPx * h / w) },
        altText: { title, description: title, name: file } })] }),
    caption(`Hình ${figNo}. ${title}`),
  ];
}

const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
const borders = { top: border, bottom: border, left: border, right: border };
function table(headers, rows, weights, title, note) {
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.floor(TABLE_WIDTH * w / total));
  widths[widths.length - 1] += TABLE_WIDTH - widths.reduce((a, b) => a + b, 0);
  const cell = (text, i, header) => new TableCell({
    borders, width: { size: widths[i], type: WidthType.DXA }, margins: { top: 50, bottom: 50, left: 90, right: 90 },
    shading: header ? { fill: 'D9E2F3', type: ShadingType.CLEAR, color: 'auto' } : undefined,
    children: [new Paragraph({
      alignment: i > 0 && /^[-−+\d.,%/ ±*—[\];]+$/.test(String(text)) ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: header ? [new TextRun({ text: String(text), bold: true, size: 19 })] : runs(String(text), 19),
    })],
  });
  tabNo += 1;
  const out = [
    new Paragraph({ spacing: { before: 160, after: 80 }, keepNext: true, children: [new TextRun({ text: `Bảng ${tabNo}. ${title}`, bold: true, size: 22 })] }),
    new Table({ width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: widths, rows: [
      new TableRow({ tableHeader: true, children: headers.map((t, i) => cell(t, i, true)) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, i, false)) })),
    ] }),
  ];
  if (note) out.push(new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: note, italics: true, size: 19 })] }));
  out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  return out;
}

// ---------- data-derived tables
const types = Object.keys(EDA.train.entity_spans);
const entityRows = [];
for (let i = 0; i < 9; i += 1) {
  const a = types[i];
  const b = types[i + 9];
  const c = (split, t) => int(EDA[split].entity_spans[t] || 0);
  entityRows.push([a, c('train', a), c('validation', a), c('test', a), b, c('train', b), c('validation', b), c('test', b)]);
}
const share = (split, t) => pct((EDA[split].entity_spans[t] || 0) / EDA[split].entity_total, 1);

const resultRows = ORDER.map((m) => [
  m === best ? `**${m}**` : m, pct(M[m].train_f1), pct(M[m].val_f1), pct(M[m].test_precision), pct(M[m].test_recall),
  m === best ? `**${pct(M[m].test_f1)}**` : pct(M[m].test_f1), `${pct(M[m].test_f1_ci95[0], 1)}–${pct(M[m].test_f1_ci95[1], 1)}`,
  pct(M[m].test_macro_f1), pct(M[m].test_token_accuracy_bio)]);

const pairRows = Object.entries(MC.pairs).map(([k, v]) => [k.replace(' - ', ' − '), pts(v.delta), ci(v.ci95), sig(k)]);

const so = (m) => M[m].span_outcomes;
const outcomeRows = ORDER.map((m) => [m, int(so(m).exact || 0), int(so(m).boundary || 0), int(so(m).wrong_type || 0), int(so(m).missed || 0), int(so(m).spurious || 0)]);

const seenRows = ORDER.map((m) => [m, pct(M[m].recall_seen, 1), pct(M[m].recall_unseen, 1), pts(M[m].recall_seen - M[m].recall_unseen).replace('+', '')]);

const lenKeys = Object.keys(M.CRF.f1_by_sentence_length);
const lenRows = lenKeys.map((k) => [k.replace('-+', ' trở lên').replace('-', '–'), int(M.CRF.f1_by_sentence_length[k].sentences),
  ...ORDER.map((m) => pct(M[m].f1_by_sentence_length[k].f1, 1))]);

const slueRows = ORDER.map((m) => [m, pct(M[m].test_f1), pct(M[m].test_slue_f1),
  m === 'XLM-R' ? '69 (P 64 / R 73)' : m === 'PhoBERT' ? '74' : '—']);

const cls = (name) => clsLog[name];
const epochRows = H.map((h) => [String(h.epoch), num(h.train_loss_logged_mean, 3), num(h.train_loss, 3), num(h.validation_loss, 3), pct(h.train_f1), pct(h.validation_f1)]);

const crfCurveRows = crfCurve.map((c) => [`${Math.round(c.fraction * 100)}%`, int(c.sentences), pct(c.train_f1), pct(c.validation_f1), pct(c.test_f1)]);

// ---------- cover
const cover = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600 }, children: [new TextRun({ text: 'TRƯỜNG ĐẠI HỌC CÔNG NGHỆ THÔNG TIN — ĐHQG TP.HCM', bold: true, size: 26 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1600 }, children: [new TextRun({ text: 'Môn học: Máy học', size: 26 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'BÁO CÁO ĐỒ ÁN MÔN HỌC', bold: true, size: 36 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240 }, children: [new TextRun({ text: 'NHẬN DẠNG THỰC THỂ Y TẾ TRONG HỘI THOẠI TIẾNG VIỆT', bold: true, size: 32, color: '1F3864' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1600 }, children: [new TextRun({ text: 'Bộ dữ liệu VietMed-NER — so sánh sáu mô hình: Logistic Regression, Linear SVM, CRF, XLM-RoBERTa, PhoBERT và ViHealthBERT', italics: true, size: 26 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Nhóm thực hiện: ……………………………', size: 26 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Giảng viên hướng dẫn: ……………………………', size: 26 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1200 }, children: [new TextRun({ text: 'TP. Hồ Chí Minh, tháng 9 năm 2026', size: 26 })] }),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Mục lục')] }),
  new TableOfContents('Mục lục', { hyperlink: true, headingStyleRange: '1-2' }),
];

const lr = cls('Logistic Regression');
const svm = cls('Linear SVM');

const body = [
  // 1 ------------------------------------------------------------------
  h1('1. Tóm tắt đề tài'),
  p('Đề tài xây dựng và so sánh các mô hình nhận dạng thực thể có tên (Named Entity Recognition — NER) trong transcript hội thoại y tế tiếng Việt. Mỗi âm tiết trong câu được phân loại vào một trong 37 nhãn BIO thuộc 18 loại thực thể như bệnh/triệu chứng, cơ quan, thuốc, thời gian. Bài toán là một khâu trong hệ thống âm thanh → nhận dạng tiếng nói (ASR) → NER, dùng để hỗ trợ ghi chép hồ sơ y tế.'),
  p(`Nhóm cài đặt và so sánh sáu mô hình trên bộ VietMed-NER, đi từ đơn giản đến phức tạp: hai mô hình phân loại từng token độc lập (Logistic Regression, Linear SVM), một mô hình chuỗi cổ điển (CRF), và ba Transformer (XLM-RoBERTa của tác giả bộ dữ liệu, PhoBERT-base-v2 và ViHealthBERT-base-syllable do nhóm fine-tune). Mọi mô hình được chấm cùng một thước đo: F1 mức thực thể, khớp chính xác cả ranh giới lẫn loại (seqeval strict).`),
  p(`**Kết quả chính:** trên tập test, ${best} đạt F1 cao nhất (${pct(M[best].test_f1)}%), hơn ViHealthBERT ${pct(pair('CRF - ViHealthBERT').delta)} điểm (CI95 ${ci(pair('CRF - ViHealthBERT').ci95)}, ${sig('CRF - ViHealthBERT')}). Tuy vậy CRF chỉ nhận ra ${pct(M.CRF.recall_unseen, 1)}% thực thể chưa từng gặp trong train, so với ${pct(M[bestUnseen].recall_unseen, 1)}% của ${bestUnseen}: CRF thắng nhờ ghi nhớ từ vựng, còn Transformer tổng quát hoá tốt hơn. Tất cả mô hình được huấn luyện đều overfit tập train, và mọi mô hình giảm thêm 21–27 điểm F1 khi chuyển từ validation sang test do lệch miền dữ liệu, đã được xác minh bằng đối chiếu nguồn gốc từng câu.`),

  // 2 ------------------------------------------------------------------
  h1('2. Giới thiệu bài toán và bộ dữ liệu'),
  h2('2.1 Bài toán'),
  p('Đầu vào là một câu tiếng Việt đã tách theo âm tiết. Đầu ra là một nhãn cho từng âm tiết theo sơ đồ BIO: B-X đánh dấu âm tiết đầu của thực thể loại X, I-X là âm tiết tiếp theo trong cùng thực thể, O là âm tiết không thuộc thực thể nào. Đây là bài toán phân loại chuỗi (sequence labeling). Dữ liệu thuộc loại văn bản, không nằm trong ba loại bảng, ảnh, video mà đề bài liệt kê, nên phần EDA và tiền xử lý được thiết kế riêng cho văn bản.'),
  h2('2.2 Bộ dữ liệu VietMed-NER'),
  p('Bộ dữ liệu leduckhai/VietMed-NER [1] được xây dựng từ transcript của VietMed, bộ dữ liệu âm thanh y tế tiếng Việt thật. Hai người gán nhãn độc lập (một người có nền tảng y khoa), giải quyết xung đột qua thảo luận, sau đó hai người khác rà soát toàn bộ corpus nhiều lần. Bộ dữ liệu có sẵn ba tập train, validation và test.'),
  ...table(['Tập', 'Số câu', 'Số token', 'Số thực thể', 'Câu không có thực thể', 'Tỉ lệ token O', 'Độ dài TB / trung vị'],
    ['train', 'validation', 'test'].map((s) => [s, int(EDA[s].sentences), int(EDA[s].tokens), int(EDA[s].entity_total), int(EDA[s].sentences_without_entity),
      `${pct(EDA[s].o_token_ratio, 1)}%`, `${num(EDA[s].len_mean, 1)} / ${num(EDA[s].len_median, 0)}`]),
    [1.3, 1, 1.1, 1.1, 1.4, 1.1, 1.5], 'Quy mô các tập của VietMed-NER'),
  h2('2.3 Nguồn gốc các tập (đã xác minh)'),
  p('Nhóm đối chiếu từng câu của VietMed-NER với transcript gốc của VietMed. Kết quả: 100% câu của train và validation khớp với câu thuộc VietMed train + dev + cv (2.773 + 2.912 + 85 = 5.770 câu), và hai tập này được chia ngẫu nhiên từ chung một nguồn. Test gồm 3.437 câu khớp VietMed test và 60 câu không khớp chính xác. Như vậy **validation cùng miền với train, còn test là các bản ghi khác hẳn**. Bảng 2 cho thấy nhóm bệnh ICD-10 và ngữ cảnh ghi âm của ba tập VietMed gần như không trùng nhau.'),
  ...table(['Tập VietMed', 'Số câu nói', 'Số giờ', 'Nhóm bệnh ICD-10 chính', 'Ngữ cảnh ghi âm'], [
    ['train', '2.773', '4,80', 'M, E, C–D, G, I', 'Tư vấn, điện thoại'],
    ['dev', '2.912', '4,96', 'Z, I, F, R, D, L', 'Điện thoại, sách, tư vấn'],
    ['test', '3.437', '6,02', 'K, M, O, P, N, V–Y, H', 'Podcast, talkshow, bài giảng, tin tức'],
  ], [1.2, 1.1, 0.9, 2.3, 3], 'Bộ âm thanh VietMed — nguồn của VietMed-NER'),

  // 3 ------------------------------------------------------------------
  h1('3. Phân tích dữ liệu (EDA)'),
  h2('3.1 Phân bố lớp'),
  ...table(['Loại thực thể', 'Train', 'Val', 'Test', 'Loại thực thể', 'Train', 'Val', 'Test'], entityRows,
    [2.1, 0.95, 0.8, 0.95, 2.4, 0.8, 0.7, 0.8], 'Số thực thể theo loại và theo tập'),
  ...figure('fig_entity_distribution.png', 600, 'Phân bố thực thể theo loại và theo tập'),
  p(`**Mất cân bằng lớp rất nặng.** Khoảng ${pct(EDA.train.o_token_ratio, 1)}% token mang nhãn O. Ở mức thực thể, lớp lớn nhất (DISEASESYMTOM, ${int(EDA.train.entity_spans.DISEASESYMTOM)} mẫu train) nhiều gấp khoảng 600 lần lớp nhỏ nhất (TRANSPORTATION, ${EDA.train.entity_spans.TRANSPORTATION} mẫu). ORGANIZATION và TRANSPORTATION có dưới 20 mẫu train.`),
  p(`**Mất cân bằng giữa các tập.** Train và validation có phân bố nhãn gần như giống nhau, nhưng test lệch rõ: PREVENTIVEMED chiếm ${share('train', 'PREVENTIVEMED')}% thực thể ở train nhưng chỉ ${share('test', 'PREVENTIVEMED')}% ở test; MEDDEVICETECHNIQUE tăng từ ${share('train', 'MEDDEVICETECHNIQUE')}% lên ${share('test', 'MEDDEVICETECHNIQUE')}%; GENDER tăng từ ${share('train', 'GENDER')}% lên ${share('test', 'GENDER')}%.`),
  h2('3.2 Độ dài câu và độ dài thực thể'),
  ...figure('fig_sentence_length.png', 440, 'Phân bố độ dài câu (số âm tiết) theo tập'),
  p('Câu dài tối đa 40 âm tiết. Test có nhiều câu ngắn hơn (trung vị 20 so với 26 ở train). Thực thể dài 2 âm tiết là phổ biến nhất (6.875 thực thể trong train), sau đó là 1 âm tiết (2.856) và 3 âm tiết (1.116). Thực thể dài từ 5 âm tiết trở lên chỉ chiếm khoảng 2%.'),
  h2('3.3 Từ vựng và từ ngoài từ vựng (OOV)'),
  ...table(['Chỉ số', 'Validation', 'Test'], [
    ['Số âm tiết khác nhau', '1.526', '2.129'],
    ['Tỉ lệ token chưa gặp trong train', '0,42%', '1,83%'],
    ['Tỉ lệ loại âm tiết chưa gặp trong train', '6,4%', '22,7%'],
    ['**Tỉ lệ thực thể có dạng chữ chưa gặp trong train**', '**6,7%**', '**30,7%**'],
  ], [5, 2, 2], 'Mức độ trùng từ vựng với tập train (train có 2.220 âm tiết khác nhau)'),
  p('Gần một phần ba thực thể trong test chưa từng xuất hiện ở train, trong khi con số này ở validation chỉ là 6,7%. Đây là bằng chứng định lượng rõ nhất cho lệch miền. Nó cũng dự báo rằng mô hình dựa vào ghi nhớ từ vựng sẽ giữ được điểm cao trên validation nhưng giảm mạnh trên test (mục 6.7).'),

  // 4 ------------------------------------------------------------------
  h1('4. Tiền xử lý dữ liệu'),
  h2('4.1 Kiểm tra chất lượng và xử lý giá trị thiếu'),
  ...table(['Kiểm tra', 'Train', 'Val', 'Test', 'Xử lý'], [
    ['Câu rỗng / token rỗng', '0 / 0', '0 / 0', '0 / 0', 'Không cần xử lý'],
    ['Số âm tiết khác số nhãn', '0', '0', '0', 'Không cần xử lý'],
    ['Token chưa chuẩn hoá Unicode NFC', '0', '0', '0', 'Không cần xử lý'],
    ['Token có chữ hoa / chỉ gồm dấu câu', '0 / 0', '0 / 0', '0 / 0', 'Dữ liệu đã viết thường, không có dấu câu'],
    ['Chuỗi BIO lỗi (I- đứng sau O)', '16', '0', '7', 'Giữ nguyên; seqeval coi I- đó là đầu thực thể mới'],
  ], [3.2, 1, 0.9, 1, 3.2], 'Kết quả kiểm tra chất lượng dữ liệu'),
  p('Bộ dữ liệu không có giá trị thiếu và đã được chuẩn hoá sẵn (chữ thường, Unicode NFC, không dấu câu), nên nhóm không phải điền hay loại bỏ mẫu nào. 23 chuỗi BIO lỗi chiếm chưa tới 0,02% token và được giữ nguyên để không làm thay đổi tập đánh giá chính thức.'),
  h2('4.2 Mã hoá nhãn và dữ liệu'),
  bullet('**Mã hoá nhãn:** 37 nhãn BIO được ánh xạ sang số nguyên (label2id) chỉ dựa trên tập train. Nhãn O của dataset được lưu dưới dạng chuỗi "0"; nhóm đổi thành "O" để seqeval không coi nó là một loại thực thể.'),
  bullet('**Mã hoá cho Transformer:** mỗi âm tiết được tokenizer tách thành subword và mã hoá thành id. Nhãn chỉ gán cho subword đầu, các subword còn lại nhận -100 để bị bỏ qua khi tính loss. Độ dài tối đa 256 subword, không câu nào bị cắt.'),
  bullet('**Mã hoá cho mô hình cổ điển:** mỗi âm tiết được biểu diễn bằng đặc trưng thủ công (âm tiết viết thường, là số, độ dài, tiền tố và hậu tố 2 ký tự, các âm tiết trong cửa sổ ±2, bigram với âm tiết liền kề), sau đó DictVectorizer chuyển thành vector thưa 77.424 chiều (one-hot).'),
  h2('4.3 Chia dữ liệu'),
  p('Nhóm giữ nguyên ba tập chính thức. Mọi siêu tham số và seed được chọn chỉ dựa trên validation; test chỉ được dùng một lần ở bước đánh giá cuối.'),

  // 5 ------------------------------------------------------------------
  h1('5. Mô hình và thông số'),
  ...table(['Mô hình', 'Nhóm', 'Ý tưởng', 'Cấu hình được chọn'], [
    ['Logistic Regression', 'Cổ điển, phân loại từng token', 'Phân loại độc lập từng âm tiết từ đặc trưng cửa sổ', `L2, C = ${num(lr.best.C, 2)}, lbfgs 300 vòng`],
    ['Linear SVM', 'Cổ điển, phân loại từng token', 'Siêu phẳng lề cực đại cho từng âm tiết', `C = ${num(svm.best.C, 2)}, one-vs-rest`],
    ['CRF', 'Cổ điển, mô hình chuỗi', 'Học thêm xác suất chuyển giữa các nhãn liền kề', 'L-BFGS, c1 = 0,1, c2 = 0,01, 200 vòng'],
    ['XLM-RoBERTa-base', 'Transformer đa ngôn ngữ', 'Checkpoint của tác giả bộ dữ liệu, dùng làm mốc so sánh', 'Không train lại (277,5M tham số)'],
    ['PhoBERT-base-v2', 'Transformer tiếng Việt', 'Pretrain trên văn bản tiếng Việt chung [2]', 'lr 3e-5, 8 epoch, wd 0,05, seed 123 (~135M)'],
    ['ViHealthBERT-base', 'Transformer tiếng Việt y tế', 'Pretrain thêm trên văn bản y tế [3]', 'lr 3e-5, 8 epoch, wd 0,01, seed 2024 (134,4M)'],
  ], [1.9, 1.9, 2.9, 2.6], 'Sáu mô hình được so sánh'),
  h2('5.1 Tìm siêu tham số'),
  bullet(`**Logistic Regression:** C ∈ {${lr.trials.map((t) => num(t.C, 1)).join('; ')}}, F1 validation lần lượt ${lr.trials.map((t) => pct(t.val_f1)).join('; ')}%.`),
  bullet(`**Linear SVM:** C ∈ {${svm.trials.map((t) => num(t.C, 2)).join('; ')}}, F1 validation lần lượt ${svm.trials.map((t) => pct(t.val_f1)).join('; ')}%.`),
  bullet('**CRF:** lưới c1 ∈ {0,01; 0,1; 0,5} × c2 ∈ {0,01; 0,1; 1}; tốt nhất c1 = 0,1, c2 = 0,01 với F1 validation 89,15%.'),
  bullet('**PhoBERT và ViHealthBERT:** lưới 18 cấu hình gồm learning rate {5e-6; 1e-5; 3e-5} × số epoch {4; 6; 8} × weight decay {0,01; 0,05}, seed 42. Cấu hình tốt nhất được huấn luyện lại với 3 seed (42, 123, 2024) và chọn seed theo F1 validation. Cấu hình chung: batch 16, AdamW, scheduler linear, warmup 10%, giữ checkpoint có F1 validation tốt nhất.'),
  ...figure('fig_sweep_underfitting.png', 600, 'F1 validation trong quá trình dò siêu tham số của hai Transformer'),
  p('F1 validation tăng đơn điệu theo learning rate và số epoch. Với lr 5e-6 và 4 epoch, PhoBERT chỉ đạt 36,65% (loss validation 0,90): mô hình chưa học đủ, tức **underfitting**. Cấu hình tốt nhất nằm ở góc biên của lưới (lr lớn nhất, nhiều epoch nhất), nên lưới có thể chưa đủ rộng. Số liệu trong hình dùng cách chấm của notebook gốc (tính cả nhãn "0" như một loại thực thể), nên thấp hơn các bảng ở mục 6 khoảng 1–2 điểm; hình chỉ dùng để so sánh các cấu hình với nhau.'),
  h2('5.2 Chi phí huấn luyện và suy luận'),
  ...table(['Mô hình', 'Thời gian huấn luyện (1 lần)', 'Phần cứng', 'Ghi chú suy luận'], [
    ['Logistic Regression', `${num(lr.fit_seconds, 0)} giây`, 'CPU', 'Rất nhẹ'],
    ['Linear SVM', `${num(svm.fit_seconds, 0)} giây`, 'CPU', 'Rất nhẹ'],
    ['CRF', `${num(clsLog.CRF.fit_seconds, 0)} giây`, 'CPU', 'Rất nhẹ'],
    ['PhoBERT', '≈ 692 giây (8 epoch)', 'GPU Tesla T4', '~135M tham số'],
    ['ViHealthBERT', '≈ 150 giây (8 epoch)', 'GPU RTX 5060 Ti', `${num(SPEED.vihealthbert.throughput_sentences_per_s_bs32, 0)} câu/giây, VRAM ${num(SPEED.vihealthbert.peak_vram_mb, 0)} MB`],
    ['XLM-R', '— (dùng sẵn)', 'GPU RTX 5060 Ti', `${num(SPEED.xlm_roberta_baseline.throughput_sentences_per_s_bs32, 0)} câu/giây, VRAM ${num(SPEED.xlm_roberta_baseline.peak_vram_mb, 0)} MB`],
  ], [2, 2.4, 1.8, 2.8], 'Chi phí tính toán'),

  // 6 ------------------------------------------------------------------
  h1('6. Kết quả và phân tích'),
  h2('6.1 Thước đo đánh giá'),
  bullet('**F1 mức thực thể, seqeval strict (thước đo chính):** một thực thể chỉ được tính đúng khi khớp chính xác cả ranh giới lẫn loại. Thước đo này phù hợp với mục tiêu trích xuất cả cụm thực thể để ghi vào hồ sơ. Báo cáo cả micro F1 (theo số thực thể) và macro F1 (trung bình đều các loại, nhạy với lớp hiếm).'),
  bullet('**Accuracy mức token:** tỉ lệ âm tiết được gán đúng nhãn BIO, tính cùng một cách cho mọi mô hình. Accuracy ít có ý nghĩa ở đây: đoán toàn O đã đạt khoảng 78,8%.'),
  bullet('**F1 kiểu SLUE (để đối chiếu với bài báo gốc):** so khớp tập hợp các cặp (loại, âm tiết), không xét ranh giới (mục 6.8).'),
  bullet('**Khoảng tin cậy:** paired bootstrap trên 3.497 câu test, 2.000 lần lấy mẫu lại, dùng cùng các mẫu cho mọi mô hình.'),
  h2('6.2 Kết quả tổng thể'),
  ...table(['Mô hình', 'Train F1', 'Val F1', 'Test P', 'Test R', 'Test F1', 'CI95 test F1', 'Test macro F1', 'Token acc.'], resultRows,
    [1.9, 0.9, 0.9, 0.9, 0.9, 0.9, 1.2, 1, 0.9], 'Kết quả của sáu mô hình (%)', 'Thước đo: seqeval strict, micro F1 mức thực thể; nhãn "0" được coi là O.'),
  ...figure('fig_f1_by_split.png', 600, 'F1 của sáu mô hình trên train, validation và test'),
  p(`**Mô hình tốt nhất trên test là ${best}** với F1 ${pct(M[best].test_f1)}%. ViHealthBERT (${pct(M.ViHealthBERT.test_f1)}%) và PhoBERT (${pct(M.PhoBERT.test_f1)}%) đứng ngay sau. Hai mô hình phân loại từng token kém CRF rõ rệt: Linear SVM đạt ${pct(M['Linear SVM'].test_f1)}% và Logistic Regression đạt ${pct(M['Logistic Regression'].test_f1)}%. XLM-R đạt ${pct(M['XLM-R'].test_f1)}%.`),
  p(`**Precision và recall.** PhoBERT và ViHealthBERT có recall cao (${pct(M.PhoBERT.test_recall, 1)}–${pct(M.ViHealthBERT.test_recall, 1)}%) nhưng precision thấp (${pct(M.ViHealthBERT.test_precision, 1)}–${pct(M.PhoBERT.test_precision, 1)}%), tức đoán dư thực thể. CRF là mô hình duy nhất có precision cao hơn recall (${pct(M.CRF.test_precision, 1)}% so với ${pct(M.CRF.test_recall, 1)}%): nó chỉ gán nhãn khi gặp mẫu quen thuộc. Hai mô hình phân loại từng token có cả precision lẫn recall thấp (${pct(M['Linear SVM'].test_precision, 1)}–${pct(M['Logistic Regression'].test_precision, 1)}% và ${pct(M['Logistic Regression'].test_recall, 1)}–${pct(M['Linear SVM'].test_recall, 1)}%). **Macro F1** thấp hơn micro F1 khoảng 5–11 điểm ở mọi mô hình vì các lớp hiếm có F1 gần 0.`),
  h2('6.3 Chênh lệch có ý nghĩa thống kê không?'),
  ...table(['So sánh', 'Chênh lệch F1 (điểm)', 'CI95', 'Kết luận'], pairRows, [3, 1.6, 2.2, 2.4], 'Paired bootstrap trên tập test'),
  p(`CRF hơn ViHealthBERT ${pct(pair('CRF - ViHealthBERT').delta)} điểm; khoảng tin cậy ${ci(pair('CRF - ViHealthBERT').ci95)} nằm trên 0 nhưng cận dưới rất sát 0, nên đây là lợi thế nhỏ. ViHealthBERT và PhoBERT ${sig('ViHealthBERT - PhoBERT')} (${ci(pair('ViHealthBERT - PhoBERT').ci95)}), tức hai mô hình ngang nhau. Việc thêm quan hệ giữa các nhãn liền kề (CRF so với Linear SVM) mang lại ${pct(pair('CRF - Linear SVM').delta)} điểm, ${sig('CRF - Linear SVM')}.`),
  h2('6.4 F1 theo loại thực thể'),
  ...figure('fig_per_type_f1_test.png', 620, 'F1 theo loại thực thể trên tập test'),
  p('Các loại có ngữ cảnh và từ vựng rõ ràng như OCCUPATION, DRUGCHEMICAL và DATETIME đạt F1 cao ở mọi mô hình. Các lớp hiếm (ORGANIZATION, TRANSPORTATION) và các lớp có ranh giới ngữ nghĩa mơ hồ (PREVENTIVEMED, MEDDEVICETECHNIQUE, PERSONALCARE) có F1 thấp. ViHealthBERT làm tốt hơn PhoBERT ở các lớp y khoa như DISEASESYMTOM và MEDDEVICETECHNIQUE, nhưng kém hơn ở LOCATION và GENDER.'),

  h2('6.5 So sánh train và validation: overfitting và underfitting'),
  p('Để có đường cong học theo từng epoch, nhóm huấn luyện lại ViHealthBERT với cấu hình đã chọn (lr 3e-5, 8 epoch, weight decay 0,01, seed 2024) và sau mỗi epoch chấm lại loss và F1 trên toàn bộ train và validation.'),
  ...table(['Epoch', 'Train loss (lúc huấn luyện)', 'Train loss (chấm lại)', 'Val loss', 'Train F1', 'Val F1'], epochRows,
    [0.8, 1.9, 1.6, 1.2, 1.2, 1.2], 'Đường cong học của ViHealthBERT (loss và F1 %)'),
  ...figure('fig_vihealthbert_epoch_curve.png', 600, 'Loss và F1 theo epoch của ViHealthBERT trên train và validation'),
  p(`Ở epoch 1, cả train F1 (${pct(H[0].train_f1, 1)}%) và validation F1 (${pct(H[0].validation_f1, 1)}%) đều thấp: mô hình chưa học đủ (**underfitting**). Từ epoch 2 đến 5, hai đường cùng tăng nhanh. Từ epoch 5 trở đi, train loss tiếp tục giảm (${num(H[4].train_loss, 3)} → ${num(lastEp.train_loss, 3)}) và train F1 tăng lên ${pct(lastEp.train_f1)}%, trong khi validation loss gần như đi ngang quanh ${num(minValLossEp.validation_loss, 3)} và validation F1 dừng ở khoảng ${pct(H[4].validation_f1, 1)}–${pct(bestValEp.validation_f1, 1)}%. Khoảng cách ${pct(lastEp.train_f1 - lastEp.validation_f1, 1)} điểm giữa train và validation ở epoch cuối là dấu hiệu **overfitting** ở mức vừa phải: mô hình tiếp tục khớp train nhưng không còn cải thiện trên validation, và validation chưa giảm rõ nên 8 epoch vẫn là lựa chọn chấp nhận được. Bản huấn luyện lại đạt F1 test ${pct(CURVE.final_test_f1)}%, gần với checkpoint gốc (${pct(M.ViHealthBERT.test_f1)}%), cho thấy kết quả tái lập được.`),
  ...table(['Tỉ lệ tập train', 'Số câu', 'Train F1', 'Val F1', 'Test F1'], crfCurveRows, [1.5, 1.2, 1.2, 1.2, 1.2], 'Đường cong học của CRF theo kích thước tập train (%)'),
  ...figure('fig_crf_learning_curve.png', 440, 'Đường cong học của CRF theo kích thước tập train'),
  p(`CRF đạt train F1 gần 100% ở mọi kích thước tập train, tức mô hình ghi nhớ gần như toàn bộ dữ liệu huấn luyện (overfitting mạnh). Validation F1 tăng khi thêm dữ liệu (${pct(crfCurve[0].validation_f1, 1)}% → ${pct(crfCurve[crfCurve.length - 1].validation_f1, 1)}%) và test F1 tăng còn mạnh hơn (${pct(crfCurve[0].test_f1, 1)}% → ${pct(crfCurve[crfCurve.length - 1].test_f1, 1)}%), vì mỗi câu train mới bổ sung thêm thuật ngữ mà CRF có thể ghi nhớ. Đường test chưa bão hoà ở 100% dữ liệu, nghĩa là CRF thiếu dữ liệu chứ chưa chạm giới hạn mô hình, và khoảng cách validation–test vẫn còn khoảng ${pct(crfCurve[crfCurve.length - 1].validation_f1 - crfCurve[crfCurve.length - 1].test_f1, 0)} điểm do lệch miền.`),
  p(`**Tổng hợp overfit và underfit:** khoảng cách train–validation của các mô hình được huấn luyện là ${pct(M.CRF.train_f1 - M.CRF.val_f1, 1)} điểm (CRF), ${pct(M.ViHealthBERT.train_f1 - M.ViHealthBERT.val_f1, 1)} (ViHealthBERT), ${pct(M.PhoBERT.train_f1 - M.PhoBERT.val_f1, 1)} (PhoBERT), ${pct(M['Linear SVM'].train_f1 - M['Linear SVM'].val_f1, 1)} (Linear SVM) và ${pct(M['Logistic Regression'].train_f1 - M['Logistic Regression'].val_f1, 1)} (Logistic Regression). XLM-R gần như không chênh (${pct(M['XLM-R'].train_f1, 1)}% so với ${pct(M['XLM-R'].val_f1, 1)}%) vì nhóm không huấn luyện lại mô hình này. Underfitting xuất hiện ở các cấu hình Transformer có learning rate nhỏ hoặc ít epoch (mục 5.1) và ở epoch đầu của quá trình huấn luyện ViHealthBERT. Khoảng cách validation–test (21–27 điểm) lớn hơn khoảng cách train–validation, nên **lệch miền mới là nguyên nhân chính làm giảm điểm trên test**, không phải overfitting.`),

  h2('6.6 Confusion matrix: mô hình hay nhầm lớp nào'),
  ...figure('fig_confusion_all_models.png', 620, 'Confusion matrix mức token của sáu mô hình trên test (chuẩn hoá theo hàng)'),
  ...table(['Mô hình', 'Khớp hoàn toàn', 'Lệch ranh giới', 'Sai loại', 'Bỏ sót', 'Đoán thừa'], outcomeRows, [2.2, 1.4, 1.4, 1.1, 1.1, 1.2],
    'Phân loại kết quả dự đoán ở mức thực thể trên test', `Test có ${int(EDA.test.entity_total)} thực thể. "Đoán thừa" là thực thể dự đoán không chồng lấn với thực thể nào trong nhãn thật.`),
  ...figure('fig_confusion_vihealthbert.png', 520, 'Confusion matrix chi tiết của ViHealthBERT trên test'),
  p('Ở mọi mô hình, phần lớn lỗi là **lệch ranh giới và đoán thừa**, không phải gán sai loại. Hai mô hình phân loại từng token có nhiều lỗi lệch ranh giới nhất vì chúng không biết nhãn của âm tiết liền trước; CRF bỏ sót nhiều nhất nhưng đoán thừa ít nhất. Các cặp hay bị nhầm (số lần lấy từ dự đoán của ViHealthBERT):'),
  bullet('**DISEASESYMTOM bị cắt thành ORGAN:** "tiêu xương" → "xương" (24 lần), "ra máu" → "máu" (11 lần), "hội chứng ruột kích thích" → "ruột" (10 lần). Mô hình nhận ra tên cơ quan nhưng bỏ phần mô tả bệnh.'),
  bullet('**SURGERY bị đoán thành MEDDEVICETECHNIQUE:** "implant" (40 lần), "cấy que tránh thai" (14 lần), "nhổ răng". Thủ thuật và thiết bị dùng trong thủ thuật có từ vựng trùng nhau.'),
  bullet('**MEDDEVICETECHNIQUE bị nhầm sang PERSONALCARE, PREVENTIVEMED hoặc DRUGCHEMICAL:** chỉ khoảng một phần ba token của lớp này được đoán đúng.'),
  bullet('**ORGANIZATION bị đoán thành LOCATION:** "chính phủ" (9 lần), "bộ y tế"; tên cơ quan thường đi kèm địa danh.'),

  h2('6.7 Phân tích lỗi theo độ khó của mẫu'),
  p('Với dữ liệu ảnh, độ khó của mẫu có thể là ảnh mờ hay rõ. Với văn bản, hai yếu tố tương đương là thực thể có quen thuộc với mô hình hay không (đã gặp trong train) và độ dài câu.'),
  ...table(['Mô hình', 'Recall thực thể đã gặp', 'Recall thực thể chưa gặp', 'Chênh lệch'], seenRows, [2.4, 2, 2, 1.6],
    'Recall trên test theo việc thực thể đã xuất hiện trong train hay chưa (%)', `Test có ${int(5782)} thực thể đã gặp và ${int(2556)} thực thể chưa gặp trong train.`),
  ...figure('fig_seen_unseen.png', 520, 'Khả năng nhận ra thực thể đã gặp và chưa gặp'),
  p(`Với thực thể đã gặp, các mô hình khá gần nhau (${pct(Math.min(...ORDER.map((m) => M[m].recall_seen)), 0)}–${pct(Math.max(...ORDER.map((m) => M[m].recall_seen)), 0)}%), và Linear SVM thậm chí cao nhất. Với thực thể chưa gặp, khác biệt rất lớn: ba mô hình cổ điển chỉ nhận ra ${pct(Math.min(M.CRF.recall_unseen, M['Linear SVM'].recall_unseen, M['Logistic Regression'].recall_unseen), 1)}–${pct(Math.max(M.CRF.recall_unseen, M['Linear SVM'].recall_unseen, M['Logistic Regression'].recall_unseen), 1)}%, còn ${bestUnseen} nhận ra ${pct(M[bestUnseen].recall_unseen, 1)}%. Mô hình cổ điển dựa vào việc ghi nhớ từ vựng; Transformer dùng biểu diễn ngữ nghĩa học từ pretraining nên suy ra được thực thể mới. Vì 69% thực thể trong test đã gặp ở train, lợi thế ghi nhớ đủ để CRF dẫn đầu về F1 tổng.`),
  ...table(['Độ dài câu (âm tiết)', 'Số câu', ...ORDER.map((m) => m.replace('Logistic Regression', 'LogReg'))], lenRows,
    [1.8, 0.9, 1, 1, 0.9, 0.9, 1, 1.1], 'F1 test theo độ dài câu (%)'),
  p('Câu ngắn (từ 10 âm tiết trở xuống) có F1 thấp hơn ở năm trên sáu mô hình vì thiếu ngữ cảnh để xác định loại thực thể; mức giảm lớn nhất ở Linear SVM và CRF, là hai mô hình dựa vào đặc trưng cửa sổ. XLM-R là ngoại lệ, F1 gần như không đổi theo độ dài câu.'),
  ...table(['Câu (trích)', 'Nhãn đúng', 'ViHealthBERT', 'CRF', 'Loại lỗi'], [
    ['rong huyết như vậy mình sẽ phân biệt với rong kinh và rong huyết', '"rong huyết", "rong kinh" (DISEASESYMTOM)', 'Đúng cả 3 thực thể', '"huyết" (ORGAN) ×2', 'Thực thể chưa gặp: CRF sai, ViHealthBERT đúng'],
    ['hồi cái hiện tượng tiêu xương và hoàn thiện hai hàm răng…', '"tiêu xương" (DISEASESYMTOM)', '"xương" (ORGAN)', '"xương" (ORGAN)', 'Cắt ranh giới và sai loại'],
    ['…hai em muốn trồng răng implant nhưng làm vậy…', '"trồng răng implant" (SURGERY)', '"trồng răng" (SURGERY), "implant" (MEDDEVICE…)', 'Không nhận ra', 'Tách thực thể'],
    ['…ung thư đường sinh dục gây nên ra máu âm đạo bất thường', '"ra máu âm đạo" (DISEASESYMTOM)', '"máu", "âm đạo" (ORGAN)', '"máu", "âm đạo" (ORGAN)', 'Cắt ranh giới và sai loại'],
    ['là tự từ ba ngày đến năm ngày một số trường hợp…', '"ba ngày đến năm ngày" (DATETIME)', '"ba ngày đến", "năm ngày"', '—', 'Lệch ranh giới'],
  ], [2.8, 2, 1.9, 1.5, 1.6], 'Ví dụ lỗi thật trên tập test'),

  h2('6.8 Đối chiếu với kết quả của bài báo gốc'),
  p('Bài báo VietMed-NER [1] báo XLM-R base đạt F1 0,69 và PhoBERT-base-v2 đạt 0,74 trên test, cao hơn nhiều so với số của nhóm. Nguyên nhân là **khác thước đo**: bài báo (Mục 4.1 và script slue.py trong repository của tác giả) dùng F1 kiểu SLUE [4], so khớp tập hợp các cặp (loại, âm tiết) mà không xét ranh giới thực thể. Thước đo này dễ hơn seqeval strict. Chấm lại cùng các dự đoán bằng thước đo SLUE:'),
  ...table(['Mô hình', 'F1 strict (báo cáo này)', 'F1 kiểu SLUE', 'Bài báo công bố'], slueRows, [2.6, 2.1, 2.1, 2.2], 'So sánh hai thước đo trên cùng dự đoán (%)'),
  p(`Với cùng checkpoint XLM-R của tác giả, F1 kiểu SLUE của nhóm là ${pct(M['XLM-R'].test_slue_f1)}%, khớp với con số 69% của bài báo. Như vậy phần lớn khoảng cách đến từ thước đo, không phải do nhóm huấn luyện kém. PhoBERT vẫn thấp hơn bài báo khoảng 3 điểm, có thể do bài báo dùng input đã tách từ và huấn luyện 50 epoch với batch 64. **Thứ hạng thay đổi theo thước đo:** theo SLUE, ${bestSlue} đứng đầu (${pct(M[bestSlue].test_slue_f1)}%) và CRF đứng sau các Transformer, vì Transformer nhận ra nhiều âm tiết thuộc thực thể hơn dù ranh giới chưa chính xác. Báo cáo chọn strict làm thước đo chính vì ứng dụng cần trích xuất đúng cả cụm.`),

  // 7 ------------------------------------------------------------------
  h1('7. So sánh mô hình'),
  bullet(`**Phân loại từng token so với mô hình chuỗi:** Logistic Regression và Linear SVM dùng cùng đặc trưng với CRF nhưng kém CRF ${pct(M.CRF.test_f1 - M['Logistic Regression'].test_f1, 1)} và ${pct(pair('CRF - Linear SVM').delta, 1)} điểm F1 test. Chúng dự đoán từng âm tiết độc lập nên tạo nhiều chuỗi nhãn vô lý: trên test, Logistic Regression và Linear SVM sinh ra ${int(invalidBio['Logistic Regression'])} và ${int(invalidBio['Linear SVM'])} lần chuyển nhãn không hợp lệ (I- đứng sau O hoặc sau nhãn khác loại), trong khi CRF chỉ có ${invalidBio.CRF} lần (các Transformer: ${int(invalidBio.ViHealthBERT)}–${int(invalidBio['XLM-R'])}). CRF học thêm xác suất chuyển giữa các nhãn liền kề nên ranh giới chính xác hơn và ít lỗi lệch ranh giới nhất (${int(so('CRF').boundary)} so với ${int(so('Logistic Regression').boundary)} của Logistic Regression).`),
  bullet(`**CRF thắng trên test** nhờ đặc trưng từ vựng giúp nhớ chính xác thuật ngữ y khoa, và 69% thực thể test đã xuất hiện trong train. Precision cao hơn cho thấy CRF ít đoán thừa. Nhược điểm: overfit mạnh (train F1 gần 100%) và chỉ nhận ra ${pct(M.CRF.recall_unseen, 1)}% thực thể mới.`),
  bullet(`**ViHealthBERT tổng quát hoá tốt nhất:** nhận ra ${pct(M.ViHealthBERT.recall_unseen, 1)}% thực thể mới, gấp khoảng ${num(M.ViHealthBERT.recall_unseen / M.CRF.recall_unseen, 1)} lần CRF, nhờ được pretrain thêm trên văn bản y tế. Nó ngang PhoBERT về F1 tổng nhưng tốt hơn ở các lớp y khoa.`),
  bullet('**XLM-R kém nhất trong nhóm Transformer** dù nhiều tham số nhất (277M), vì là mô hình đa ngôn ngữ và dùng nguyên checkpoint của tác giả.'),
  bullet(`**Về triển khai**, mô hình cổ điển huấn luyện trong vài phút trên CPU. ViHealthBERT nhẹ và nhanh hơn XLM-R (${num(SPEED.vihealthbert.throughput_sentences_per_s_bs32, 0)} so với ${num(SPEED.xlm_roberta_baseline.throughput_sentences_per_s_bs32, 0)} câu/giây, VRAM ${num(SPEED.vihealthbert.peak_vram_mb, 0)} so với ${num(SPEED.xlm_roberta_baseline.peak_vram_mb, 0)} MB).`),
  p('**Mô hình phù hợp với dữ liệu:** nếu dữ liệu sử dụng chủ yếu lặp lại thuật ngữ đã có trong train, CRF là lựa chọn tốt, rẻ và chính xác nhất theo thước đo strict. Nếu hệ thống phải xử lý hội thoại thuộc chủ đề bệnh mới, như trường hợp tập test, ViHealthBERT phù hợp hơn vì nhận ra được nhiều thực thể mới hơn hẳn. Một hướng kết hợp tự nhiên là BERT-CRF (mục 9).'),
  h2('7.1 Các yếu tố ảnh hưởng đến kết quả'),
  numbered('**Lệch miền giữa train/validation và test** là yếu tố lớn nhất: 30,7% thực thể test chưa gặp trong train, làm mọi mô hình mất 21–27 điểm F1.'),
  numbered('**Mất cân bằng lớp** khiến các lớp hiếm (ORGANIZATION, TRANSPORTATION, PREVENTIVEMED ở test) gần như không học được.'),
  numbered('**Ranh giới nhãn mơ hồ** giữa MEDDEVICETECHNIQUE, SURGERY, PREVENTIVEMED, PERSONALCARE và giữa bệnh với cơ quan.'),
  numbered('**Thước đo đánh giá:** strict và SLUE cho thứ hạng khác nhau; việc để nhãn "0" bị tính như một loại thực thể làm F1 lệch khoảng 1,5 điểm.'),
  numbered('**Siêu tham số:** learning rate nhỏ và ít epoch gây underfitting; cấu hình tốt nhất nằm ở biên lưới tìm kiếm.'),
  h2('7.2 Phần mở rộng: pipeline âm thanh và sửa lỗi transcript'),
  p('Trên 500 câu nói test, Whisper-small (MultiMed-ST) có WER 26,1%, trong khi trên train chỉ 4,1%. Khoảng cách này là do mô hình ASR đã được huấn luyện trên chính VietMed train+dev: phần tiếng Việt của MultiMed có 4.548 + 1.137 = 5.685 câu, đúng bằng VietMed train+dev. Tỉ lệ thực thể còn giữ được sau ASR: XLM-R 52,79%, PhoBERT 53,27%, ViHealthBERT 52,59%.'),
  ...table(['Phương án sửa lỗi', 'WER dev', 'WER test', 'Sửa nhầm câu đúng (test)'], [
    ['R0: giữ nguyên transcript', '4,44%', '28,35%', '0%'],
    ['R1: luật học từ train', '4,44%', '28,35%', '0%'],
    ['R2: mô hình sửa lỗi có sẵn (zero-shot)', '5,25%', '27,90%', '19,09%'],
    ['R3: fine-tune LoRA, seed 42 (chọn theo dev)', '5,36%', '27,98%', '17,34%'],
    ['R3: trung bình 3 seed (42, 43, 44)', '5,50%', '27,91% ± 0,06', '18,94%'],
  ], [3.8, 1.2, 1.6, 2.4], 'So sánh các phương án sửa lỗi transcript ASR'),
  ...figure('fig_lora_overfitting.png', 440, 'LoRA sửa lỗi transcript: train loss và dev WER theo epoch (3 seed)'),
  p('Với LoRA, train loss giảm đều qua 3 epoch (khoảng 0,98 → 0,62 → 0,54) trong khi WER trên dev tăng (seed 42: 5,36% → 5,94% → 6,06%), nên early stopping chọn epoch 1 cho cả 3 seed. Đây là một ví dụ overfitting điển hình. Seed 42 được chọn theo dev; trên test nó chỉ giảm WER 1,29% tương đối (trung bình 3 seed là 1,53%) trong khi sửa nhầm 17–22% câu vốn đã đúng, nên không phù hợp để sửa tự động.'),

  // 8 ------------------------------------------------------------------
  h1('8. Kết luận'),
  p(`Đồ án đã phân tích bộ dữ liệu VietMed-NER, kiểm tra chất lượng và nguồn gốc dữ liệu, mã hoá nhãn và đặc trưng, rồi cài đặt và so sánh sáu mô hình NER. Trên validation (cùng miền), năm mô hình do nhóm huấn luyện đạt F1 khoảng ${pct(M['Logistic Regression'].val_f1, 0)}–${pct(M.CRF.val_f1, 0)}%; trên test (khác miền) chỉ đạt ${pct(M['Logistic Regression'].test_f1, 0)}–${pct(M.CRF.test_f1, 0)}%.`),
  p(`Theo thước đo strict, CRF là mô hình tốt nhất trên test (F1 ${pct(M.CRF.test_f1)}%), với lợi thế nhỏ nhưng có ý nghĩa thống kê so với ViHealthBERT. Mô hình chuỗi (CRF) vượt rõ mô hình phân loại từng token dùng cùng đặc trưng. ViHealthBERT và PhoBERT ngang nhau, và ViHealthBERT tổng quát hoá sang thực thể mới tốt nhất. Nút thắt chính nằm ở dữ liệu: lệch miền giữa các tập, mất cân bằng lớp nặng và ranh giới nhãn mơ hồ. Các mô hình được huấn luyện đều overfit tập train, và lỗi chủ yếu là lệch ranh giới và đoán thừa thực thể.`),

  // 9 ------------------------------------------------------------------
  h1('9. Hướng phát triển'),
  bullet('Kết hợp hai ưu điểm bằng BERT-CRF: biểu diễn ngữ nghĩa của ViHealthBERT và ràng buộc chuyển nhãn của CRF, để giảm lỗi ranh giới và đoán thừa.'),
  bullet('Dùng trọng số lớp hoặc oversampling cho các lớp hiếm.'),
  bullet('Mở rộng lưới siêu tham số (learning rate 5e-5, 10 epoch) vì cấu hình tốt nhất đang nằm ở biên lưới.'),
  bullet('Tách từ bằng VnCoreNLP trước khi đưa vào PhoBERT, vì PhoBERT được pretrain trên văn bản đã tách từ.'),
  bullet('Bổ sung dữ liệu thuộc miền của test (podcast, bài giảng, tin tức) hoặc dùng từ điển thuật ngữ y khoa để giảm tỉ lệ thực thể chưa gặp.'),
  bullet('Trong hệ thống thực tế, chỉ gợi ý sửa lỗi transcript để người dùng duyệt, không áp dụng tự động.'),

  // 10 -----------------------------------------------------------------
  h1('10. Tài liệu tham khảo'),
  numbered('K. Le-Duc, D. Thulke, H.-P. Tran, L. Vo-Dang, K.-H. Nguyen, T.-S. Hy, R. Schlüter. "Medical Spoken Named Entity Recognition." NAACL 2025 (Industry Track). arXiv:2406.13337. Dataset: huggingface.co/datasets/leduckhai/VietMed-NER.', 'refs'),
  numbered('D. Q. Nguyen, A. T. Nguyen. "PhoBERT: Pre-trained language models for Vietnamese." Findings of EMNLP 2020.', 'refs'),
  numbered('N. Minh, V. H. Tran, V. Hoang, H. D. Ta, T. H. Bui, S. Q. H. Truong. "ViHealthBERT: Pre-trained Language Models for Vietnamese in Health Text Mining." LREC 2022.', 'refs'),
  numbered('S. Shon và cộng sự. "SLUE: New Benchmark Tasks for Spoken Language Understanding Evaluation on Natural Speech." ICASSP 2022.', 'refs'),
  numbered('J. Lafferty, A. McCallum, F. Pereira. "Conditional Random Fields: Probabilistic Models for Segmenting and Labeling Sequence Data." ICML 2001.', 'refs'),
  numbered('A. Conneau và cộng sự. "Unsupervised Cross-lingual Representation Learning at Scale" (XLM-RoBERTa). ACL 2020.', 'refs'),
  numbered('H. Nakayama. "seqeval: A Python framework for sequence labeling evaluation." 2018. github.com/chakki-works/seqeval.', 'refs'),
  numbered('K. Le-Duc và cộng sự. "MultiMed: Multilingual Medical Speech Recognition via Attention Encoder Decoder." arXiv:2409.14074.', 'refs'),

  // 11 -----------------------------------------------------------------
  h1('11. Phụ lục: mã nguồn'),
  p('Mã nguồn và kết quả nằm trong thư mục nộp do_an_may_hoc/:'),
  bullet('VietMed_NER_MayHoc.ipynb — notebook chính: tải dữ liệu, EDA, kiểm tra chất lượng, huấn luyện Logistic Regression, Linear SVM, CRF; chấm ba Transformer; bootstrap; confusion matrix; phân tích lỗi; sinh toàn bộ hình và bảng vào results/.'),
  bullet('notebooks_huan_luyen/NER_PhoBERT_RunAll.ipynb và NER_ViHealthBERT_RunAll.ipynb — fine-tune PhoBERT và ViHealthBERT (lưới 18 cấu hình, 3 seed).'),
  bullet('checkpoints/phobert, checkpoints/vihealthbert — checkpoint do nhóm fine-tune, nộp kèm.'),
  bullet('ket_qua_goc/ — kết quả từ các lần huấn luyện gốc (dò siêu tham số, đo tốc độ, LoRA sửa lỗi transcript, đường cong học ViHealthBERT).'),
  bullet('bao_cao/build_docx.js — sinh file báo cáo này từ results/.'),
  h2('11.1 Căn nhãn theo subword đầu'),
  ...code([
    'def encode_words(words, tokenizer, row_labels):',
    '    ids, labels = [tokenizer.cls_token_id], [-100]',
    '    for word, label in zip(words, row_labels):',
    '        sub = tokenizer.encode(word, add_special_tokens=False)',
    '        ids += sub',
    '        labels += [label2id[label]] + [-100] * (len(sub) - 1)',
    '    return ids[:255] + [tokenizer.sep_token_id], labels[:255] + [-100]',
  ]),
  h2('11.2 Đặc trưng và huấn luyện mô hình cổ điển'),
  ...code([
    'def word_features(words, i):',
    '    w = words[i]',
    "    f = {'w.lower': w.lower(), 'w.isdigit': w.isdigit(), 'suf2': w[-2:], 'pre2': w[:2]}",
    '    for off in (-2, -1, 1, 2):',
    '        if 0 <= i + off < len(words):',
    "            f[f'{off}:w.lower'] = words[i + off].lower()",
    '    return f',
    '',
    'X = DictVectorizer().fit_transform(token_features)      # LogReg / Linear SVM',
    'LogisticRegression(C=C).fit(X, y); LinearSVC(C=C).fit(X, y)',
    "sklearn_crfsuite.CRF(algorithm='lbfgs', c1=0.1, c2=0.01).fit(sentence_features, tags)",
  ]),
  h2('11.3 Paired bootstrap cho chênh lệch F1'),
  ...code([
    'for _ in range(2000):',
    '    idx = rng.integers(0, n_sentences, n_sentences)      # cùng mẫu cho mọi mô hình',
    '    for m in models:',
    '        tp, n_gold, n_pred = counts[m]',
    '        boot[m].append(f1(tp[idx].sum(), n_gold[idx].sum(), n_pred[idx].sum()))',
    'ci95 = np.percentile(boot[a] - boot[b], [2.5, 97.5])',
  ]),
];

const bulletLevel = { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } };
const decimalLevel = (text) => ({ level: 0, format: LevelFormat.DECIMAL, text, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } });
const doc = new Document({
  creator: 'Nhóm đồ án', title: 'Báo cáo đồ án Máy học — NER y tế VietMed',
  styles: {
    default: { document: { run: { font: FONT, size: 26 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: FONT, color: '1F3864' }, paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: FONT, color: '2F5496' }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1, keepNext: true } },
    ],
  },
  numbering: { config: [
    { reference: 'bullets', levels: [bulletLevel] },
    { reference: 'numbers', levels: [decimalLevel('%1.')] },
    { reference: 'refs', levels: [decimalLevel('[%1]')] },
  ] },
  features: { updateFields: true },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 22 })] })] }) },
    children: [...cover, ...body],
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(OUT, buf); console.log('wrote', OUT, 'best', best, 'bestSlue', bestSlue); });
