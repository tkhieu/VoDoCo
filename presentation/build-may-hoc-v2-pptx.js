// Builds presentation/may-hoc-v2.pptx: the 6-model "ladder" story (Máy học — VietMed-NER).
// Numbers come from do_an_may_hoc/results (notebook outputs + ladder_steps.json from compute_ladder_steps.py).
// Usage: node build-may-hoc-v2-pptx.js <repo root>   (requires: npm install pptxgenjs jszip)
const fs = require('fs');
const path = require('path');
const pptxgen = require('pptxgenjs');
const JSZip = require('jszip');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const RES = path.join(ROOT, 'do_an_may_hoc/results');
const FIG = path.join(ROOT, 'presentation/assets/images/ml');
const LOGO = path.join(ROOT, 'presentation/assets/images/uit_logo.png');
const OUT = path.join(ROOT, 'presentation/may-hoc-v2.pptx');
const J = (f) => JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8'));
const MC = J('model_comparison.json');
const M = MC.models;
const EDA = J('eda.json');
const DQ = J('data_quality.json');
const CURVE = J('vihealthbert_epoch_curve.json');
const PRED = J('test_predictions.json');
const STEPS = J('ladder_steps.json').steps;
const ORDER = ['Logistic Regression', 'Linear SVM', 'CRF', 'XLM-R', 'PhoBERT', 'ViHealthBERT'];
const SHORT = { 'Logistic Regression': 'LogReg', 'Linear SVM': 'Linear SVM', CRF: 'CRF', 'XLM-R': 'XLM-R', PhoBERT: 'PhoBERT', ViHealthBERT: 'ViHealthBERT' };
const TOTAL = 18;

// ---------- formatting
const pct = (x, d = 2) => (x * 100).toFixed(d).replace('.', ',');
const int = (x) => Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const sgn = (x, d = 2) => `${x >= 0 ? '+' : '−'}${pct(Math.abs(x), d)}`;
const num = (x) => String(x).replace('.', ',');
const invalidBio = (m) => PRED[m].reduce((acc, row) => {
  let prev = 'O';
  row.forEach((t) => { if (t.startsWith('I-') && !(prev !== 'O' && prev.slice(2) === t.slice(2))) acc += 1; prev = t; });
  return acc;
}, 0);
const INV = Object.fromEntries(ORDER.map((m) => [m, invalidBio(m)]));

// ---------- palette & type
const C = {
  navy: '0F2A3D', navy2: '17384F', ink: '1B2733', muted: '5B6B7A', line: 'D5DEE5', tint: 'EEF4F7', white: 'FFFFFF',
  coral: 'E4572E', coralTint: 'FCE9E3', teal: '2A9D8F', tealTint: 'E3F3F1', gold: 'E9A23B', goldTint: 'FBF1DF', future: 'DDE5EB',
};
const HEAD = 'Cambria';
const BODY = 'Calibri';
const SERIES = ['4C72B0', 'DD8452', '55A868'];
const W = 13.333;

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.title = 'Leo từng bậc: 6 mô hình nhận dạng thực thể y tế';
let slideNo = 0;

// ---------- helpers
function base(title) {
  const s = pres.addSlide();
  slideNo += 1;
  s.background = { color: C.white };
  s.addText(title, { x: 0.6, y: 0.35, w: 8.3, h: 0.75, fontFace: HEAD, fontSize: 28, bold: true, color: C.navy, margin: 0, valign: 'middle', isTextBox: true });
  s.addText(`${slideNo} / ${TOTAL}`, { x: W - 1.6, y: 7.05, w: 1.0, h: 0.3, fontFace: BODY, fontSize: 10, color: C.muted, align: 'right', margin: 0, isTextBox: true });
  return s;
}
function card(s, x, y, w, h, fill = C.tint) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill }, line: { color: fill }, rectRadius: 0.08 });
}
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
function text(s, t, x, y, w, h, o = {}) {
  s.addText(runs(t, { fontSize: o.size || 15, color: o.color || C.ink, fontFace: o.face || BODY, italic: !!o.italic }),
    { x, y, w, h, margin: 0, valign: o.valign || 'top', align: o.align || 'left', isTextBox: true });
}
function heading(s, t, x, y, w, color = C.navy, size = 17) {
  s.addText(t, { x, y, w, h: 0.4, fontFace: HEAD, fontSize: size, bold: true, color, margin: 0, isTextBox: true });
}
function table(s, header, rows, opt) {
  const { x, y, w, colW, size = 12, highlight = -1, rowH = 0.32 } = opt;
  const numeric = header.map((_, i) => i > 0 && rows.every((r) => /^[\d.,%–\-−+[\]; ()P/R|—]+$/.test(String(r[i]).replace(/\s/g, ''))));
  const head = header.map((t, i) => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.navy }, align: numeric[i] ? 'right' : 'left' } }));
  const body = rows.map((r, ri) => r.map((t, i) => ({ text: String(t), options: {
    align: numeric[i] ? 'right' : 'left', bold: ri === highlight, color: C.ink,
    fill: { color: ri === highlight ? C.coralTint : (ri % 2 ? C.white : 'F7FAFB') } } })));
  s.addTable([head, ...body], { x, y, w, colW, fontFace: BODY, fontSize: size, rowH, border: { type: 'solid', pt: 0.5, color: C.line }, margin: [2, 5, 2, 5] });
}
function image(s, file, x, y, w, maxH) {
  const buf = fs.readFileSync(path.join(FIG, file));
  let h = w * buf.readUInt32BE(20) / buf.readUInt32BE(16);
  let ww = w;
  if (maxH && h > maxH) { ww = w * maxH / h; h = maxH; }
  s.addImage({ path: path.join(FIG, file), x: x + (w - ww) / 2, y, w: ww, h, altText: file });
  return h;
}
function kpi(s, big, label, x, y, w, h, color, fill = C.tint) {
  card(s, x, y, w, h, fill);
  s.addText(big, { x: x + 0.18, y: y + 0.08, w: w - 0.36, h: h * 0.55, fontFace: HEAD, fontSize: 26, bold: true, color, margin: 0, valign: 'middle', isTextBox: true });
  s.addText(label, { x: x + 0.18, y: y + h * 0.62, w: w - 0.36, h: h * 0.34, fontFace: BODY, fontSize: 11.5, color: C.muted, margin: 0, valign: 'top', isTextBox: true });
}
const chartBase = {
  fontFace: BODY, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, catAxisLabelColor: C.muted, valAxisLabelColor: C.muted,
  valGridLine: { color: 'E6ECF0', size: 0.5 }, catGridLine: { style: 'none' }, showLegend: true, legendPos: 'b', legendFontSize: 10.5,
  titleFontSize: 13, titleColor: C.navy, showTitle: true,
};

