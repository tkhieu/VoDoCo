// Builds presentation/may-hoc.pptx (Máy học — VietMed-NER) from do_an_may_hoc/results.
// Usage: node build-may-hoc-pptx.js <repo root> [logo png]   (requires: npm install pptxgenjs)
const fs = require('fs');
const path = require('path');
const pptxgen = require('pptxgenjs');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const LOGO = process.argv[3] || path.join(ROOT, 'presentation/assets/images/uit_logo.png');
const RES = path.join(ROOT, 'do_an_may_hoc/results');
const FIG = path.join(ROOT, 'presentation/assets/images/ml');
const OUT = path.join(ROOT, 'presentation/may-hoc.pptx');
const J = (f) => JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8'));
const MC = J('model_comparison.json');
const M = MC.models;
const EDA = J('eda.json');
const DQ = J('data_quality.json');
const CURVE = J('vihealthbert_epoch_curve.json');
const PRED = J('test_predictions.json');
const ORDER = ['Logistic Regression', 'Linear SVM', 'CRF', 'XLM-R', 'PhoBERT', 'ViHealthBERT'];

// ---------- formatting
const pct = (x, d = 2) => (x * 100).toFixed(d).replace('.', ',');
const int = (x) => Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const sgn = (x) => `${x >= 0 ? '+' : '−'}${pct(Math.abs(x))}`;

// ---------- palette & type
const C = {
  navy: '0F2A3D', navy2: '17384F', ink: '1B2733', muted: '5B6B7A', line: 'D5DEE5',
  tint: 'EEF4F7', white: 'FFFFFF', coral: 'E4572E', coralTint: 'FCE9E3', teal: '2A9D8F', tealTint: 'E3F3F1', gold: 'E9A23B',
};
const HEAD = 'Cambria';
const BODY = 'Calibri';
const SERIES = ['4C72B0', 'DD8452', '55A868'];

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
pres.title = 'Nhận dạng thực thể y tế trong hội thoại tiếng Việt';
const W = 13.333;
let slideNo = 0;

function base(title) {
  const s = pres.addSlide();
  slideNo += 1;
  s.background = { color: C.white };
  s.addText(title, { x: 0.6, y: 0.35, w: W - 1.2, h: 0.75, fontFace: HEAD, fontSize: 30, bold: true, color: C.navy, margin: 0, isTextBox: true });
  s.addText(`${slideNo} / 16`, { x: W - 1.6, y: 7.05, w: 1.0, h: 0.3, fontFace: BODY, fontSize: 10, color: C.muted, align: 'right', margin: 0, isTextBox: true });
  return s;
}

function card(s, x, y, w, h, fill = C.tint) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill }, line: { color: fill }, rectRadius: 0.08 });
}

// bullets: array of strings; **bold** segments supported
function runs(text, opts = {}) {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) => (part.startsWith('**')
    ? { text: part.slice(2, -2), options: { bold: true, ...opts } } : { text: part, options: { ...opts } }));
}
function bullets(s, items, x, y, w, h, size = 15, color = C.ink) {
  const arr = [];
  items.forEach((it, i) => {
    const r = runs(it, { fontSize: size, color, fontFace: BODY });
    r[0].options = { ...r[0].options, bullet: { indent: 16 }, paraSpaceAfter: 6 };
    if (i < items.length - 1) r[r.length - 1].options = { ...r[r.length - 1].options, breakLine: true };
    arr.push(...r);
  });
  s.addText(arr, { x, y, w, h, valign: 'top', margin: 0.05, isTextBox: true });
}
function heading(s, text, x, y, w, color = C.navy) {
  s.addText(text, { x, y, w, h: 0.4, fontFace: HEAD, fontSize: 18, bold: true, color, margin: 0, isTextBox: true });
}
function table(s, header, rows, opt) {
  const { x, y, w, colW, size = 12, highlight = -1, rowH = 0.32 } = opt;
  const numeric = header.map((_, i) => i > 0 && rows.every((r) => /^[\d.,%–\-−+\[\]; ()P/R|—]+$/.test(String(r[i]).replace(/\s/g, ''))));
  const head = header.map((t, i) => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.navy }, align: numeric[i] ? 'right' : 'left' } }));
  const body = rows.map((r, ri) => r.map((t, i) => ({ text: String(t), options: {
    align: numeric[i] ? 'right' : 'left', bold: ri === highlight, color: C.ink,
    fill: { color: ri === highlight ? C.coralTint : (ri % 2 ? C.white : 'F7FAFB') } } })));
  s.addTable([head, ...body], { x, y, w, colW, fontFace: BODY, fontSize: size, rowH, border: { type: 'solid', pt: 0.5, color: C.line }, margin: [2, 5, 2, 5] });
}
function image(s, file, x, y, w) {
  const buf = fs.readFileSync(path.join(FIG, file));
  const h = w * buf.readUInt32BE(20) / buf.readUInt32BE(16);
  s.addImage({ path: path.join(FIG, file), x, y, w, h, altText: file });
  return h;
}
function kpi(s, big, label, x, y, w, h, color) {
  card(s, x, y, w, h, C.tint);
  s.addText(big, { x: x + 0.2, y: y + 0.12, w: w - 0.4, h: h * 0.52, fontFace: HEAD, fontSize: 30, bold: true, color, margin: 0, valign: 'middle', isTextBox: true });
  s.addText(label, { x: x + 0.2, y: y + h * 0.6, w: w - 0.4, h: h * 0.35, fontFace: BODY, fontSize: 12.5, color: C.muted, margin: 0, valign: 'top', isTextBox: true });
}
const chartBase = {
  fontFace: BODY, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, catAxisLabelColor: C.muted, valAxisLabelColor: C.muted,
  valGridLine: { color: 'E6ECF0', size: 0.5 }, catGridLine: { style: 'none' }, showLegend: true, legendPos: 'b', legendFontSize: 11,
  titleFontSize: 13, titleColor: C.navy, showTitle: true,
};

// ============================================================ 1. Title
{
  const s = pres.addSlide();
  slideNo += 1;
  s.background = { color: C.navy };
  card(s, 0.7, 0.55, 0.95, 0.95, C.white);
  s.addImage({ path: LOGO, x: 0.75, y: 0.6, w: 0.85, h: 0.85, altText: 'Logo UIT' });
  s.addText('TRƯỜNG ĐẠI HỌC CÔNG NGHỆ THÔNG TIN\nĐẠI HỌC QUỐC GIA TP. HỒ CHÍ MINH', { x: 1.85, y: 0.62, w: 6, h: 0.8, fontFace: BODY, fontSize: 13, bold: true, color: C.white, margin: 0, valign: 'middle', isTextBox: true });
  s.addText('Nhận dạng thực thể y tế\ntrong hội thoại tiếng Việt', { x: 0.7, y: 2.0, w: 8.2, h: 1.9, fontFace: HEAD, fontSize: 44, bold: true, color: C.white, margin: 0, valign: 'top', isTextBox: true });
  s.addText('So sánh 6 mô hình học máy trên VietMed-NER', { x: 0.7, y: 3.95, w: 8.2, h: 0.5, fontFace: BODY, fontSize: 20, color: '9FD8CF', margin: 0, isTextBox: true });
  s.addText([
    { text: 'Môn học: Máy học', options: { breakLine: true } },
    { text: 'Giảng viên hướng dẫn: Đặng Văn Thìn', options: { breakLine: true } },
    { text: 'Nhóm thực hiện: Nhóm 8' },
  ], { x: 0.7, y: 5.2, w: 7, h: 1.2, fontFace: BODY, fontSize: 16, color: 'D6E2EA', margin: 0, paraSpaceAfter: 4, isTextBox: true });
  const tiles = [['6', 'mô hình, từ Logistic Regression đến ViHealthBERT'], ['18', 'loại thực thể y tế, 37 nhãn BIO'], [int(EDA.train.sentences + EDA.validation.sentences + EDA.test.sentences), 'câu hội thoại có gán nhãn']];
  tiles.forEach(([big, label], i) => {
    const y = 1.9 + i * 1.55;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 9.4, y, w: 3.25, h: 1.3, fill: { color: C.navy2 }, line: { color: C.navy2 }, rectRadius: 0.1 });
    s.addText(big, { x: 9.6, y: y + 0.1, w: 2.9, h: 0.65, fontFace: HEAD, fontSize: 32, bold: true, color: i === 0 ? C.coral : i === 1 ? '9FD8CF' : C.gold, margin: 0, isTextBox: true });
    s.addText(label, { x: 9.6, y: y + 0.75, w: 2.9, h: 0.45, fontFace: BODY, fontSize: 12, color: 'D6E2EA', margin: 0, isTextBox: true });
  });
  s.addNotes('Kính chào Thầy và các bạn. Nhóm 8 trình bày đồ án môn Máy học: nhận dạng thực thể y tế trong hội thoại tiếng Việt. Nhóm so sánh sáu mô hình, từ Logistic Regression, Linear SVM, CRF đến ba Transformer XLM-RoBERTa, PhoBERT và ViHealthBERT, trên bộ dữ liệu VietMed-NER. Giảng viên hướng dẫn: Thầy Đặng Văn Thìn. Thời gian: 30 giây.');
}