// Staircase motif: 6 ascending steps, current one coral, climbed ones teal, future ones grey.
function stairs(s, current, x0 = 9.15, y0 = 0.3, stepW = 0.6, gap = 0.04, maxH = 0.85) {
  ORDER.forEach((m, i) => {
    const h = 0.2 + (maxH - 0.2) * (i / 5);
    const x = x0 + i * (stepW + gap);
    const fill = i + 1 === current ? C.coral : (i + 1 < current ? C.teal : C.future);
    s.addShape(pres.shapes.RECTANGLE, { x, y: y0 + maxH - h, w: stepW, h, fill: { color: fill }, line: { color: fill } });
    s.addText(String(i + 1), { x, y: y0 + maxH - h, w: stepW, h: Math.min(h, 0.32), fontFace: BODY, fontSize: 10, bold: true, color: i + 1 <= current ? C.white : C.muted, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
  });
}

// One ladder step
function stepSlide(k, cfg) {
  const m = ORDER[k - 1];
  const s = base(`Bậc ${k}: ${cfg.title}`);
  stairs(s, k);
  const step = STEPS[k - 2];
  card(s, 0.6, 1.3, 12.15, 0.62, C.goldTint);
  text(s, `**Thay đổi so với bậc trước:** ${cfg.change}`, 0.8, 1.3, 11.8, 0.62, { size: 15, valign: 'middle' });
  const tiles = [
    [pct(M[m].val_f1, 1) + '%', 'F1 validation (cùng miền)', C.navy],
    [pct(M[m].test_f1, 1) + '%', `F1 test · CI95 ${pct(M[m].test_f1_ci95[0], 1)}–${pct(M[m].test_f1_ci95[1], 1)}`, C.navy],
    step ? [sgn(step.delta, 2), `so với ${SHORT[step.from]} · CI95 [${sgn(step.ci95[0], 1)}; ${sgn(step.ci95[1], 1)}]`, step.ci95[0] > 0 ? C.teal : (step.ci95[1] < 0 ? C.coral : C.gold)]
      : ['—', 'Bậc đầu tiên (mốc so sánh)', C.muted],
    [pct(M[m].recall_unseen, 1) + '%', 'Recall thực thể chưa gặp trong train', C.coral],
  ];
  tiles.forEach(([big, label, col], i) => kpi(s, big, label, 0.6 + (i % 2) * 2.85, 2.1 + Math.floor(i / 2) * 1.42, 2.7, 1.28, col));
  cfg.visual(s, 6.45, 2.05, 6.3, 2.85);
  card(s, 0.6, 5.1, 5.95, 1.8, C.tealTint);
  heading(s, 'Học được', 0.82, 5.2, 5.5, C.teal, 16);
  bullets(s, cfg.learned, 0.82, 5.6, 5.55, 1.25, 13.5);
  card(s, 6.8, 5.1, 5.95, 1.8, C.coralTint);
  heading(s, k < 6 ? `Còn thiếu → lý do lên bậc ${k + 1}` : 'Còn thiếu → bậc tiếp theo', 7.02, 5.2, 5.5, C.coral, 16);
  bullets(s, cfg.missing, 7.02, 5.6, 5.55, 1.25, 13.5);
  s.addNotes(cfg.notes);
}

// ============================================================ 1. Title
{
  const s = pres.addSlide();
  slideNo += 1;
  s.background = { color: C.navy };
  card(s, 0.7, 0.55, 0.95, 0.95, C.white);
  s.addImage({ path: LOGO, x: 0.75, y: 0.6, w: 0.85, h: 0.85, altText: 'Logo UIT' });
  s.addText('TRƯỜNG ĐẠI HỌC CÔNG NGHỆ THÔNG TIN\nĐẠI HỌC QUỐC GIA TP. HỒ CHÍ MINH', { x: 1.85, y: 0.62, w: 6, h: 0.8, fontFace: BODY, fontSize: 13, bold: true, color: C.white, margin: 0, valign: 'middle', isTextBox: true });
  s.addText('Leo từng bậc:\n6 mô hình NER y tế tiếng Việt', { x: 0.7, y: 1.85, w: 7.5, h: 2.3, fontFace: HEAD, fontSize: 36, bold: true, color: C.white, margin: 0, valign: 'top', isTextBox: true });
  s.addText('Từ Logistic Regression đến ViHealthBERT trên VietMed-NER — mỗi bậc thay đổi đúng một yếu tố', { x: 0.7, y: 4.3, w: 7.2, h: 0.8, fontFace: BODY, fontSize: 18, color: '9FD8CF', margin: 0, valign: 'top', isTextBox: true });
  s.addText([{ text: 'Môn học: Máy học', options: { breakLine: true } }, { text: 'Giảng viên hướng dẫn: Đặng Văn Thìn', options: { breakLine: true } }, { text: 'Nhóm thực hiện: Nhóm 8' }],
    { x: 0.7, y: 5.25, w: 7, h: 1.2, fontFace: BODY, fontSize: 16, color: 'D6E2EA', margin: 0, paraSpaceAfter: 4, isTextBox: true });
  // big staircase
  ORDER.forEach((m, i) => {
    const h = 0.7 + i * 0.72;
    const x = 8.35 + i * 0.78;
    const y = 6.55 - h;
    const fill = i === 5 ? C.coral : (i >= 3 ? C.teal : '2F5A76');
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.72, h, fill: { color: fill }, line: { color: fill } });
    s.addText(SHORT[m], { x: x - 0.02, y: y - 0.5, w: 0.76, h: 0.42, fontFace: BODY, fontSize: 9, bold: true, color: 'D6E2EA', align: 'center', valign: 'bottom', margin: 0, isTextBox: true });
    s.addText(String(i + 1), { x, y: y + 0.05, w: 0.72, h: 0.35, fontFace: HEAD, fontSize: 16, bold: true, color: C.white, align: 'center', margin: 0, isTextBox: true });
  });
  s.addNotes('Kính chào Thầy và các bạn. Nhóm 8 trình bày đồ án môn Máy học: nhận dạng thực thể y tế trong hội thoại tiếng Việt. Thay vì chỉ so sánh điểm số, nhóm kể một câu chuyện: leo lên sáu bậc mô hình, từ Logistic Regression đến ViHealthBERT, mỗi bậc thay đổi đúng một yếu tố để thấy yếu tố đó đóng góp gì. Thời gian: 30 giây.');
}

// ============================================================ 2. Bài toán & dữ liệu
{
  const s = base('Bài toán và bộ dữ liệu');
  stairs(s, 0);
  card(s, 0.6, 1.35, 5.9, 2.35);
  heading(s, 'Gán nhãn chuỗi theo sơ đồ BIO', 0.82, 1.48, 5.5);
  const toks = [['rong', 'B-DISEASE…', 1], ['huyết', 'I-DISEASE…', 1], ['như', 'O', 0], ['vậy', 'O', 0], ['…', 'O', 0], ['rong', 'B-DISEASE…', 1], ['kinh', 'I-DISEASE…', 1]];
  toks.forEach(([w, t, ent], i) => {
    const x = 0.82 + i * 0.79;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 2.0, w: 0.72, h: 0.85, fill: { color: ent ? C.coralTint : C.white }, line: { color: ent ? C.coral : C.line, width: 1 }, rectRadius: 0.06 });
    s.addText(w, { x, y: 2.05, w: 0.72, h: 0.4, fontFace: HEAD, fontSize: 14, bold: true, color: C.ink, align: 'center', margin: 0, isTextBox: true });
    s.addText(t, { x, y: 2.47, w: 0.72, h: 0.3, fontFace: BODY, fontSize: 7, color: ent ? C.coral : C.muted, align: 'center', margin: 0, isTextBox: true });
  });
  text(s, 'Mỗi âm tiết một nhãn: **B-X** mở đầu thực thể loại X, **I-X** nối tiếp, **O** ngoài thực thể. **18 loại → 37 nhãn.** Dữ liệu là **văn bản**.', 0.82, 3.0, 5.5, 0.65, { size: 13.5 });
  table(s, ['Tập', 'Số câu', 'Số token', 'Số thực thể', 'Độ dài TB'], ['train', 'validation', 'test'].map((k) => [k, int(EDA[k].sentences), int(EDA[k].tokens), int(EDA[k].entity_total), num(EDA[k].len_mean.toFixed(1))]),
    { x: 0.6, y: 3.95, w: 5.9, colW: [1.4, 1.1, 1.2, 1.2, 1.0], size: 13, rowH: 0.42 });
  text(s, 'leduckhai/VietMed-NER: transcript hội thoại y tế thật; 2 người gán nhãn độc lập (1 có nền y khoa), 2 người rà soát.', 0.6, 5.8, 5.9, 0.8, { size: 12, italic: true, color: C.muted });
  card(s, 6.85, 1.35, 5.9, 5.3, C.tint);
  heading(s, 'Pipeline và phạm vi đồ án', 7.07, 1.48, 5.5);
  [['AUDIO', 'Hội thoại y tế'], ['ASR', 'Nhận dạng tiếng nói'], ['TEXT', 'Transcript âm tiết'], ['NER', 'Phạm vi đồ án']].forEach(([t, d], i) => {
    const y = 2.0 + i * 1.12;
    const focus = i === 3;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 7.3, y, w: 5.0, h: 0.85, fill: { color: focus ? C.coral : C.white }, line: { color: focus ? C.coral : C.line, width: 1 }, rectRadius: 0.08 });
    s.addText(t, { x: 7.5, y, w: 1.4, h: 0.85, fontFace: HEAD, fontSize: 18, bold: true, color: focus ? C.white : C.navy, valign: 'middle', margin: 0, isTextBox: true });
    s.addText(d, { x: 8.9, y, w: 3.3, h: 0.85, fontFace: BODY, fontSize: 14, color: focus ? C.white : C.muted, valign: 'middle', margin: 0, isTextBox: true });
    if (i < 3) s.addText('↓', { x: 9.6, y: y + 0.82, w: 0.4, h: 0.3, fontSize: 14, color: C.muted, align: 'center', margin: 0, isTextBox: true });
  });
  s.addNotes('Bài toán là nhận dạng thực thể có tên trong transcript hội thoại y tế, một khâu trong hệ thống âm thanh → ASR → văn bản → NER. Mỗi âm tiết được gán một nhãn BIO; có 18 loại thực thể, tức 37 nhãn. Ví dụ từ tập test: "rong huyết" và "rong kinh" là DISEASESYMTOM. Bộ dữ liệu VietMed-NER có ba tập train 4.616, validation 1.154, test 3.497 câu, do hai người gán nhãn độc lập và hai người khác rà soát. Thời gian: 45 giây.');
}