// ============================================================ 2. Bài toán
{
  const s = base('Bài toán: gán nhãn chuỗi theo sơ đồ BIO');
  const steps = [['AUDIO', 'Hội thoại y tế'], ['ASR', 'Nhận dạng tiếng nói'], ['TEXT', 'Transcript âm tiết'], ['NER', 'Phạm vi đồ án']];
  steps.forEach(([t, d], i) => {
    const x = 0.6 + i * 3.15;
    const focus = i === 3;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.35, w: 2.6, h: 1.05, fill: { color: focus ? C.coral : C.tint }, line: { color: focus ? C.coral : C.tint }, rectRadius: 0.1 });
    s.addText(t, { x, y: 1.42, w: 2.6, h: 0.5, fontFace: HEAD, fontSize: 20, bold: true, color: focus ? C.white : C.navy, align: 'center', margin: 0, isTextBox: true });
    s.addText(d, { x, y: 1.9, w: 2.6, h: 0.4, fontFace: BODY, fontSize: 13, color: focus ? C.white : C.muted, align: 'center', margin: 0, isTextBox: true });
    if (i < 3) s.addText('→', { x: x + 2.6, y: 1.55, w: 0.55, h: 0.6, fontSize: 26, color: C.muted, align: 'center', margin: 0, isTextBox: true });
  });
  card(s, 0.6, 2.8, 5.9, 3.9);
  heading(s, 'Đầu vào → đầu ra', 0.85, 2.98, 5.4);
  bullets(s, ['**Đầu vào:** câu tiếng Việt đã tách theo âm tiết', '**Đầu ra:** một nhãn cho mỗi âm tiết',
    '**B-X** mở đầu thực thể loại X, **I-X** nối tiếp, **O** ngoài thực thể', '**18 loại thực thể → 37 nhãn** (18 × B/I + O)',
    'Loại dữ liệu: **văn bản** ⇒ EDA và tiền xử lý thiết kế riêng cho văn bản'], 0.85, 3.5, 5.45, 3.0, 16);
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 6.85, y: 2.8, w: 5.9, h: 3.9, fill: { color: C.white }, line: { color: C.line, width: 1 }, rectRadius: 0.08 });
  heading(s, 'Ví dụ từ tập test', 7.1, 2.98, 5.4);
  const toks = [['rong', 'B-DISEASESYMTOM', 1], ['huyết', 'I-DISEASESYMTOM', 1], ['như', 'O', 0], ['vậy', 'O', 0], ['…', 'O', 0], ['rong', 'B-DISEASESYMTOM', 1], ['kinh', 'I-DISEASESYMTOM', 1]];
  toks.forEach(([w, t, ent], i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = 7.1 + col * 1.37;
    const y = 3.6 + row * 1.25;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: 1.27, h: 1.05, fill: { color: ent ? C.coralTint : C.tint }, line: { color: ent ? C.coral : C.line, width: 1 }, rectRadius: 0.08 });
    s.addText(w, { x, y: y + 0.1, w: 1.27, h: 0.45, fontFace: HEAD, fontSize: 18, bold: true, color: C.ink, align: 'center', margin: 0, isTextBox: true });
    s.addText(t, { x, y: y + 0.58, w: 1.27, h: 0.35, fontFace: BODY, fontSize: 8.5, color: ent ? C.coral : C.muted, align: 'center', margin: 0, isTextBox: true });
  });
  s.addText('Bệnh/triệu chứng, cơ quan, thuốc, thời gian, tuổi, nghề nghiệp, …', { x: 7.1, y: 6.15, w: 5.4, h: 0.35, fontFace: BODY, fontSize: 12, italic: true, color: C.muted, margin: 0, isTextBox: true });
  s.addNotes('Bài toán là nhận dạng thực thể có tên trong transcript hội thoại y tế. Đây là một khâu trong hệ thống âm thanh → ASR → văn bản → NER, dùng để hỗ trợ ghi chép hồ sơ y tế; đồ án tập trung vào khâu NER. Mỗi âm tiết được gán một nhãn BIO: B-X là âm tiết đầu của thực thể loại X, I-X là âm tiết tiếp theo, O là ngoài thực thể. Có 18 loại thực thể, tức 37 nhãn. Ví dụ lấy từ tập test: "rong huyết" và "rong kinh" đều là DISEASESYMTOM. Dữ liệu là văn bản, không phải bảng, ảnh hay video, nên EDA và tiền xử lý được thiết kế riêng cho văn bản. Thời gian: 45 giây.');
}

// ============================================================ 3. Bộ dữ liệu
{
  const s = base('Bộ dữ liệu VietMed-NER');
  const tot = (k) => EDA.train[k] + EDA.validation[k] + EDA.test[k];
  kpi(s, int(tot('sentences')), 'câu (3 tập chính thức)', 0.6, 1.3, 3.9, 1.25, C.teal);
  kpi(s, int(tot('tokens')), 'âm tiết (token)', 4.72, 1.3, 3.9, 1.25, C.gold);
  kpi(s, int(tot('entity_total')), 'thực thể được gán nhãn', 8.84, 1.3, 3.9, 1.25, C.coral);
  table(s, ['Tập', 'Số câu', 'Số token', 'Số thực thể', 'Câu không có thực thể', 'Độ dài TB / trung vị'],
    ['train', 'validation', 'test'].map((k) => [k, int(EDA[k].sentences), int(EDA[k].tokens), int(EDA[k].entity_total), int(EDA[k].sentences_without_entity),
      `${EDA[k].len_mean.toFixed(1).replace('.', ',')} / ${EDA[k].len_median}`]),
    { x: 0.6, y: 2.95, w: 7.6, colW: [1.3, 1.0, 1.15, 1.2, 1.5, 1.45], size: 13, rowH: 0.42 });
  card(s, 8.6, 2.95, 4.13, 3.7);
  heading(s, 'Nguồn và gán nhãn', 8.85, 3.12, 3.7);
  bullets(s, ['Transcript của **VietMed** (âm thanh y tế thật)', '**2 người gán nhãn** độc lập, 1 người có nền y khoa',
    'Xung đột giải quyết qua thảo luận; **2 người khác rà soát** toàn bộ', 'Test có câu ngắn hơn: trung vị **20** so với **26** âm tiết'], 8.85, 3.62, 3.7, 2.9, 14.5);
  s.addText('Bộ dữ liệu: leduckhai/VietMed-NER (Le-Duc và cộng sự, NAACL 2025).', { x: 0.6, y: 4.95, w: 7.6, h: 0.4, fontFace: BODY, fontSize: 12, italic: true, color: C.muted, margin: 0, isTextBox: true });
  s.addNotes('Bộ dữ liệu leduckhai/VietMed-NER được xây dựng từ transcript của VietMed, bộ dữ liệu âm thanh y tế tiếng Việt thật. Có sẵn ba tập: train 4.616 câu, validation 1.154 câu, test 3.497 câu; tổng cộng 9.267 câu và 22.974 thực thể. Về gán nhãn: hai người gán nhãn độc lập, một người có nền tảng y khoa; xung đột được giải quyết qua thảo luận, sau đó hai người khác rà soát toàn bộ corpus nhiều lần. Lưu ý test có câu ngắn hơn: trung vị 20 âm tiết so với 26 ở train. Thời gian: 45 giây.');
}