// ============================================================ 3. Vì sao khó
{
  const s = base('Vì sao bài toán khó: hai thử thách của dữ liệu');
  stairs(s, 0);
  const types = Object.keys(EDA.train.entity_spans);
  s.addChart(pres.charts.BAR, ['train', 'validation', 'test'].map((k) => ({ name: k, labels: types, values: types.map((t) => EDA[k].entity_spans[t] || 0) })), {
    ...chartBase, x: 0.5, y: 1.25, w: 7.6, h: 4.6, barDir: 'col', barGrouping: 'clustered', chartColors: SERIES, title: 'Thử thách 1 — mất cân bằng lớp: số thực thể theo loại', catAxisLabelRotate: -50, catAxisLabelFontSize: 8.5,
  });
  const O = DQ.oov;
  kpi(s, `${pct(EDA.train.o_token_ratio, 1)}%`, 'token mang nhãn O ⇒ dùng F1 thực thể, không dùng accuracy', 0.6, 5.95, 3.7, 0.95, C.teal);
  kpi(s, '≈ 600×', `DISEASESYMTOM ${int(EDA.train.entity_spans.DISEASESYMTOM)} so với TRANSPORTATION ${EDA.train.entity_spans.TRANSPORTATION}`, 4.45, 5.95, 3.65, 0.95, C.gold);
  card(s, 8.4, 1.3, 4.35, 5.6, C.coralTint);
  heading(s, 'Thử thách 2 — test lệch miền', 8.62, 1.45, 4.0, C.coral);
  text(s, 'Train và val chia ngẫu nhiên từ **cùng nguồn** (VietMed train+dev+cv); test là **bản ghi khác**: podcast, bài giảng, tin tức, nhóm bệnh ICD-10 khác.', 8.62, 1.95, 3.95, 1.45, { size: 13.5 });
  s.addText('Thực thể chưa gặp trong train', { x: 8.62, y: 3.5, w: 3.95, h: 0.35, fontFace: BODY, fontSize: 13, bold: true, color: C.ink, margin: 0, isTextBox: true });
  [['Validation', O.validation.unseen_entity_rate, C.teal], ['Test', O.test.unseen_entity_rate, C.coral]].forEach(([lab, v, col], i) => {
    const y = 3.95 + i * 0.95;
    s.addText(lab, { x: 8.62, y, w: 1.3, h: 0.7, fontFace: BODY, fontSize: 14, color: C.ink, valign: 'middle', margin: 0, isTextBox: true });
    s.addShape(pres.shapes.RECTANGLE, { x: 9.95, y: y + 0.15, w: 2.6 * v / 0.35, h: 0.4, fill: { color: col }, line: { color: col } });
    s.addText(`${pct(v, 1)}%`, { x: 9.95 + 2.6 * v / 0.35 + 0.08, y, w: 1.0, h: 0.7, fontFace: HEAD, fontSize: 18, bold: true, color: col, valign: 'middle', margin: 0, isTextBox: true });
  });
  text(s, '⇒ Mô hình dựa vào **ghi nhớ** sẽ giữ điểm cao trên val nhưng tụt mạnh trên test. Đây là tiêu chí thứ hai khi leo thang.', 8.62, 5.85, 3.95, 0.95, { size: 13.5 });
  s.addNotes('Có hai thử thách. Thứ nhất là mất cân bằng lớp: 78,5% token mang nhãn O, lớp lớn nhất nhiều gấp khoảng 600 lần lớp nhỏ nhất; vì vậy nhóm dùng F1 mức thực thể chứ không dùng accuracy. Thứ hai là lệch miền: nhóm đối chiếu từng câu và xác nhận train và validation được chia ngẫu nhiên từ cùng một nguồn, còn test là các bản ghi khác hẳn. Hệ quả rõ nhất: 6,7% thực thể validation chưa gặp trong train, nhưng ở test là 30,7%. Vì vậy khi leo thang, nhóm theo dõi hai tiêu chí: F1 test, và khả năng nhận ra thực thể chưa gặp. Thời gian: 1 phút.');
}

// ============================================================ 4. Chuẩn bị dữ liệu
{
  const s = base('Chuẩn bị dữ liệu chung cho cả 6 bậc');
  stairs(s, 0);
  const Q = DQ.quality;
  const q = (k) => ['train', 'validation', 'test'].map((sp) => String(Q[sp][k]));
  table(s, ['Kiểm tra chất lượng', 'Train', 'Val', 'Test'], [
    ['Câu rỗng / token rỗng', ...['train', 'validation', 'test'].map((sp) => `${Q[sp].empty_sentences} / ${Q[sp].empty_tokens}`)],
    ['Số âm tiết ≠ số nhãn', ...q('length_mismatch')], ['Token chưa chuẩn hoá NFC', ...q('non_nfc_tokens')],
    ['Token có chữ hoa / chỉ dấu câu', ...['train', 'validation', 'test'].map((sp) => `${Q[sp].uppercase_tokens} / ${Q[sp].punctuation_only_tokens}`)],
    ['Chuỗi BIO lỗi (I- sau O)', ...q('invalid_bio_I_after_O')]],
    { x: 0.6, y: 1.35, w: 6.0, colW: [3.0, 1.0, 1.0, 1.0], size: 13.5, highlight: 4, rowH: 0.46 });
  text(s, 'Không có giá trị thiếu, dữ liệu đã viết thường và chuẩn NFC. 23 chuỗi BIO lỗi (< 0,02% token) được giữ nguyên để không đổi tập đánh giá.', 0.6, 4.35, 6.0, 0.8, { size: 13, italic: true, color: C.muted });
  card(s, 0.6, 5.3, 6.0, 1.6, C.goldTint);
  heading(s, 'Luật chơi công bằng', 0.82, 5.4, 5.6, C.navy, 16);
  bullets(s, ['Siêu tham số và seed chọn **chỉ theo validation**; test dùng 1 lần', 'Cùng thước đo: **F1 thực thể seqeval strict** + paired bootstrap'], 0.82, 5.8, 5.6, 1.05, 13.5);
  [['Nhãn', '37 nhãn BIO → label2id chỉ từ train; nhãn "0" đổi thành O'],
    ['Bậc 1–3 (cổ điển)', 'Đặc trưng thủ công: âm tiết, tiền/hậu tố, cửa sổ ±2, bigram → DictVectorizer 77.424 chiều'],
    ['Bậc 4–6 (Transformer)', 'Âm tiết → subword; nhãn gán cho subword đầu, còn lại -100; tối đa 256 subword']].forEach(([h, t], i) => {
    const y = 1.35 + i * 1.85;
    card(s, 6.95, y, 5.8, 1.65);
    heading(s, h, 7.17, y + 0.12, 5.4, i === 2 ? C.teal : C.navy, 16);
    text(s, t, 7.17, y + 0.58, 5.4, 1.0, { size: 14 });
  });
  s.addNotes('Trước khi leo, dữ liệu được kiểm tra và chuẩn bị chung. Không có giá trị thiếu, không lệch số âm tiết và số nhãn, không có token chưa chuẩn hoá. 23 chuỗi BIO lỗi được giữ nguyên. Mã hoá: 37 nhãn được ánh xạ sang số nguyên chỉ dựa trên train. Ba bậc cổ điển dùng cùng một bộ đặc trưng thủ công, được DictVectorizer biến thành vector thưa 77.424 chiều; ba bậc Transformer dùng subword và căn nhãn theo subword đầu. Luật chơi: mọi lựa chọn dựa trên validation, test chỉ dùng một lần, và mọi bậc được chấm cùng một thước đo. Thời gian: 45 giây.');
}

// ============================================================ 5. Thang 6 bậc
{
  const s = base('Cách leo: mỗi bậc đổi đúng một yếu tố');
  stairs(s, 0);
  const plan = [
    ['Logistic Regression', 'Mốc xuất phát', 'Phân loại từng âm tiết độc lập làm được đến đâu?'],
    ['Linear SVM', 'Hàm mất mát: log-loss → hinge', 'Đổi thuật toán phân loại có đủ không?'],
    ['CRF', 'Thêm quan hệ giữa các nhãn liền kề', 'Mô hình hoá chuỗi có đáng không?'],
    ['XLM-R', 'Đặc trưng thủ công → biểu diễn học từ pretraining', 'Tri thức ngôn ngữ có giúp nhận ra thực thể mới?'],
    ['PhoBERT', 'Pretrain đa ngôn ngữ → tiếng Việt, nhóm tự fine-tune', 'Đúng ngôn ngữ có tốt hơn không?'],
    ['ViHealthBERT', 'Pretrain tiếng Việt chung → văn bản y tế', 'Đúng miền y tế có tốt hơn không?'],
  ];
  plan.forEach(([m, change, q], i) => {
    const x = 0.6 + i * 2.04;
    const h = 1.75 + i * 0.5;
    const y = 6.85 - h;
    const fill = i < 3 ? C.navy2 : (i < 5 ? C.teal : C.coral);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 1.94, h, fill: { color: fill }, line: { color: fill } });
    s.addText(`${i + 1}`, { x: x + 0.12, y: y + 0.08, w: 0.5, h: 0.45, fontFace: HEAD, fontSize: 22, bold: true, color: C.white, margin: 0, isTextBox: true });
    s.addText(m, { x: x + 0.12, y: y + 0.5, w: 1.72, h: 0.45, fontFace: HEAD, fontSize: 14, bold: true, color: C.white, margin: 0, isTextBox: true });
    s.addText(change, { x: x + 0.12, y: y + 0.95, w: 1.72, h: 0.75, fontFace: BODY, fontSize: 10.5, color: 'E8F0F4', margin: 0, valign: 'top', isTextBox: true });
    s.addText(q, { x: x + 0.05, y: y - 1.0, w: 1.84, h: 0.9, fontFace: BODY, fontSize: 11.5, italic: true, color: C.ink, margin: 0, valign: 'bottom', isTextBox: true });
  });
  text(s, '**Bậc 1–3:** học máy cổ điển, cùng một bộ đặc trưng thủ công.  **Bậc 4–6:** Transformer pretrain, mỗi bậc gần bài toán hơn (ngôn ngữ, rồi miền y tế).', 0.6, 1.3, 12.1, 0.6, { size: 15 });
  s.addNotes('Đây là bản đồ của câu chuyện. Sáu mô hình được xếp thành thang tăng dần độ phức tạp và tri thức, mỗi bậc chỉ thay đổi đúng một yếu tố so với bậc trước, nên chênh lệch giữa hai bậc cho biết đóng góp của yếu tố đó. Bậc 1 là mốc: phân loại từng âm tiết độc lập. Bậc 2 đổi hàm mất mát. Bậc 3 thêm quan hệ giữa các nhãn liền kề. Bậc 4 thay đặc trưng thủ công bằng biểu diễn học từ pretraining. Bậc 5 dùng pretrain đúng ngôn ngữ tiếng Việt. Bậc 6 dùng pretrain đúng miền y tế. Mỗi bậc trả lời một câu hỏi, in nghiêng phía trên. Thời gian: 1 phút.');
}