// ============================================================ 4. EDA imbalance
{
  const s = base('EDA: mất cân bằng lớp rất nặng');
  const types = Object.keys(EDA.train.entity_spans);
  s.addChart(pres.charts.BAR, ['train', 'validation', 'test'].map((k) => ({ name: k, labels: types, values: types.map((t) => EDA[k].entity_spans[t] || 0) })), {
    ...chartBase, x: 0.5, y: 1.25, w: 8.9, h: 5.6, barDir: 'col', barGrouping: 'clustered', chartColors: SERIES,
    title: 'Số thực thể theo loại và theo tập', catAxisLabelRotate: -50, catAxisLabelFontSize: 9, valAxisTitle: 'Số thực thể', showValAxisTitle: true, valAxisTitleFontSize: 10,
  });
  const share = (k, t) => pct((EDA[k].entity_spans[t] || 0) / EDA[k].entity_total, 1);
  kpi(s, `${pct(EDA.train.o_token_ratio, 1)}%`, 'token train mang nhãn O ⇒ accuracy ít ý nghĩa', 9.7, 1.3, 3.05, 1.6, C.teal);
  kpi(s, '≈ 600×', `DISEASESYMTOM ${int(EDA.train.entity_spans.DISEASESYMTOM)} so với TRANSPORTATION ${EDA.train.entity_spans.TRANSPORTATION}`, 9.7, 3.1, 3.05, 1.6, C.coral);
  kpi(s, `${EDA.train.entity_spans.PREVENTIVEMED} → ${EDA.test.entity_spans.PREVENTIVEMED}`, `PREVENTIVEMED train → test (${share('train', 'PREVENTIVEMED')}% → ${share('test', 'PREVENTIVEMED')}%)`, 9.7, 4.9, 3.05, 1.6, C.gold);
  s.addNotes('Mất cân bằng lớp rất nặng. Khoảng 78,5% token ở train mang nhãn O. Ở mức thực thể, lớp lớn nhất DISEASESYMTOM có 2.975 mẫu train, nhiều gấp khoảng 600 lần lớp nhỏ nhất TRANSPORTATION chỉ có 5 mẫu. ORGANIZATION và TRANSPORTATION có dưới 20 mẫu train. Mất cân bằng còn xảy ra giữa các tập: train và validation có phân bố gần giống nhau, nhưng test lệch rõ. PREVENTIVEMED chiếm 2,9% thực thể ở train nhưng chỉ 0,2% ở test; MEDDEVICETECHNIQUE tăng từ 2,8% lên 7,6%; GENDER tăng từ 1,8% lên 6,7%. Hệ quả: accuracy mức token không có ý nghĩa (đoán toàn O đã đạt gần 79%), nên nhóm dùng F1 mức thực thể. Thời gian: 1 phút.');
}

// ============================================================ 5. Lệch miền
{
  const s = base('EDA: test lệch miền so với train và validation');
  card(s, 0.6, 1.3, 6.0, 2.15);
  heading(s, 'Nguồn gốc từng câu (đã đối chiếu)', 0.85, 1.45, 5.5);
  const L = DQ.lineage;
  const trainVal = ['train', 'validation'].reduce((a, k) => a + Object.values(L[k]).reduce((x, y) => x + y, 0), 0);
  bullets(s, [`**100%** câu train + validation khớp VietMed train + dev + cv (**${int(trainVal)} câu**), chia ngẫu nhiên từ chung một nguồn`,
    `Test: **${int(L.test.test)}** câu khớp VietMed test, ${L.test.no_exact_match} câu không khớp chính xác`], 0.85, 1.95, 5.55, 1.45, 14.5);
  table(s, ['VietMed', 'Nhóm bệnh ICD-10 chính', 'Ngữ cảnh ghi âm'], [
    ['train', 'M, E, C–D, G, I', 'Tư vấn, điện thoại'], ['dev', 'Z, I, F, R, D, L', 'Điện thoại, sách, tư vấn'], ['test', 'K, M, O, P, N, V–Y, H', 'Podcast, talkshow, bài giảng, tin tức']],
    { x: 0.6, y: 3.75, w: 6.0, colW: [1.0, 2.1, 2.9], size: 12.5, rowH: 0.42 });
  const O = DQ.oov;
  table(s, [`So với từ vựng train (${int(O.train_vocab)} âm tiết)`, 'Validation', 'Test'], [
    ['Token chưa gặp', `${pct(O.validation.token_oov_rate)}%`, `${pct(O.test.token_oov_rate)}%`],
    ['Loại âm tiết chưa gặp', `${pct(O.validation.type_oov_rate, 1)}%`, `${pct(O.test.type_oov_rate, 1)}%`],
    ['Thực thể chưa gặp', `${pct(O.validation.unseen_entity_rate, 1)}%`, `${pct(O.test.unseen_entity_rate, 1)}%`]],
    { x: 6.95, y: 1.3, w: 5.8, colW: [3.2, 1.3, 1.3], size: 13.5, highlight: 2, rowH: 0.45 });
  card(s, 6.95, 3.55, 5.8, 2.7, C.coralTint);
  heading(s, 'Hệ quả', 7.2, 3.72, 5.3, C.coral);
  bullets(s, ['Validation **cùng miền** với train; test là các bản ghi **khác hẳn**', `Gần **1/3** thực thể test chưa từng xuất hiện ở train`, 'Mô hình dựa vào **ghi nhớ** sẽ tụt mạnh trên test'], 7.2, 4.2, 5.3, 1.9, 15);
  s.addNotes('Nhóm đối chiếu từng câu của VietMed-NER với transcript gốc của VietMed. 100% câu của train và validation khớp với VietMed train, dev và cv, tổng 5.770 câu, và hai tập này được chia ngẫu nhiên từ chung một nguồn. Test gồm 3.437 câu khớp VietMed test và 60 câu không khớp chính xác. Nhóm bệnh ICD-10 và ngữ cảnh ghi âm của ba tập VietMed gần như không trùng nhau: test chủ yếu là podcast, talkshow, bài giảng, tin tức. Bằng chứng định lượng rõ nhất: tỉ lệ token chưa gặp là 0,42% ở validation nhưng 1,83% ở test; tỉ lệ thực thể có dạng chữ chưa gặp là 6,7% so với 30,7%. Điều này dự báo mô hình dựa vào ghi nhớ từ vựng sẽ giữ điểm cao trên validation nhưng giảm mạnh trên test. Thời gian: 1 phút.');
}

// ============================================================ 6. Tiền xử lý
{
  const s = base('Tiền xử lý và mã hoá dữ liệu');
  const Q = DQ.quality;
  const q = (k) => ['train', 'validation', 'test'].map((sp) => String(Q[sp][k]));
  table(s, ['Kiểm tra chất lượng', 'Train', 'Val', 'Test'], [
    ['Câu rỗng', ...q('empty_sentences')], ['Token rỗng', ...q('empty_tokens')], ['Số âm tiết ≠ số nhãn', ...q('length_mismatch')],
    ['Token chưa chuẩn hoá NFC', ...q('non_nfc_tokens')], ['Token có chữ hoa', ...q('uppercase_tokens')], ['Token chỉ gồm dấu câu', ...q('punctuation_only_tokens')],
    ['Chuỗi BIO lỗi (I- sau O)', ...q('invalid_bio_I_after_O')]],
    { x: 0.6, y: 1.3, w: 6.0, colW: [3.3, 0.9, 0.9, 0.9], size: 13, highlight: 6, rowH: 0.42 });
  s.addText('Không có giá trị thiếu; dữ liệu đã viết thường, chuẩn NFC. 23 chuỗi BIO lỗi (< 0,02% token) được giữ nguyên để không đổi tập đánh giá.',
    { x: 0.6, y: 4.85, w: 6.0, h: 0.8, fontFace: BODY, fontSize: 13, italic: true, color: C.muted, margin: 0, valign: 'top', isTextBox: true });
  card(s, 6.95, 1.3, 5.8, 5.35);
  heading(s, 'Mã hoá', 7.2, 1.48, 5.3);
  bullets(s, ['**Nhãn:** 37 nhãn BIO → số nguyên (label2id) chỉ từ train; nhãn "0" đổi thành O',
    '**Transformer:** âm tiết → subword; nhãn chỉ gán cho **subword đầu**, subword còn lại nhận -100 (bỏ qua khi tính loss); tối đa 256 subword',
    '**Mô hình cổ điển:** đặc trưng thủ công (âm tiết, là số, tiền/hậu tố 2 ký tự, cửa sổ ±2, bigram) → **DictVectorizer 77.424 chiều** (one-hot, thưa)',
    '**Chia dữ liệu:** giữ 3 tập chính thức; chọn siêu tham số theo validation, test chỉ dùng 1 lần'], 7.2, 1.98, 5.35, 4.55, 15);
  s.addNotes('Kiểm tra chất lượng: không có câu rỗng, token rỗng, không lệch số âm tiết và số nhãn, không có token chưa chuẩn hoá NFC, không chữ hoa, không dấu câu. Nghĩa là không có giá trị thiếu và không phải điền hay loại bỏ mẫu nào. Có 23 chuỗi BIO lỗi, 16 ở train và 7 ở test, chiếm chưa tới 0,02% token; nhóm giữ nguyên để không làm thay đổi tập đánh giá chính thức, seqeval coi I- đó là đầu thực thể mới. Mã hoá: 37 nhãn được ánh xạ sang số nguyên chỉ dựa trên train; nhãn O của dataset được lưu là chuỗi "0", nhóm đổi thành "O". Với Transformer, nhãn gán cho subword đầu, các subword còn lại nhận -100. Với mô hình cổ điển, đặc trưng thủ công được DictVectorizer biến thành vector thưa 77.424 chiều. Thời gian: 45 giây.');
}

// ============================================================ 7. Sáu mô hình
{
  const s = base('Sáu mô hình và siêu tham số được chọn');
  const lr = MC.classical_training['Logistic Regression'].best.C;
  const svm = MC.classical_training['Linear SVM'].best.C;
  table(s, ['Mô hình', 'Nhóm', 'Ý tưởng', 'Cấu hình được chọn (theo validation)'], [
    ['Logistic Regression', 'Cổ điển, từng token', 'Phân loại độc lập từng âm tiết', `L2, C = ${String(lr).replace('.', ',')}`],
    ['Linear SVM', 'Cổ điển, từng token', 'Siêu phẳng lề cực đại', `C = ${String(svm).replace('.', ',')}, one-vs-rest`],
    ['CRF', 'Cổ điển, mô hình chuỗi', 'Học thêm xác suất chuyển nhãn', 'c1 = 0,1, c2 = 0,01'],
    ['XLM-RoBERTa', 'Transformer đa ngôn ngữ', 'Checkpoint của tác giả bộ dữ liệu', 'Có sẵn, không train lại'],
    ['PhoBERT-base-v2', 'Transformer tiếng Việt', 'Pretrain văn bản tiếng Việt chung', 'lr 3e-5, 8 epoch, wd 0,05, seed 123'],
    ['ViHealthBERT', 'Transformer tiếng Việt y tế', 'Pretrain thêm văn bản y tế', 'lr 3e-5, 8 epoch, wd 0,01, seed 2024']],
    { x: 0.6, y: 1.2, w: 12.13, colW: [2.3, 2.6, 3.4, 3.83], size: 12.5, rowH: 0.34 });
  image(s, 'fig_sweep_underfitting.png', 0.6, 3.75, 7.6);
  card(s, 8.55, 3.85, 4.18, 3.0);
  heading(s, 'Dò 18 cấu hình Transformer', 8.8, 4.0, 3.8);
  bullets(s, ['lr × epoch × weight decay, rồi 3 seed', 'F1 val tăng theo lr và epoch', 'lr 5e-6, 4 epoch: PhoBERT chỉ **36,65%** ⇒ **underfitting**', 'Tốt nhất nằm ở biên lưới'], 8.8, 4.5, 3.75, 2.25, 14.5);
  s.addNotes('Sáu mô hình đi từ đơn giản đến phức tạp: hai mô hình phân loại từng token độc lập là Logistic Regression và Linear SVM; một mô hình chuỗi cổ điển là CRF; và ba Transformer. Siêu tham số cổ điển: Logistic Regression thử C ∈ {0,1; 1; 10; 30}, chọn C = 10; Linear SVM thử C ∈ {0,01; 0,1; 1; 3; 10}, chọn C = 1; CRF dò lưới c1 × c2, tốt nhất c1 = 0,1, c2 = 0,01. XLM-R là checkpoint của tác giả bộ dữ liệu, không train lại. PhoBERT và ViHealthBERT: lưới 18 cấu hình gồm learning rate {5e-6; 1e-5; 3e-5} × số epoch {4; 6; 8} × weight decay {0,01; 0,05}; cấu hình tốt nhất huấn luyện lại với 3 seed và chọn theo F1 validation. Hình: F1 validation tăng đơn điệu theo learning rate và số epoch. Với lr 5e-6 và 4 epoch, PhoBERT chỉ đạt 36,65%: underfitting. Cấu hình tốt nhất nằm ở biên lưới. Lưu ý: số trong hình dùng cách chấm của notebook gốc nên thấp hơn các bảng sau khoảng 1–2 điểm. Thời gian: 1 phút.');
}