// ============================================================ 6–11. Steps
const trials = (name) => MC.classical_training[name].trials;
stepSlide(1, {
  title: 'Logistic Regression — mốc xuất phát',
  change: 'Không có — phân loại **từng âm tiết độc lập** bằng đặc trưng thủ công (cửa sổ ±2), hồi quy logistic đa lớp, L2.',
  visual: (s, x, y, w, h) => s.addChart(pres.charts.BAR, [{ name: 'F1 validation', labels: trials('Logistic Regression').map((t) => `C = ${num(t.C)}`), values: trials('Logistic Regression').map((t) => +(t.val_f1 * 100).toFixed(1)) }], {
    ...chartBase, x, y, w, h, barDir: 'col', chartColors: ['4C72B0'], title: 'Chọn C theo F1 validation (%)', showLegend: false, showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 10, valAxisMinVal: 60, valAxisMaxVal: 90,
  }),
  learned: ['Đặc trưng từ vựng đã đạt **83,2%** F1 val', 'C nhỏ (0,1) ⇒ **underfit** 70,7%; C = 30 đã bắt đầu giảm'],
  missing: [`Không biết nhãn của âm tiết bên cạnh ⇒ **${int(INV['Logistic Regression'])}** chuyển nhãn BIO vô lý trên test`, `Chỉ nhận ra **${pct(M['Logistic Regression'].recall_unseen, 1)}%** thực thể chưa gặp`],
  notes: `Bậc 1 là mốc xuất phát: Logistic Regression phân loại từng âm tiết độc lập, dùng đặc trưng thủ công gồm âm tiết, tiền tố, hậu tố và cửa sổ hai âm tiết mỗi bên. Nhóm dò hệ số C trên validation: C = 0,1 bị underfit với 70,7%, C = 10 tốt nhất với 83,2%, C = 30 đã giảm lại. Trên test, F1 là ${pct(M['Logistic Regression'].test_f1)}%. Điểm yếu: mô hình không biết nhãn của âm tiết bên cạnh, nên sinh ${int(INV['Logistic Regression'])} lần chuyển nhãn BIO vô lý, ví dụ I- đứng sau O; và chỉ nhận ra ${pct(M['Logistic Regression'].recall_unseen, 1)}% thực thể chưa gặp. Thời gian: 50 giây.`,
});
stepSlide(2, {
  title: 'Linear SVM — đổi thuật toán phân loại',
  change: 'Hàm mất mát **log-loss → hinge** (lề cực đại), cùng bộ đặc trưng, vẫn phân loại từng âm tiết độc lập.',
  visual: (s, x, y, w, h) => s.addChart(pres.charts.BAR, [{ name: 'F1 validation', labels: trials('Linear SVM').map((t) => `C = ${num(t.C)}`), values: trials('Linear SVM').map((t) => +(t.val_f1 * 100).toFixed(1)) }], {
    ...chartBase, x, y, w, h, barDir: 'col', chartColors: ['DD8452'], title: 'Chọn C theo F1 validation (%): underfit ← → overfit', showLegend: false, showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 10, valAxisMinVal: 60, valAxisMaxVal: 90,
  }),
  learned: ['Tăng nhỏ nhưng có ý nghĩa thống kê: **+1,87** điểm', 'C = 0,01 underfit (70,5%), C = 10 overfit (81,7%) — minh hoạ bias–variance'],
  missing: [`Vẫn **${int(INV['Linear SVM'])}** chuyển nhãn BIO vô lý; lệch ranh giới ${int(M['Linear SVM'].span_outcomes.boundary)} thực thể`, 'Đổi thuật toán phân loại không sửa được lỗi cấu trúc chuỗi'],
  notes: `Bậc 2 chỉ đổi hàm mất mát sang hinge loss của SVM, giữ nguyên đặc trưng. Biểu đồ dò C cho thấy rõ đánh đổi bias–variance: C = 0,01 quá chặt nên underfit, C = 1 tốt nhất với 84,5%, C = 10 bắt đầu overfit. Trên test, SVM hơn Logistic Regression 1,87 điểm, khoảng tin cậy từ +1,35 đến +2,42, có ý nghĩa thống kê. Nhưng vấn đề cấu trúc vẫn còn: ${int(INV['Linear SVM'])} lần chuyển nhãn BIO vô lý và ${int(M['Linear SVM'].span_outcomes.boundary)} thực thể lệch ranh giới. Đổi thuật toán phân loại không đủ; cần mô hình hoá cả chuỗi. Thời gian: 50 giây.`,
});
stepSlide(3, {
  title: 'CRF — mô hình hoá cả chuỗi',
  change: 'Thêm **xác suất chuyển giữa các nhãn liền kề**; cùng đặc trưng thủ công, giải mã cả câu một lúc.',
  visual: (s, x, y, w, h) => s.addChart(pres.charts.BAR, [{ name: 'Chuyển nhãn BIO vô lý (test)', labels: ['LogReg', 'Linear SVM', 'CRF'], values: [INV['Logistic Regression'], INV['Linear SVM'], INV.CRF] }], {
    ...chartBase, x, y, w, h, barDir: 'col', chartColors: [C.coral], title: 'Chuyển nhãn BIO vô lý trên test', showLegend: false, showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 11,
  }),
  learned: [`Bước nhảy lớn nhất thang: **+5,70** điểm; F1 test **${pct(M.CRF.test_f1)}%** — cao nhất theo strict`, `Chuyển nhãn vô lý giảm còn **${INV.CRF}**; precision cao nhất (${pct(M.CRF.test_precision, 1)}%)`],
  missing: [`Train F1 ≈ 100% ⇒ **ghi nhớ**; recall thực thể đã gặp ${pct(M.CRF.recall_seen, 1)}% nhưng chưa gặp chỉ **${pct(M.CRF.recall_unseen, 1)}%**`, 'Cần tri thức ngôn ngữ để nhận ra thực thể mới'],
  notes: `Bậc 3 là bước nhảy lớn nhất: CRF học thêm xác suất chuyển giữa các nhãn liền kề và giải mã cả câu cùng lúc. Với cùng đặc trưng, F1 test tăng 5,70 điểm lên ${pct(M.CRF.test_f1)}%, cao nhất trong cả sáu mô hình theo thước đo strict. Số chuyển nhãn vô lý giảm từ hơn một nghìn xuống ${INV.CRF}. Nhưng có một dấu hiệu đáng lo: train F1 gần 100%, và khi tách thực thể test theo đã gặp hay chưa gặp trong train, CRF nhận ra ${pct(M.CRF.recall_seen, 1)}% thực thể đã gặp nhưng chỉ ${pct(M.CRF.recall_unseen, 1)}% thực thể mới. CRF thắng nhờ ghi nhớ. Muốn nhận ra thực thể mới, cần tri thức ngôn ngữ từ pretraining. Thời gian: 1 phút.`,
});
stepSlide(4, {
  title: 'XLM-RoBERTa — tri thức từ pretraining',
  change: 'Đặc trưng thủ công → **biểu diễn học từ pretraining** trên ~100 ngôn ngữ (checkpoint của tác giả bộ dữ liệu).',
  visual: (s, x, y, w, h) => s.addChart(pres.charts.BAR, [['recall_seen', 'Thực thể đã gặp'], ['recall_unseen', 'Thực thể chưa gặp']].map(([k, n]) => ({ name: n, labels: ['CRF (bậc 3)', 'XLM-R (bậc 4)'], values: ['CRF', 'XLM-R'].map((m) => +(M[m][k] * 100).toFixed(1)) })), {
    ...chartBase, x, y, w, h, barDir: 'col', barGrouping: 'clustered', chartColors: ['4C72B0', C.coral], title: 'Recall trên test (%)', showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 11, valAxisMinVal: 0, valAxisMaxVal: 100,
  }),
  learned: [`Thực thể chưa gặp: **${pct(M.CRF.recall_unseen, 1)}% → ${pct(M['XLM-R'].recall_unseen, 1)}%** (gần gấp 3)`, `Cùng checkpoint, chấm kiểu SLUE được ${pct(M['XLM-R'].test_slue_f1)}% ≈ 69% bài báo ⇒ khác biệt do thước đo`],
  missing: ['F1 strict **giảm 5,17** điểm: precision thấp (' + pct(M['XLM-R'].test_precision, 1) + '%), đoán thừa nhiều', 'Đa ngôn ngữ, không fine-tune lại ⇒ cần mô hình **tiếng Việt** do nhóm tự huấn luyện'],
  notes: `Bậc 4 là khúc ngoặt của câu chuyện. Thay đặc trưng thủ công bằng biểu diễn học từ pretraining, nhóm dùng XLM-RoBERTa, checkpoint của chính tác giả bộ dữ liệu. F1 strict giảm 5,17 điểm so với CRF, có ý nghĩa thống kê, vì mô hình đoán thừa nhiều, precision chỉ ${pct(M['XLM-R'].test_precision, 1)}%. Nhưng khả năng nhận ra thực thể chưa gặp tăng từ ${pct(M.CRF.recall_unseen, 1)}% lên ${pct(M['XLM-R'].recall_unseen, 1)}%, gần gấp ba. Tức là leo thang không phải lúc nào F1 cũng tăng, nhưng mô hình bắt đầu "hiểu" chứ không chỉ "nhớ". Thêm một phát hiện: bài báo gốc báo XLM-R đạt 0,69; chấm cùng checkpoint theo cách của bài báo (SLUE, không xét ranh giới) nhóm được ${pct(M['XLM-R'].test_slue_f1)}%, khớp với bài báo, nên khác biệt là do thước đo. Thời gian: 1 phút 15 giây.`,
});
stepSlide(5, {
  title: 'PhoBERT — đúng ngôn ngữ tiếng Việt',
  change: 'Pretrain đa ngôn ngữ → **tiếng Việt** (PhoBERT-base-v2); nhóm fine-tune với lưới 18 cấu hình × 3 seed.',
  visual: (s, x, y, w, h) => image(s, 'fig_sweep_underfitting.png', x, y, w, h),
  learned: ['**+3,80** điểm so với XLM-R, có ý nghĩa; F1 test ' + pct(M.PhoBERT.test_f1) + '%', 'lr 5e-6 × 4 epoch chỉ 36,65% ⇒ **underfit**; chọn lr 3e-5, 8 epoch, wd 0,05'],
  missing: [`Recall thực thể chưa gặp ${pct(M.PhoBERT.recall_unseen, 1)}%, chưa hơn XLM-R`, 'Pretrain trên văn bản chung, chưa có tri thức **y khoa**'],
  notes: `Bậc 5 chuyển sang mô hình đúng ngôn ngữ: PhoBERT-base-v2, do nhóm tự fine-tune. Nhóm dò 18 cấu hình gồm learning rate, số epoch và weight decay; hình cho thấy learning rate nhỏ và ít epoch gây underfitting, ví dụ lr 5e-6 với 4 epoch chỉ đạt 36,65% trên validation. Cấu hình tốt nhất là lr 3e-5, 8 epoch, weight decay 0,05, sau đó chọn seed theo validation. PhoBERT hơn XLM-R 3,80 điểm F1 test, có ý nghĩa thống kê, đạt ${pct(M.PhoBERT.test_f1)}%. Nhưng với thực thể chưa gặp, PhoBERT chỉ đạt ${pct(M.PhoBERT.recall_unseen, 1)}%: văn bản chung chưa đủ tri thức y khoa. Thời gian: 1 phút.`,
});
{
  const med = Object.keys(M.ViHealthBERT.per_type_f1).map((t) => [t, M.ViHealthBERT.per_type_f1[t] - M.PhoBERT.per_type_f1[t]]).filter(([, d]) => Math.abs(d) >= 0.01).sort((a, b) => b[1] - a[1]);
  stepSlide(6, {
    title: 'ViHealthBERT — đúng miền y tế',
    change: 'Pretrain tiếng Việt chung → **văn bản y tế tiếng Việt**; cùng quy trình fine-tune với PhoBERT.',
    visual: (s, x, y, w, h) => s.addChart(pres.charts.BAR, [{ name: 'Δ F1 (điểm)', labels: med.map(([t]) => t), values: med.map(([, d]) => +(d * 100).toFixed(1)) }], {
      ...chartBase, x, y, w, h, barDir: 'bar', chartColors: ['2A9D8F'], invertIfNegative: false, title: 'F1 theo loại: ViHealthBERT − PhoBERT (điểm)', showLegend: false, showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 9, catAxisLabelFontSize: 8.5, catAxisOrientation: 'maxMin', catAxisLabelPos: 'low',
    }),
    learned: [`Thực thể chưa gặp **${pct(M.ViHealthBERT.recall_unseen, 1)}%** — cao nhất cả thang (≈ 3 lần CRF)`, 'Tăng ở lớp y khoa: DISEASESYMTOM, MEDDEVICETECHNIQUE, DIAGNOSTICS'],
    missing: ['F1 tổng chỉ **+0,32** so với PhoBERT, CI chứa 0 ⇒ ngang nhau', `Vẫn thua CRF ${pct(STEPS.length ? M.CRF.test_f1 - M.ViHealthBERT.test_f1 : 0)} điểm strict ⇒ bậc tiếp theo: **BERT-CRF**`],
    notes: `Bậc 6 dùng ViHealthBERT, pretrain thêm trên văn bản y tế tiếng Việt, với cùng quy trình fine-tune. F1 tổng chỉ hơn PhoBERT 0,32 điểm, khoảng tin cậy chứa 0, nên hai mô hình ngang nhau về F1. Nhưng biểu đồ theo loại cho thấy ViHealthBERT tăng rõ ở các lớp y khoa như DISEASESYMTOM, MEDDEVICETECHNIQUE, DIAGNOSTICS, và giảm ở LOCATION, GENDER. Quan trọng hơn, nó nhận ra ${pct(M.ViHealthBERT.recall_unseen, 1)}% thực thể chưa gặp, cao nhất cả thang, khoảng ba lần CRF. Theo strict, nó vẫn thua CRF khoảng 1 điểm, vì Transformer đoán thừa và cắt sai ranh giới; đó là lý do bậc tiếp theo tự nhiên là BERT-CRF. Thời gian: 1 phút.`,
  });
}