// ============================================================ 8. Kết quả tổng thể
{
  const s = base('Kết quả tổng thể (seqeval strict, micro F1 %)');
  table(s, ['Mô hình', 'Train F1', 'Val F1', 'Test P', 'Test R', 'Test F1', 'CI95 test F1'],
    ORDER.map((m) => [m, pct(M[m].train_f1), pct(M[m].val_f1), pct(M[m].test_precision), pct(M[m].test_recall), pct(M[m].test_f1),
      `${pct(M[m].test_f1_ci95[0], 1)}–${pct(M[m].test_f1_ci95[1], 1)}`]),
    { x: 0.6, y: 1.2, w: 7.1, colW: [1.9, 0.85, 0.85, 0.85, 0.85, 0.85, 0.95], size: 12.5, highlight: 2, rowH: 0.38 });
  s.addChart(pres.charts.BAR, [['train_f1', 'train'], ['val_f1', 'validation'], ['test_f1', 'test']].map(([k, n]) => ({ name: n, labels: ORDER.map((m) => m.replace('Logistic Regression', 'LogReg')), values: ORDER.map((m) => +(M[m][k] * 100).toFixed(1)) })), {
    ...chartBase, x: 7.95, y: 1.15, w: 4.85, h: 3.6, barDir: 'col', barGrouping: 'clustered', chartColors: SERIES, title: 'F1 trên train / validation / test', catAxisLabelFontSize: 9, valAxisMaxVal: 100, valAxisMinVal: 0,
  });
  card(s, 0.6, 4.1, 7.1, 2.75);
  bullets(s, [`**CRF** cao nhất trên test: **${pct(M.CRF.test_f1)}%**; ViHealthBERT ${pct(M.ViHealthBERT.test_f1)}%, PhoBERT ${pct(M.PhoBERT.test_f1)}%`,
    `PhoBERT, ViHealthBERT: recall cao (${pct(M.PhoBERT.test_recall, 1)}–${pct(M.ViHealthBERT.test_recall, 1)}%) nhưng precision thấp ⇒ **đoán dư**`,
    `CRF là mô hình duy nhất có **P > R** (${pct(M.CRF.test_precision, 1)}% so với ${pct(M.CRF.test_recall, 1)}%)`,
    'Mọi mô hình tụt **21–27 điểm** từ validation sang test'], 0.85, 4.28, 6.65, 2.45, 15);
  card(s, 7.95, 4.95, 4.85, 1.9, C.tealTint);
  s.addText('Cùng một thước đo cho cả 6 mô hình: F1 mức thực thể, khớp chính xác cả ranh giới lẫn loại. CI95 tính bằng paired bootstrap 2.000 lần trên 3.497 câu test.',
    { x: 8.15, y: 5.08, w: 4.45, h: 1.65, fontFace: BODY, fontSize: 13, color: C.ink, margin: 0, valign: 'middle', isTextBox: true });
  s.addNotes('Tất cả được chấm cùng một thước đo: F1 mức thực thể, seqeval strict, khớp chính xác cả ranh giới lẫn loại. Mô hình tốt nhất trên test là CRF với F1 63,80%. ViHealthBERT 62,74% và PhoBERT 62,42% đứng ngay sau. Linear SVM 58,10%, Logistic Regression 56,23%, XLM-R 58,62%. PhoBERT và ViHealthBERT có recall cao, khoảng 69,4–71,0%, nhưng precision thấp, khoảng 56,2–56,7%, tức đoán dư thực thể. CRF là mô hình duy nhất có precision cao hơn recall, 65,8% so với 61,9%: nó chỉ gán nhãn khi gặp mẫu quen thuộc. Macro F1 thấp hơn micro F1 khoảng 5–11 điểm vì các lớp hiếm có F1 gần 0. Biểu đồ: khoảng cách giữa validation và test lớn hơn nhiều so với giữa train và validation. Thời gian: 1 phút 30 giây.');
}

// ============================================================ 9. Bootstrap
{
  const s = base('Chênh lệch có ý nghĩa thống kê không?');
  s.addText('Paired bootstrap trên 3.497 câu test, 2.000 lần lấy mẫu lại, cùng mẫu cho mọi mô hình.', { x: 0.6, y: 1.15, w: 12, h: 0.4, fontFace: BODY, fontSize: 15, italic: true, color: C.muted, margin: 0, isTextBox: true });
  const rows = Object.entries(MC.pairs).map(([k, v]) => {
    const yes = v.ci95[0] > 0 || v.ci95[1] < 0;
    return [k.replace(' - ', ' − '), sgn(v.delta), `[${sgn(v.ci95[0])}; ${sgn(v.ci95[1])}]`, yes ? 'có ý nghĩa' : 'không có ý nghĩa'];
  });
  const noIdx = rows.findIndex((r) => r[3] === 'không có ý nghĩa');
  table(s, ['So sánh (A − B)', 'Chênh lệch F1 (điểm)', 'CI95', 'Kết luận'], rows, { x: 0.6, y: 1.75, w: 12.13, colW: [4.2, 2.4, 2.9, 2.63], size: 15, highlight: noIdx, rowH: 0.48 });
  const p = MC.pairs;
  [['Lợi thế nhỏ', `CRF hơn ViHealthBERT ${pct(p['CRF - ViHealthBERT'].delta)} điểm; CI95 nằm trên 0 nhưng cận dưới rất sát 0`, C.teal],
    ['Ngang nhau', 'ViHealthBERT và PhoBERT: CI95 chứa 0 ⇒ không phân biệt được', C.gold],
    ['Giá trị của mô hình chuỗi', `CRF so với Linear SVM (cùng đặc trưng): ${sgn(p['CRF - Linear SVM'].delta)} điểm`, C.coral]].forEach(([h, t, col], i) => {
    const x = 0.6 + i * 4.1;
    card(s, x, 5.35, 3.93, 1.55);
    s.addText(h, { x: x + 0.2, y: 5.45, w: 3.55, h: 0.4, fontFace: HEAD, fontSize: 16, bold: true, color: col, margin: 0, isTextBox: true });
    s.addText(t, { x: x + 0.2, y: 5.87, w: 3.55, h: 0.95, fontFace: BODY, fontSize: 13, color: C.ink, margin: 0, valign: 'top', isTextBox: true });
  });
  s.addNotes('Để biết chênh lệch có thật hay do ngẫu nhiên, nhóm dùng paired bootstrap: lấy mẫu lại 3.497 câu test 2.000 lần, dùng cùng các mẫu cho mọi mô hình, rồi lấy khoảng 2,5–97,5% của hiệu F1. CRF hơn ViHealthBERT 1,05 điểm; khoảng tin cậy +0,08 đến +2,05 nằm trên 0 nhưng cận dưới rất sát 0, nên đây là lợi thế nhỏ. ViHealthBERT và PhoBERT không có ý nghĩa thống kê, khoảng tin cậy −0,41 đến +1,04 chứa 0, tức hai mô hình ngang nhau. Việc thêm quan hệ giữa các nhãn liền kề, tức CRF so với Linear SVM dùng cùng đặc trưng, mang lại 5,70 điểm và có ý nghĩa thống kê. Thời gian: 1 phút.');
}

// ============================================================ 10. Train vs validation
{
  const s = base('Train và validation: overfitting hay underfitting?');
  const H = CURVE.history;
  s.addChart(pres.charts.LINE, [{ name: 'train', labels: H.map((h) => `Epoch ${h.epoch}`), values: H.map((h) => +(h.train_f1 * 100).toFixed(1)) },
    { name: 'validation', labels: H.map((h) => `Epoch ${h.epoch}`), values: H.map((h) => +(h.validation_f1 * 100).toFixed(1)) }], {
    ...chartBase, x: 0.5, y: 1.15, w: 6.15, h: 3.35, chartColors: SERIES.slice(0, 2), title: 'ViHealthBERT: F1 (%) theo epoch', lineSize: 2.5, lineDataSymbolSize: 7, valAxisMinVal: 50, valAxisMaxVal: 100,
  });
  const cc = MC.crf_learning_curve;
  s.addChart(pres.charts.LINE, [['train_f1', 'train'], ['validation_f1', 'validation'], ['test_f1', 'test']].map(([k, n]) => ({ name: n, labels: cc.map((c) => `${int(c.sentences)} câu`), values: cc.map((c) => +(c[k] * 100).toFixed(1)) })), {
    ...chartBase, x: 6.7, y: 1.15, w: 6.1, h: 3.35, chartColors: SERIES, title: 'CRF: F1 (%) theo kích thước tập train', lineSize: 2.5, lineDataSymbolSize: 7, valAxisMinVal: 30, valAxisMaxVal: 100,
  });
  const last = H[H.length - 1];
  card(s, 0.6, 4.7, 6.0, 2.2);
  heading(s, 'ViHealthBERT theo epoch', 0.85, 4.83, 5.5);
  bullets(s, [`Epoch 1: train ${pct(H[0].train_f1, 1)}%, val ${pct(H[0].validation_f1, 1)}% ⇒ **underfitting**`,
    `Từ epoch 5: train tiếp tục tăng, val loss đi ngang, val F1 dừng ở ${pct(H[4].validation_f1, 1)}–${pct(Math.max(...H.map((h) => h.validation_f1)), 1)}%`,
    `Epoch 8: train ${pct(last.train_f1)}% vs val ${pct(last.validation_f1)}% ⇒ **overfitting vừa phải**`], 0.85, 5.3, 5.55, 1.55, 14);
  card(s, 6.75, 4.7, 6.0, 2.2);
  heading(s, 'CRF và tổng hợp', 7.0, 4.83, 5.5);
  bullets(s, [`CRF: train F1 ≈ 100% ở mọi kích thước ⇒ **ghi nhớ**; test chưa bão hoà (${pct(cc[0].test_f1, 1)}% → ${pct(cc[cc.length - 1].test_f1, 1)}%)`,
    'Train → val: 9,6–16,2 điểm; **val → test: 21–27 điểm**', '⇒ **Lệch miền** mới là nguyên nhân chính làm giảm điểm test'], 7.0, 5.3, 5.55, 1.55, 14);
  s.addNotes('Để có đường cong học theo epoch, nhóm huấn luyện lại ViHealthBERT với cấu hình đã chọn và sau mỗi epoch chấm lại loss và F1 trên toàn bộ train và validation. Ở epoch 1, train F1 60,0% và validation F1 58,5% đều thấp: underfitting. Từ epoch 2 đến 5, hai đường cùng tăng nhanh. Từ epoch 5, train loss tiếp tục giảm từ 0,056 xuống 0,032, train F1 lên 96,81%, trong khi validation loss đi ngang quanh 0,178 và validation F1 dừng ở khoảng 84,4–85,2%. Khoảng cách 11,7 điểm ở epoch cuối là overfitting ở mức vừa phải. Bản huấn luyện lại đạt F1 test 62,15%, gần checkpoint gốc 62,74%, tức kết quả tái lập được. CRF: train F1 gần 100% ở mọi kích thước tập train, tức ghi nhớ gần như toàn bộ dữ liệu. Validation F1 tăng từ 70,3% lên 89,2%, test F1 tăng từ 41,1% lên 63,8% và chưa bão hoà. Tổng hợp: khoảng cách train–validation của các mô hình được huấn luyện là 9,6–16,2 điểm, còn khoảng cách validation–test 21–27 điểm lớn hơn, nên lệch miền mới là nguyên nhân chính, không phải overfitting. Thời gian: 1 phút 30 giây.');
}

// ============================================================ 11. Confusion matrix
{
  const s = base('Confusion matrix: mô hình hay nhầm lớp nào?');
  image(s, 'fig_confusion_vihealthbert.png', 0.5, 1.1, 6.95);
  card(s, 7.7, 1.2, 5.05, 2.55);
  heading(s, 'Cặp hay nhầm (ViHealthBERT, test)', 7.95, 1.33, 4.6);
  bullets(s, ['"tiêu xương" → "xương": **DISEASESYMTOM → ORGAN** (24 lần)', '"implant": **SURGERY → MEDDEVICETECHNIQUE** (40 lần)',
    '"chính phủ": **ORGANIZATION → LOCATION** (9 lần)', 'MEDDEVICETECHNIQUE: chỉ ~1/3 token đoán đúng'], 7.95, 1.8, 4.65, 1.9, 13.5);
  const so = (m) => M[m].span_outcomes;
  table(s, ['Mức thực thể', 'Khớp', 'Lệch biên', 'Sai loại', 'Bỏ sót', 'Thừa'],
    ORDER.map((m) => [m.replace('Logistic Regression', 'LogReg'), int(so(m).exact), int(so(m).boundary), int(so(m).wrong_type), int(so(m).missed), int(so(m).spurious)]),
    { x: 7.7, y: 3.95, w: 5.05, colW: [1.35, 0.75, 0.8, 0.75, 0.7, 0.7], size: 11.5, rowH: 0.33 });
  s.addText(`Lỗi chủ yếu là lệch ranh giới và đoán thừa, không phải sai loại. Test có ${int(EDA.test.entity_total)} thực thể.`, { x: 7.7, y: 6.35, w: 5.05, h: 0.55, fontFace: BODY, fontSize: 12, italic: true, color: C.muted, margin: 0, valign: 'top', isTextBox: true });
  s.addNotes('Đây là confusion matrix mức token của ViHealthBERT trên test, chuẩn hoá theo hàng; báo cáo có đủ confusion matrix cho cả sáu mô hình. Các cặp hay bị nhầm: DISEASESYMTOM bị cắt thành ORGAN, ví dụ "tiêu xương" thành "xương" 24 lần, "ra máu" thành "máu" 11 lần: mô hình nhận ra tên cơ quan nhưng bỏ phần mô tả bệnh. SURGERY bị đoán thành MEDDEVICETECHNIQUE: "implant" 40 lần, "cấy que tránh thai" 14 lần. MEDDEVICETECHNIQUE chỉ khoảng một phần ba token được đoán đúng. ORGANIZATION bị đoán thành LOCATION: "chính phủ" 9 lần. Bảng bên phải: ở mọi mô hình, phần lớn lỗi là lệch ranh giới và đoán thừa. Hai mô hình phân loại từng token có nhiều lỗi lệch ranh giới nhất; CRF bỏ sót nhiều nhất nhưng đoán thừa ít nhất. Thời gian: 1 phút.');
}