// ============================================================ 12. Toàn cảnh
{
  const s = base('Nhìn lại cả thang: hai đường đi lên khác nhau');
  stairs(s, 6);
  const labels = ORDER.map((m, i) => `${i + 1}. ${SHORT[m]}`);
  s.addChart([
    { type: pres.charts.BAR, data: [{ name: 'F1 test (strict)', labels, values: ORDER.map((m) => +(M[m].test_f1 * 100).toFixed(1)) }], options: { chartColors: ['4C72B0'], barGapWidthPct: 60 } },
    { type: pres.charts.LINE, data: [{ name: 'Recall thực thể chưa gặp', labels, values: ORDER.map((m) => +(M[m].recall_unseen * 100).toFixed(1)) }], options: { chartColors: [C.coral], lineSize: 3, lineDataSymbolSize: 9 } },
  ], { ...chartBase, x: 0.5, y: 1.25, w: 7.3, h: 5.6, title: 'F1 test và khả năng nhận ra thực thể mới (%)', showValue: true, dataLabelFontSize: 10, valAxisMinVal: 0, valAxisMaxVal: 80 });
  table(s, ['Bước', 'Δ F1 test', 'CI95', 'Δ thực thể mới'], STEPS.map((st) => [`${SHORT[st.from]} → ${SHORT[st.to]}`, sgn(st.delta), `[${sgn(st.ci95[0], 1)}; ${sgn(st.ci95[1], 1)}]`, sgn(M[st.to].recall_unseen - M[st.from].recall_unseen, 1)]),
    { x: 8.05, y: 1.3, w: 4.7, colW: [1.9, 0.85, 1.15, 0.8], size: 11.5, highlight: 2, rowH: 0.42 });
  card(s, 8.05, 4.1, 4.7, 2.75, C.tealTint);
  heading(s, 'Đọc biểu đồ', 8.27, 4.2, 4.3, C.teal, 16);
  bullets(s, ['**Đường ghi nhớ** (F1 strict) đạt đỉnh ở **CRF**', '**Đường hiểu** (thực thể mới) vọt ở bậc 4 và đạt đỉnh ở **ViHealthBERT**', 'Bước duy nhất F1 giảm có ý nghĩa: CRF → XLM-R'], 8.27, 4.62, 4.35, 2.15, 14);
  s.addNotes('Nhìn lại cả thang, có hai đường đi lên khác nhau. Cột xanh là F1 test theo strict: tăng qua ba bậc cổ điển và đạt đỉnh ở CRF, rồi giảm khi chuyển sang XLM-R, và leo lại qua PhoBERT, ViHealthBERT nhưng chưa vượt CRF. Đường đỏ là khả năng nhận ra thực thể chưa gặp: gần như không đổi ở ba bậc cổ điển, vọt lên ở bậc 4 và đạt đỉnh ở ViHealthBERT. Bảng bên phải là chênh lệch từng bước với khoảng tin cậy bootstrap: mọi bước đều có ý nghĩa thống kê, trừ PhoBERT → ViHealthBERT; bước duy nhất F1 giảm có ý nghĩa là CRF → XLM-R. Thời gian: 1 phút.');
}

// ============================================================ 13. Ghi nhớ vs hiểu
{
  const s = base('Ghi nhớ hay hiểu: phân tích lỗi theo độ khó');
  stairs(s, 6);
  s.addChart(pres.charts.BAR, [['recall_seen', 'Đã gặp trong train'], ['recall_unseen', 'Chưa gặp trong train']].map(([k, n]) => ({ name: n, labels: ORDER.map((m) => SHORT[m]), values: ORDER.map((m) => +(M[m][k] * 100).toFixed(1)) })), {
    ...chartBase, x: 0.5, y: 1.25, w: 7.3, h: 4.3, barDir: 'col', barGrouping: 'clustered', chartColors: ['4C72B0', C.coral], title: 'Recall trên test (%)', showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 9, valAxisMaxVal: 100, valAxisMinVal: 0,
  });
  card(s, 0.6, 5.7, 7.2, 1.2, C.tint);
  text(s, 'Test có **5.782** thực thể đã gặp (69%) và **2.556** chưa gặp. Với văn bản, "độ khó của mẫu" (như ảnh mờ/rõ) chính là thực thể có quen thuộc với mô hình hay không.', 0.8, 5.75, 6.85, 1.1, { size: 13.5, valign: 'middle' });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 8.05, y: 1.3, w: 4.7, h: 3.6, fill: { color: C.white }, line: { color: C.line, width: 1 }, rectRadius: 0.08 });
  heading(s, 'Ví dụ thật (thực thể chưa gặp)', 8.27, 1.43, 4.3);
  s.addText([
    { text: '"rong huyết như vậy mình sẽ phân biệt với rong kinh và rong huyết"', options: { italic: true, fontSize: 14, color: C.ink, breakLine: true } },
    { text: 'Bậc 3 — CRF: "huyết" → ORGAN (×2)', options: { fontSize: 14, color: C.coral, bold: true, breakLine: true } },
    { text: 'Bậc 6 — ViHealthBERT: đúng cả 3 thực thể', options: { fontSize: 14, color: C.teal, bold: true } },
  ], { x: 8.27, y: 1.9, w: 4.3, h: 2.9, fontFace: BODY, margin: 0, valign: 'top', paraSpaceAfter: 10, isTextBox: true });
  card(s, 8.05, 5.1, 4.7, 1.8, C.goldTint);
  text(s, '**Chọn theo dữ liệu:** thuật ngữ lặp lại như train → CRF (rẻ, chính xác nhất theo strict). Chủ đề bệnh mới như test → ViHealthBERT.', 8.27, 5.2, 4.3, 1.6, { size: 14, valign: 'middle' });
  s.addNotes('Vì sao hai đường khác nhau? Nhóm tách thực thể test theo việc đã xuất hiện trong train hay chưa. Với thực thể đã gặp, các mô hình khá gần nhau, khoảng 77–87%. Với thực thể chưa gặp, ba mô hình cổ điển chỉ nhận ra 4,9–13,9%, còn ba Transformer 36–42%. Ví dụ thật: "rong huyết" và "rong kinh" chưa từng xuất hiện trong train; CRF chỉ nhận "huyết" thành cơ quan, còn ViHealthBERT đúng cả ba thực thể. Vì 69% thực thể test đã gặp ở train, lợi thế ghi nhớ đủ để CRF dẫn đầu F1 tổng. Kết luận chọn mô hình phụ thuộc vào dữ liệu sử dụng thực tế. Thời gian: 1 phút.');
}

// ============================================================ 14. Train vs validation
{
  const s = base('Mỗi bậc đều overfit? Train, validation và test');
  stairs(s, 6);
  s.addChart(pres.charts.BAR, [['train_f1', 'train'], ['val_f1', 'validation'], ['test_f1', 'test']].map(([k, n]) => ({ name: n, labels: ORDER.map((m) => SHORT[m]), values: ORDER.map((m) => +(M[m][k] * 100).toFixed(1)) })), {
    ...chartBase, x: 0.5, y: 1.25, w: 6.4, h: 3.5, barDir: 'col', barGrouping: 'clustered', chartColors: SERIES, title: 'F1 (%) trên ba tập', valAxisMinVal: 0, valAxisMaxVal: 100, catAxisLabelFontSize: 9,
  });
  const H = CURVE.history;
  s.addChart(pres.charts.LINE, [{ name: 'train', labels: H.map((h) => `E${h.epoch}`), values: H.map((h) => +(h.train_f1 * 100).toFixed(1)) }, { name: 'validation', labels: H.map((h) => `E${h.epoch}`), values: H.map((h) => +(h.validation_f1 * 100).toFixed(1)) }], {
    ...chartBase, x: 7.0, y: 1.25, w: 5.8, h: 3.5, chartColors: SERIES.slice(0, 2), title: 'ViHealthBERT: F1 (%) theo epoch', lineSize: 2.5, lineDataSymbolSize: 7, valAxisMinVal: 50, valAxisMaxVal: 100,
  });
  const last = H[H.length - 1];
  const cc = MC.crf_learning_curve;
  [['Overfitting', `Train cao hơn val 9,6–16,2 điểm ở cả 5 mô hình nhóm huấn luyện; CRF train ≈ 100% ở mọi cỡ dữ liệu. ViHealthBERT epoch 8: ${pct(last.train_f1, 1)}% vs ${pct(last.validation_f1, 1)}%.`, C.coral, C.coralTint],
    ['Underfitting', `ViHealthBERT epoch 1: train ${pct(H[0].train_f1, 1)}%, val ${pct(H[0].validation_f1, 1)}%. LogReg C = 0,1; SVM C = 0,01; PhoBERT lr 5e-6 × 4 epoch.`, C.gold, C.goldTint],
    ['Nguyên nhân chính', `Val → test mất 21–27 điểm, lớn hơn train → val ⇒ **lệch miền**. CRF test vẫn tăng theo dữ liệu (${pct(cc[0].test_f1, 1)}% → ${pct(cc[cc.length - 1].test_f1, 1)}%).`, C.teal, C.tealTint]].forEach(([h, t, col, fill], i) => {
    const x = 0.6 + i * 4.1;
    card(s, x, 5.0, 3.93, 1.9, fill);
    heading(s, h, x + 0.2, 5.1, 3.55, col, 16);
    text(s, t, x + 0.2, 5.52, 3.55, 1.33, { size: 12.5 });
  });
  s.addNotes(`Câu hỏi bắt buộc: các mô hình overfit hay underfit? Biểu đồ trái: cả năm mô hình do nhóm huấn luyện có train F1 cao hơn validation 9,6–16,2 điểm, tức đều overfit; XLM-R không được huấn luyện lại nên gần như không chênh. Biểu đồ phải là đường cong học của ViHealthBERT khi nhóm huấn luyện lại và chấm sau mỗi epoch: epoch 1 cả train và validation đều thấp, tức underfitting; từ epoch 5 train tiếp tục tăng lên ${pct(last.train_f1, 1)}% trong khi validation đi ngang quanh 85%, tức overfitting vừa phải. Underfitting cũng xuất hiện ở các cấu hình regularization quá mạnh của bậc 1, 2 và learning rate nhỏ của bậc 5. Nhưng khoảng cách validation–test 21–27 điểm lớn hơn nhiều, nên nguyên nhân chính làm giảm điểm test là lệch miền. Thời gian: 1 phút 15 giây.`);
}

// ============================================================ 15. Confusion matrix
{
  const s = base('Confusion matrix: bậc 6 còn nhầm ở đâu?');
  stairs(s, 6);
  image(s, 'fig_confusion_vihealthbert.png', 0.5, 1.2, 6.2, 5.75);
  card(s, 7.0, 1.3, 5.75, 2.45);
  heading(s, 'Cặp hay nhầm (ViHealthBERT, test)', 7.22, 1.42, 5.3);
  bullets(s, ['"tiêu xương" → "xương": **DISEASESYMTOM → ORGAN** (24 lần)', '"implant": **SURGERY → MEDDEVICETECHNIQUE** (40 lần)', '"chính phủ": **ORGANIZATION → LOCATION** (9 lần)'], 7.22, 1.88, 5.35, 1.8, 14);
  const so = (m) => M[m].span_outcomes;
  table(s, ['Mức thực thể', 'Khớp', 'Lệch biên', 'Sai loại', 'Bỏ sót', 'Thừa'], ORDER.map((m, i) => [`${i + 1}. ${SHORT[m]}`, int(so(m).exact), int(so(m).boundary), int(so(m).wrong_type), int(so(m).missed), int(so(m).spurious)]),
    { x: 7.0, y: 3.95, w: 5.75, colW: [1.65, 0.8, 0.9, 0.8, 0.8, 0.8], size: 11.5, rowH: 0.33 });
  text(s, 'Lên thang: bỏ sót giảm mạnh, nhưng đoán thừa tăng ⇒ lỗi còn lại chủ yếu là **ranh giới** và **đoán thừa**, không phải sai loại.', 7.0, 6.35, 5.75, 0.6, { size: 12.5, italic: true, color: C.muted });
  s.addNotes('Confusion matrix của bậc cao nhất, ViHealthBERT, chuẩn hoá theo hàng; báo cáo có đủ confusion matrix cho cả sáu mô hình. Các cặp hay nhầm: bệnh bị cắt thành cơ quan, ví dụ "tiêu xương" thành "xương" 24 lần; thủ thuật bị nhầm thành thiết bị, "implant" 40 lần; tổ chức bị nhầm thành địa điểm, "chính phủ" 9 lần. Bảng bên phải phân loại lỗi ở mức thực thể theo từng bậc: càng lên thang, bỏ sót càng giảm, từ hơn một nghìn xuống 352, nhưng đoán thừa tăng lên khoảng hai nghìn. Lỗi còn lại chủ yếu là lệch ranh giới và đoán thừa, đúng loại lỗi mà CRF làm tốt. Thời gian: 1 phút.');
}