// ============================================================ 12. Seen vs unseen
{
  const s = base('Phân tích lỗi: thực thể đã gặp và chưa gặp');
  s.addChart(pres.charts.BAR, [['recall_seen', 'Đã gặp trong train'], ['recall_unseen', 'Chưa gặp trong train']].map(([k, n]) => ({ name: n, labels: ORDER.map((m) => m.replace('Logistic Regression', 'LogReg')), values: ORDER.map((m) => +(M[m][k] * 100).toFixed(1)) })), {
    ...chartBase, x: 0.5, y: 1.15, w: 7.2, h: 4.3, barDir: 'col', barGrouping: 'clustered', chartColors: ['4C72B0', C.coral], title: 'Recall trên test (%)', showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 9, valAxisMaxVal: 100, valAxisMinVal: 0,
  });
  kpi(s, `${pct(M.CRF.recall_seen, 1)}% | ${pct(M.CRF.recall_unseen, 1)}%`, 'CRF: recall đã gặp | chưa gặp', 7.95, 1.2, 4.8, 1.3, C.coral);
  kpi(s, `${pct(M.ViHealthBERT.recall_seen, 1)}% | ${pct(M.ViHealthBERT.recall_unseen, 1)}%`, 'ViHealthBERT: đã gặp | chưa gặp', 7.95, 2.7, 4.8, 1.3, C.teal);
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 7.95, y: 4.2, w: 4.8, h: 2.7, fill: { color: C.white }, line: { color: C.line, width: 1 }, rectRadius: 0.08 });
  s.addText([
    { text: 'Ví dụ (thực thể chưa gặp)', options: { bold: true, color: C.navy, fontFace: HEAD, fontSize: 15, breakLine: true } },
    { text: '"rong huyết như vậy mình sẽ phân biệt với rong kinh và rong huyết"', options: { italic: true, fontSize: 13.5, color: C.ink, breakLine: true } },
    { text: '✓ ViHealthBERT: đúng cả 3 thực thể', options: { fontSize: 13.5, color: C.teal, bold: true, breakLine: true } },
    { text: '✗ CRF: "huyết" → ORGAN (×2)', options: { fontSize: 13.5, color: C.coral, bold: true } },
  ], { x: 8.2, y: 4.35, w: 4.35, h: 2.45, fontFace: BODY, margin: 0, valign: 'top', paraSpaceAfter: 8, isTextBox: true });
  card(s, 0.6, 5.65, 7.1, 1.25, C.tealTint);
  s.addText('Test có 5.782 thực thể đã gặp và 2.556 chưa gặp. Mô hình cổ điển ghi nhớ từ vựng; Transformer dùng biểu diễn học từ pretraining nên suy ra được thực thể mới (ViHealthBERT ≈ 3 lần CRF).',
    { x: 0.8, y: 5.72, w: 6.75, h: 1.1, fontFace: BODY, fontSize: 13.5, color: C.ink, margin: 0, valign: 'middle', isTextBox: true });
  s.addNotes('Với dữ liệu ảnh, độ khó của mẫu có thể là ảnh mờ hay rõ. Với văn bản, yếu tố tương đương là thực thể đã gặp trong train hay chưa. Với thực thể đã gặp, các mô hình khá gần nhau, khoảng 77–87%, Linear SVM thậm chí cao nhất. Với thực thể chưa gặp, khác biệt rất lớn: ba mô hình cổ điển chỉ nhận ra 4,9–13,9%, còn ViHealthBERT nhận ra 41,9%. CRF: 83,2% với thực thể đã gặp nhưng chỉ 13,9% với thực thể chưa gặp; ViHealthBERT: 83,9% và 41,9%, gấp khoảng 3 lần CRF. Ví dụ thật trên test: "rong huyết như vậy mình sẽ phân biệt với rong kinh và rong huyết". ViHealthBERT đúng cả 3 thực thể; CRF chỉ nhận "huyết" thành ORGAN, hai lần. Vì 69% thực thể trong test đã gặp ở train, lợi thế ghi nhớ đủ để CRF dẫn đầu về F1 tổng. Thời gian: 1 phút.');
}

// ============================================================ 13. Why
{
  const s = base('Vì sao mô hình này tốt hơn mô hình kia?');
  const invalid = (m) => PRED[m].reduce((acc, row) => { let prev = 'O'; row.forEach((t) => { if (t.startsWith('I-') && !(prev !== 'O' && prev.slice(2) === t.slice(2))) acc += 1; prev = t; }); return acc; }, 0);
  const tr = ['XLM-R', 'PhoBERT', 'ViHealthBERT'].map(invalid);
  const cols = [
    ['Từng token vs mô hình chuỗi', C.navy],
    ['CRF: ghi nhớ thuật ngữ', C.coral],
    ['ViHealthBERT: tổng quát hoá', C.teal],
  ];
  cols.forEach(([h, col], i) => {
    const x = 0.6 + i * 4.1;
    card(s, x, 1.2, 3.93, 4.4);
    heading(s, h, x + 0.2, 1.33, 3.55, col);
  });
  table(s, ['Chuyển nhãn BIO sai (test)', 'Số lần'], [['Logistic Regression', int(invalid('Logistic Regression'))], ['Linear SVM', int(invalid('Linear SVM'))], ['CRF', int(invalid('CRF'))], ['Transformer', `${int(Math.min(...tr))}–${int(Math.max(...tr))}`]],
    { x: 0.8, y: 1.85, w: 3.53, colW: [2.5, 1.03], size: 12, highlight: 2, rowH: 0.34 });
  bullets(s, [`Cùng đặc trưng, CRF hơn LogReg **${pct(M.CRF.test_f1 - M['Logistic Regression'].test_f1, 1)}** và SVM **${pct(M.CRF.test_f1 - M['Linear SVM'].test_f1, 1)}** điểm`,
    `Lệch biên: CRF ${int(M.CRF.span_outcomes.boundary)} vs LogReg ${int(M['Logistic Regression'].span_outcomes.boundary)}`], 0.8, 3.75, 3.55, 1.75, 13.5);
  bullets(s, ['Đặc trưng từ vựng nhớ chính xác thuật ngữ y khoa', '**69%** thực thể test đã gặp ở train ⇒ thắng F1 tổng', `Precision cao nhất (${pct(M.CRF.test_precision)}%), ít đoán thừa`,
    `Nhược điểm: train F1 ≈ 100%, chỉ nhận ra **${pct(M.CRF.recall_unseen, 1)}%** thực thể mới`], 4.9, 1.85, 3.55, 3.65, 16);
  bullets(s, ['Pretrain thêm trên **văn bản y tế**', `Nhận ra **${pct(M.ViHealthBERT.recall_unseen, 1)}%** thực thể mới, gấp ≈ 3 lần CRF`, 'Ngang PhoBERT về F1 tổng, tốt hơn ở lớp y khoa',
    'XLM-R kém nhất nhóm Transformer dù nhiều tham số nhất (277M)'], 9.0, 1.85, 3.55, 3.65, 16);
  card(s, 0.6, 5.85, 12.13, 1.05, C.tealTint);
  s.addText([{ text: 'Chọn theo dữ liệu: ', options: { bold: true } }, { text: 'thuật ngữ lặp lại như train → CRF (rẻ, chính xác nhất theo strict). Hội thoại chủ đề bệnh mới như test → ViHealthBERT.' }],
    { x: 0.85, y: 5.9, w: 11.7, h: 0.95, fontFace: BODY, fontSize: 15, color: C.ink, margin: 0, valign: 'middle', isTextBox: true });
  s.addNotes('Phân loại từng token so với mô hình chuỗi: Logistic Regression và Linear SVM dùng cùng đặc trưng với CRF nhưng kém CRF 7,6 và 5,7 điểm F1 test. Chúng dự đoán từng âm tiết độc lập nên tạo nhiều chuỗi nhãn vô lý: trên test, Logistic Regression sinh 1.127 và Linear SVM 1.175 lần chuyển nhãn không hợp lệ; CRF chỉ có 9 lần, các Transformer 595–778 lần. CRF học xác suất chuyển giữa nhãn liền kề nên ranh giới chính xác hơn. CRF thắng trên test nhờ đặc trưng từ vựng giúp nhớ chính xác thuật ngữ y khoa, và 69% thực thể test đã xuất hiện trong train; nhược điểm là overfit mạnh và chỉ nhận ra 13,9% thực thể mới. ViHealthBERT tổng quát hoá tốt nhất: 41,9% thực thể mới, gấp khoảng 3 lần CRF, nhờ pretrain thêm trên văn bản y tế. XLM-R kém nhất trong nhóm Transformer dù nhiều tham số nhất. Kết luận chọn mô hình: dữ liệu lặp lại thuật ngữ đã có thì CRF; hội thoại chủ đề bệnh mới như tập test thì ViHealthBERT. Thời gian: 1 phút.');
}