// ============================================================ 16. Strict vs SLUE
{
  const s = base('Thước đo quyết định bậc nào "cao nhất"');
  stairs(s, 6);
  const paper = { 'XLM-R': '69', PhoBERT: '74' };
  table(s, ['Bậc', 'F1 strict (%)', 'F1 kiểu SLUE (%)', 'Bài báo'], ORDER.map((m, i) => [`${i + 1}. ${SHORT[m]}`, pct(M[m].test_f1), pct(M[m].test_slue_f1), paper[m] || '—']),
    { x: 0.6, y: 1.35, w: 6.9, colW: [2.2, 1.6, 1.9, 1.2], size: 14, highlight: 2, rowH: 0.5 });
  card(s, 7.8, 1.35, 4.95, 3.55);
  heading(s, 'Hai cách chấm', 8.02, 1.48, 4.5);
  bullets(s, ['**Strict:** khớp chính xác ranh giới và loại — CRF cao nhất', '**SLUE** (bài báo dùng): so khớp tập (loại, âm tiết), không xét ranh giới — **ViHealthBERT** cao nhất', `Cùng checkpoint XLM-R: SLUE ${pct(M['XLM-R'].test_slue_f1)}% ≈ 69% bài báo`], 8.02, 1.95, 4.55, 2.9, 14);
  card(s, 0.6, 5.1, 12.15, 1.8, C.coralTint);
  text(s, '**Nhóm chọn strict làm thước đo chính** vì ứng dụng cần trích xuất đúng cả cụm thực thể để ghi vào hồ sơ. Nhưng câu trả lời "bậc nào cao nhất" phụ thuộc thước đo: Transformer nhận ra nhiều âm tiết thuộc thực thể hơn dù ranh giới chưa chính xác.', 0.85, 5.15, 11.7, 1.7, { size: 15, valign: 'middle' });
  s.addNotes('Một bài học về đánh giá: bài báo gốc báo PhoBERT đạt 0,74, cao hơn nhiều so với số của nhóm. Nguyên nhân là bài báo dùng F1 kiểu SLUE, chỉ so khớp các cặp loại và âm tiết mà không xét ranh giới. Chấm cùng checkpoint XLM-R theo SLUE, nhóm được 68,53%, khớp 69% của bài báo. Và khi đổi thước đo, thứ hạng đổi theo: strict thì CRF cao nhất, SLUE thì ViHealthBERT cao nhất. Nhóm chọn strict vì ứng dụng cần trích xuất đúng cả cụm. Thời gian: 50 giây.');
}

// ============================================================ 17. Kết luận
{
  const s = base('Kết luận: mỗi bậc dạy một bài học');
  stairs(s, 6);
  const lessons = [
    ['1', 'LogReg', 'Đặc trưng từ vựng đã đi được xa (83% val)'],
    ['2', 'Linear SVM', 'Đổi thuật toán: +1,9 điểm, không sửa lỗi cấu trúc'],
    ['3', 'CRF', 'Mô hình hoá chuỗi: +5,7 điểm, cao nhất theo strict'],
    ['4', 'XLM-R', 'Pretraining: F1 giảm nhưng nhận ra thực thể mới gấp 3'],
    ['5', 'PhoBERT', 'Đúng ngôn ngữ: +3,8 điểm so với XLM-R'],
    ['6', 'ViHealthBERT', 'Đúng miền y tế: tổng quát hoá tốt nhất'],
  ];
  lessons.forEach(([n, m, t], i) => {
    const y = 1.3 + i * 0.78;
    s.addShape(pres.shapes.OVAL, { x: 0.6, y: y + 0.08, w: 0.55, h: 0.55, fill: { color: i < 3 ? C.navy2 : (i < 5 ? C.teal : C.coral) }, line: { color: C.white } });
    s.addText(n, { x: 0.6, y: y + 0.08, w: 0.55, h: 0.55, fontFace: HEAD, fontSize: 16, bold: true, color: C.white, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
    s.addText([{ text: `${m}: `, options: { bold: true, color: C.navy } }, { text: t, options: { color: C.ink } }], { x: 1.35, y, w: 6.3, h: 0.7, fontFace: BODY, fontSize: 17, valign: 'middle', margin: 0, isTextBox: true });
  });
  card(s, 7.9, 1.3, 4.85, 2.9, C.coralTint);
  heading(s, 'Bậc 7 (hướng phát triển)', 8.12, 1.42, 4.4, C.coral);
  bullets(s, ['**BERT-CRF:** hiểu của ViHealthBERT + ranh giới của CRF', 'Trọng số lớp / oversampling cho lớp hiếm', 'Dữ liệu cùng miền test, từ điển thuật ngữ y khoa'], 8.12, 1.88, 4.45, 2.25, 16);
  card(s, 7.9, 4.4, 4.85, 2.5, C.tealTint);
  heading(s, 'Thông điệp', 8.12, 4.52, 4.4, C.teal);
  text(s, 'Nút thắt không nằm ở việc chọn mô hình mà ở **dữ liệu**: lệch miền, mất cân bằng, ranh giới nhãn mơ hồ. Leo thang giúp đo được đóng góp của từng yếu tố.', 8.12, 4.98, 4.45, 1.85, { size: 16 });
  s.addNotes('Tổng kết, mỗi bậc dạy một bài học: đặc trưng từ vựng đã đi được xa; đổi thuật toán phân loại chỉ giúp ít; mô hình hoá chuỗi là bước nhảy lớn nhất và cho F1 strict cao nhất; pretraining làm F1 giảm nhưng nhận ra thực thể mới gấp ba; pretrain đúng ngôn ngữ và đúng miền y tế tiếp tục cải thiện khả năng tổng quát hoá. Bậc tiếp theo tự nhiên là BERT-CRF, kết hợp khả năng hiểu của ViHealthBERT với ràng buộc ranh giới của CRF, cùng với xử lý lớp hiếm và bổ sung dữ liệu cùng miền. Thông điệp chính: nút thắt nằm ở dữ liệu, và cách leo từng bậc giúp nhóm đo được đóng góp của từng yếu tố. Thời gian: 1 phút.');
}

// ============================================================ 18. Thanks
{
  const s = pres.addSlide();
  slideNo += 1;
  s.background = { color: C.navy };
  s.addText('Cảm ơn Thầy và Anh Chị đã lắng nghe!', { x: 0.8, y: 2.6, w: W - 1.6, h: 1.3, fontFace: HEAD, fontSize: 42, bold: true, color: C.white, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
  s.addText('Hỏi & đáp', { x: 0.8, y: 4.0, w: W - 1.6, h: 0.6, fontFace: BODY, fontSize: 22, color: '9FD8CF', align: 'center', margin: 0, isTextBox: true });
  s.addNotes('Cảm ơn Thầy và các bạn đã lắng nghe. Nhóm sẵn sàng trả lời câu hỏi. Thời gian: 15 giây.');
}

// pptxgenjs emits one <a:pPr> per run; keep only the first per paragraph so multi-run bullet items keep their bullet.
pres.write({ outputType: 'nodebuffer' }).then(async (buf) => {
  const zip = await JSZip.loadAsync(buf);
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    const xml = await zip.file(f).async('string');
    zip.file(f, xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (para, inner) => {
      let seen = false;
      return `<a:p>${inner.replace(/<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g, (m) => (seen ? '' : ((seen = true), m)))}</a:p>`;
    }));
  }
  fs.writeFileSync(OUT, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log('wrote', OUT, slideNo, 'slides');
});