// ============================================================ 14. Strict vs SLUE
{
  const s = base('Đối chiếu bài báo gốc: strict và SLUE');
  const paper = { 'XLM-R': '69 (P 64 / R 73)', PhoBERT: '74' };
  table(s, ['Mô hình', 'F1 strict (%)', 'F1 kiểu SLUE (%)', 'Bài báo công bố'], ORDER.map((m) => [m, pct(M[m].test_f1), pct(M[m].test_slue_f1), paper[m] || '—']),
    { x: 0.6, y: 1.25, w: 7.3, colW: [2.2, 1.55, 1.75, 1.8], size: 14, highlight: 5, rowH: 0.46 });
  card(s, 8.2, 1.25, 4.55, 4.35);
  heading(s, 'Khác thước đo', 8.45, 1.4, 4.1);
  bullets(s, ['**Strict:** khớp chính xác cả ranh giới lẫn loại', '**SLUE:** so khớp tập (loại, âm tiết), không xét ranh giới ⇒ dễ hơn',
    `Cùng checkpoint XLM-R: SLUE **${pct(M['XLM-R'].test_slue_f1)}%** ≈ 69% bài báo`, '**Thứ hạng đảo:** SLUE ⇒ ViHealthBERT đầu, CRF đứng sau các Transformer'], 8.45, 1.9, 4.1, 3.6, 14.5);
  card(s, 0.6, 5.85, 12.13, 1.05, C.coralTint);
  s.addText([{ text: 'Nhóm chọn strict làm thước đo chính ', options: { bold: true } }, { text: 'vì ứng dụng cần trích xuất đúng cả cụm thực thể để ghi vào hồ sơ.' }],
    { x: 0.85, y: 5.9, w: 11.7, h: 0.95, fontFace: BODY, fontSize: 15, color: C.ink, margin: 0, valign: 'middle', isTextBox: true });
  s.addNotes('Bài báo VietMed-NER báo XLM-R base đạt F1 0,69 và PhoBERT-base-v2 đạt 0,74 trên test, cao hơn nhiều so với số của nhóm. Nguyên nhân là khác thước đo: bài báo dùng F1 kiểu SLUE, so khớp tập hợp các cặp loại và âm tiết mà không xét ranh giới thực thể. Thước đo này dễ hơn seqeval strict. Chấm lại cùng các dự đoán bằng SLUE: với cùng checkpoint XLM-R của tác giả, nhóm được 68,53%, khớp với 69% của bài báo. Như vậy phần lớn khoảng cách đến từ thước đo. PhoBERT vẫn thấp hơn bài báo khoảng 3 điểm, có thể do bài báo dùng input đã tách từ và huấn luyện 50 epoch với batch 64. Theo SLUE, ViHealthBERT đứng đầu với 71,82% và CRF đứng sau các Transformer, vì Transformer nhận ra nhiều âm tiết thuộc thực thể hơn dù ranh giới chưa chính xác. Nhóm chọn strict vì ứng dụng cần trích xuất đúng cả cụm. Thời gian: 1 phút.');
}

// ============================================================ 15. Conclusion
{
  const s = base('Kết luận và hướng phát triển');
  card(s, 0.6, 1.2, 4.05, 5.7);
  heading(s, 'Kết luận', 0.85, 1.35, 3.6, C.navy);
  bullets(s, ['Val (cùng miền) ≈ 83–89% F1; test (khác miền) chỉ 56–64%', `**CRF** tốt nhất theo strict (${pct(M.CRF.test_f1)}%), lợi thế nhỏ nhưng có ý nghĩa`,
    'Mô hình chuỗi vượt rõ mô hình từng token', '**ViHealthBERT** ≈ PhoBERT, tổng quát hoá tốt nhất', 'Nút thắt ở dữ liệu: lệch miền, mất cân bằng, ranh giới nhãn mơ hồ'], 0.85, 1.85, 3.65, 4.9, 17);
  card(s, 4.85, 1.2, 4.05, 5.7);
  heading(s, 'Hướng phát triển', 5.1, 1.35, 3.6, C.teal);
  bullets(s, ['**BERT-CRF**: ngữ nghĩa + ràng buộc chuyển nhãn', 'Trọng số lớp / oversampling cho lớp hiếm', 'Mở rộng lưới (lr 5e-5, 10 epoch)', 'Tách từ VnCoreNLP cho PhoBERT',
    'Dữ liệu cùng miền test, từ điển thuật ngữ y khoa', 'Chỉ **gợi ý** sửa transcript để người dùng duyệt'], 5.1, 1.85, 3.65, 4.9, 17);
  const h = image(s, 'fig_lora_overfitting.png', 9.1, 1.25, 3.65);
  s.addText('Mở rộng ASR: LoRA sửa lỗi transcript — train loss giảm (≈ 0,98 → 0,54) nhưng dev WER tăng (seed 42: 5,36% → 6,06%) ⇒ overfitting, early stopping chọn epoch 1.',
    { x: 9.1, y: 1.35 + h, w: 3.65, h: 2.0, fontFace: BODY, fontSize: 12, italic: true, color: C.muted, margin: 0, valign: 'top', isTextBox: true });
  s.addNotes('Kết luận: trên validation cùng miền, năm mô hình do nhóm huấn luyện đạt F1 khoảng 83–89%; trên test khác miền chỉ đạt 56–64%. Theo strict, CRF là mô hình tốt nhất trên test với F1 63,80%, lợi thế nhỏ nhưng có ý nghĩa thống kê so với ViHealthBERT. Mô hình chuỗi CRF vượt rõ mô hình phân loại từng token dùng cùng đặc trưng. ViHealthBERT và PhoBERT ngang nhau, và ViHealthBERT tổng quát hoá sang thực thể mới tốt nhất. Nút thắt chính nằm ở dữ liệu: lệch miền, mất cân bằng lớp và ranh giới nhãn mơ hồ. Hướng phát triển: BERT-CRF; trọng số lớp hoặc oversampling; mở rộng lưới siêu tham số; tách từ VnCoreNLP cho PhoBERT; bổ sung dữ liệu cùng miền test hoặc từ điển thuật ngữ y khoa. Phần mở rộng pipeline âm thanh: với LoRA sửa lỗi transcript, train loss giảm đều qua 3 epoch trong khi WER dev tăng, nên early stopping chọn epoch 1: một ví dụ overfitting điển hình. Vì mô hình sửa nhầm 17–22% câu vốn đã đúng, chỉ nên gợi ý để người dùng duyệt, không áp dụng tự động. Thời gian: 1 phút.');
}

// ============================================================ 16. Thanks
{
  const s = pres.addSlide();
  slideNo += 1;
  s.background = { color: C.navy };
  s.addText('Cảm ơn Thầy và Anh Chị đã lắng nghe!', { x: 0.8, y: 2.6, w: W - 1.6, h: 1.3, fontFace: HEAD, fontSize: 42, bold: true, color: C.white, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
  s.addText('Hỏi & đáp', { x: 0.8, y: 4.0, w: W - 1.6, h: 0.6, fontFace: BODY, fontSize: 22, color: '9FD8CF', align: 'center', margin: 0, isTextBox: true });
  s.addNotes('Cảm ơn Thầy và các bạn đã lắng nghe. Nhóm sẵn sàng trả lời câu hỏi. Thời gian: 15 giây.');
}

// pptxgenjs emits one <a:pPr> per run; keep only the first per paragraph so multi-run bullet items keep their bullet.
const JSZip = require('jszip');
pres.write({ outputType: 'nodebuffer' }).then(async (buf) => {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  for (const f of slides) {
    const xml = await zip.file(f).async('string');
    const fixed = xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (para, inner) => {
      let seen = false;
      return `<a:p>${inner.replace(/<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g, (m) => (seen ? '' : ((seen = true), m)))}</a:p>`;
    });
    zip.file(f, fixed);
  }
  fs.writeFileSync(OUT, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log('wrote', OUT, slideNo, 'slides');
});
