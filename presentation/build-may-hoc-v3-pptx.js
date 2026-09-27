// Builds presentation/may-hoc-v3.pptx: the training story of VietMed-NER (Máy học), from data to demo.
// Every number is read at build time from committed JSON (do_an_may_hoc/results, do_an_may_hoc/ket_qua_goc,
// experiments/00x, giai_doan_15 historical scores). Figures come from do_an_may_hoc/results.
// Usage: node build-may-hoc-v3-pptx.js [repo root]   (requires: npm install pptxgenjs jszip)
const fs = require('fs');
const path = require('path');
const pptxgen = require('pptxgenjs');
const JSZip = require('jszip');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const RES = path.join(ROOT, 'do_an_may_hoc/results');
const FIG = RES;
const LOGO = path.join(ROOT, 'presentation/assets/images/uit_logo.png');
const OUT = path.join(ROOT, 'presentation/may-hoc-v3.pptx');
const RJ = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const J = (f) => RJ(`do_an_may_hoc/results/${f}`);
const PRIOR = (f) => RJ(`do_an_may_hoc/ket_qua_goc/${f}`);

// ---------- sources
const MC = J('model_comparison.json');
const M = MC.models;
const EDA = J('eda.json');
const DQ = J('data_quality.json');
const DET = J('eda_detail.json');
const VN = J('vi_ner_comparison.json');
const ASR = J('asr_eda.json');
const CURVE = J('vihealthbert_epoch_curve.json');
const PRED = J('test_predictions.json');
const STEPS = J('ladder_steps.json');
const SWEEP = { PhoBERT: PRIOR('phobert_validation_sweep.json'), ViHealthBERT: PRIOR('vihealthbert_validation_sweep.json') };
const SPEED = PRIOR('speed_benchmark.json');
const LORA = PRIOR('lora_training_runs.json');
const OLD = RJ('giai_doan_15_ner_finetune_vihealthbert/ketqua/ner_gold_comparison.json').metrics; // scored with the "0" bug
const AGGF = {
  PhoBERT: RJ('experiments/004-vi-ner-intermediate-finetune/results/phobert/aggregate.json'),
  ViHealthBERT: RJ('experiments/004-vi-ner-intermediate-finetune/results/vihealthbert/aggregate.json'),
};
const AGG = { PhoBERT: AGGF.PhoBERT.summary, ViHealthBERT: AGGF.ViHealthBERT.summary };
const SEEDS = AGGF.PhoBERT.seeds.join(', ');
const X5 = RJ('experiments/005-correction-before-ner/results.json');
const CONF = J('confusion_all_models.json');
const WS_HYP = fs.readFileSync(path.join(ROOT, 'do_an_may_hoc/ket_qua_goc/asr_test_whisper_small.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).hypothesis);
const X1 = RJ('experiments/001-zeroshot-correction-vietmed/outputs/evaluation-summary.json');

const ORDER = ['Logistic Regression', 'Linear SVM', 'CRF', 'XLM-R', 'PhoBERT', 'ViHealthBERT'];
const SHORT = { 'Logistic Regression': 'LogReg', 'Linear SVM': 'Linear SVM', CRF: 'CRF', 'XLM-R': 'XLM-R', PhoBERT: 'PhoBERT', ViHealthBERT: 'ViHealthBERT' };
const TYPES = Object.keys(EDA.train.entity_spans);
const SPLITS = ['train', 'validation', 'test'];
const TOTAL = 22;
const NBOOT = +STEPS.protocol.match(/(\d+) resamples/)[1];
const TR = ['XLM-R', 'PhoBERT', 'ViHealthBERT'];
const rng = (vals, d = 0) => `${pct(Math.min(...vals), d)} đến ${pct(Math.max(...vals), d)}`;

// ---------- formatting (throws on missing values so a bad key never reaches a slide)
const fin = (x) => { if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`bad number: ${x}`); return x; };
const pct = (x, d = 2) => (fin(x) * 100).toFixed(d).replace('.', ',');
const int = (x) => Math.round(fin(x)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const sgn = (x, d = 2) => `${fin(x) >= 0 ? '+' : '−'}${pct(Math.abs(x), d)}`;
const num = (x, d) => (d === undefined ? String(fin(x)) : fin(x).toFixed(d)).replace('.', ',');
const sci = (x) => fin(x).toExponential().replace(/\.0+e/, 'e').replace('e-', 'e-');
const ci = (c, d = 2) => `[${sgn(c[0], d)}; ${sgn(c[1], d)}]`;
const ms = (s, d = 2) => `${pct(s.mean, d)} ± ${pct(s.std, d)}`;
const r1 = (x) => +(fin(x) * 100).toFixed(1);

// ---------- derived numbers
const invalidBio = (m) => PRED[m].reduce((acc, row) => {
  let prev = 'O';
  row.forEach((t) => { if (t.startsWith('I-') && !(prev !== 'O' && prev.slice(2) === t.slice(2))) acc += 1; prev = t; });
  return acc;
}, 0);
const INV = Object.fromEntries(ORDER.map((m) => [m, invalidBio(m)]));
const CD = DET.class_distribution.per_type;
const OOV = DQ.oov;
const unseenTest = Math.round(OOV.test.unseen_entity_rate * EDA.test.entity_total);
const LIN = DQ.lineage;
const SUB = DET.subword_length.models;
const subMax = Math.max(...Object.values(SUB).flatMap((m) => SPLITS.map((s) => m[s].max)));
const subOver = Object.values(SUB).reduce((a, m) => a + SPLITS.reduce((b, s) => b + m[s].over_256, 0), 0);
const OV = DET.split_overlap;
const LC = DET.label_consistency.train;
const bioErr = SPLITS.map((s) => DQ.quality[s].invalid_bio_I_after_O);
const trials = (name) => MC.classical_training[name].trials;
const bestT = (name) => MC.classical_training[name].best;
const sweepLow = (m) => SWEEP[m].trials.reduce((a, t) => (t.validation.eval_f1 < a.validation.eval_f1 ? t : a));
const OLD_ROWS = [['XLM-R', OLD.baseline_xlm_roberta], ['PhoBERT', OLD.phobert_best_validation_seed], ['ViHealthBERT', OLD.vihealthbert_best_validation_seed]];
const fakeSupport = OLD.phobert_best_validation_seed.classification_report._.support;
const oldSupport = OLD.phobert_best_validation_seed.classification_report['micro avg'].support;
const oldDelta = OLD.vihealthbert_best_validation_seed.f1 - OLD.phobert_best_validation_seed.f1;
const PV = MC.pairs['ViHealthBERT - PhoBERT'];
const SYS = ASR.systems;
const PW = SYS['PhoWhisper-medium (toàn bộ test)'];
const PW500 = SYS['PhoWhisper-medium (500 câu)'];
const WS = SYS['Whisper-small (500 câu)'];
const NER5 = X5.ner;
const f5 = (k) => NER5[k].micro.f1;
const corrGain = X5.normalized_comparison.corrected_minus_raw_micro_f1;
const normGain = f5('raw_normalized') - f5('raw');
const TC = X5.text_changes;
const wsNormChanged = WS_HYP.filter((h) => h !== h.toLowerCase() || /\p{P}/u.test(h)).length; // normalization = lowercase + strip punctuation
const aggT = (m, path, t) => AGG[m][path].per_type[t].f1.mean;

// ---------- palette & type (same theme as v2)
const C = {
  navy: '0F2A3D', navy2: '17384F', ink: '1B2733', muted: '5B6B7A', line: 'D5DEE5', tint: 'EEF4F7', white: 'FFFFFF',
  coral: 'E4572E', coralTint: 'FCE9E3', teal: '2A9D8F', tealTint: 'E3F3F1', gold: 'E9A23B', goldTint: 'FBF1DF', future: 'DDE5EB',
};
const HEAD = 'Cambria';
const BODY = 'Calibri';
const SERIES = ['4C72B0', 'DD8452', '55A868'];
const W = 13.333;
const CHAPTERS = ['Dữ liệu', 'Mô hình', 'Kết quả', 'Thử thêm', 'Hệ thống'];

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.title = 'Hành trình huấn luyện VietMed-NER';
let slideNo = 0;

// ---------- helpers
function chapterTabs(s, ch) {
  CHAPTERS.forEach((name, i) => {
    const x = 9.05 + i * 0.75;
    const fill = i === ch ? C.coral : (i < ch ? C.teal : C.future);
    s.addShape(pres.shapes.RECTANGLE, { x, y: 0.42, w: 0.71, h: 0.08, fill: { color: fill }, line: { color: fill } });
    s.addText(name, { x: x - 0.02, y: 0.53, w: 0.75, h: 0.3, fontFace: BODY, fontSize: 8.5, bold: i === ch, color: i === ch ? C.coral : C.muted, align: 'center', margin: 0, isTextBox: true });
  });
}
function base(title, ch) {
  const s = pres.addSlide();
  slideNo += 1;
  s.background = { color: C.white };
  s.addText(title, { x: 0.6, y: 0.3, w: 8.3, h: 0.85, fontFace: HEAD, fontSize: 23, bold: true, color: C.navy, margin: 0, valign: 'middle', isTextBox: true });
  if (ch !== undefined) chapterTabs(s, ch);
  s.addText(`${slideNo} / ${TOTAL}`, { x: W - 1.6, y: 7.05, w: 1.0, h: 0.3, fontFace: BODY, fontSize: 10, color: C.muted, align: 'right', margin: 0, isTextBox: true });
  return s;
}
function card(s, x, y, w, h, fill = C.tint) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill }, line: { color: fill }, rectRadius: 0.08 });
}
function runs(t, opts = {}) {
  return t.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) => (part.startsWith('**')
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
  const numeric = header.map((_, i) => i > 0 && rows.every((r) => /^[\d.,%–\-−+[\]; ()P/R|—×±]+$/.test(String(r[i]).replace(/\s/g, ''))));
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
  s.addText(big, { x: x + 0.18, y: y + 0.08, w: w - 0.36, h: h * 0.52, fontFace: HEAD, fontSize: 24, bold: true, color, margin: 0, valign: 'middle', isTextBox: true });
  s.addText(runs(label, { fontFace: BODY, fontSize: 11, color: C.muted }), { x: x + 0.18, y: y + h * 0.6, w: w - 0.36, h: h * 0.36, margin: 0, valign: 'top', isTextBox: true });
}
function source(s, t) {
  s.addText(`Nguồn: ${t}`, { x: 0.6, y: 7.05, w: 10.8, h: 0.3, fontFace: BODY, fontSize: 8.5, italic: true, color: C.muted, margin: 0, isTextBox: true });
}
const chartBase = {
  fontFace: BODY, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, catAxisLabelColor: C.muted, valAxisLabelColor: C.muted,
  valGridLine: { color: 'E6ECF0', size: 0.5 }, catGridLine: { style: 'none' }, showLegend: true, legendPos: 'b', legendFontSize: 10.5,
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
  s.addText('Huấn luyện NER y tế\ncho hội thoại tiếng Việt', { x: 0.7, y: 1.85, w: 8.0, h: 2.3, fontFace: HEAD, fontSize: 36, bold: true, color: C.white, margin: 0, valign: 'top', isTextBox: true });
  s.addText('Câu chuyện thật của VietMed-NER: dữ liệu dẫn đến quyết định gì, mô hình nào thắng, lỗi chấm điểm nhóm tìm ra, và những gì đã thử mà không giúp', { x: 0.7, y: 4.2, w: 7.6, h: 1.0, fontFace: BODY, fontSize: 17, color: '9FD8CF', margin: 0, valign: 'top', isTextBox: true });
  s.addText([{ text: 'Môn học: Máy học', options: { breakLine: true } }, { text: 'Giảng viên hướng dẫn: Đặng Văn Thìn', options: { breakLine: true } }, { text: 'Nhóm thực hiện: Nhóm 8' }],
    { x: 0.7, y: 5.4, w: 7, h: 1.2, fontFace: BODY, fontSize: 16, color: 'D6E2EA', margin: 0, paraSpaceAfter: 4, isTextBox: true });
  CHAPTERS.forEach((name, i) => {
    const y = 1.9 + i * 0.88;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 9.2, y, w: 3.4, h: 0.7, fill: { color: i === 2 ? C.coral : '2F5A76' }, line: { color: i === 2 ? C.coral : '2F5A76' }, rectRadius: 0.08 });
    s.addText(`${i + 1}. ${name}`, { x: 9.4, y, w: 3.1, h: 0.7, fontFace: HEAD, fontSize: 17, bold: true, color: C.white, valign: 'middle', margin: 0, isTextBox: true });
  });
  s.addNotes('Kính chào Thầy và các bạn. Nhóm 8 trình bày đồ án môn Máy học: nhận dạng thực thể y tế trong hội thoại tiếng Việt trên bộ dữ liệu VietMed-NER. Bài trình bày kể lại đúng những gì nhóm đã huấn luyện và đo được, theo năm chương: dữ liệu và các phát hiện từ EDA, các mô hình từ cổ điển đến Transformer, kết quả sau khi sửa một lỗi chấm điểm mà nhóm tự phát hiện, những hướng đã thử nhưng không cải thiện, và cuối cùng là phía nhận dạng tiếng nói trong hệ thống demo. Mọi con số trên slide đều được đọc trực tiếp từ các file kết quả trong kho mã. Thời gian: 40 giây.');
}

// ============================================================ 2. Problem & data
{
  const s = base('Bài toán: gán nhãn từng âm tiết trong lời nói y khoa', 0);
  card(s, 0.6, 1.35, 5.9, 2.35);
  heading(s, 'Gán nhãn chuỗi theo sơ đồ BIO', 0.82, 1.48, 5.5);
  const toks = [['rong', 'B-DISEASE…', 1], ['huyết', 'I-DISEASE…', 1], ['như', 'O', 0], ['vậy', 'O', 0], ['…', 'O', 0], ['rong', 'B-DISEASE…', 1], ['kinh', 'I-DISEASE…', 1]];
  toks.forEach(([w, t, ent], i) => {
    const x = 0.82 + i * 0.79;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 2.0, w: 0.72, h: 0.85, fill: { color: ent ? C.coralTint : C.white }, line: { color: ent ? C.coral : C.line, width: 1 }, rectRadius: 0.06 });
    s.addText(w, { x, y: 2.05, w: 0.72, h: 0.4, fontFace: HEAD, fontSize: 14, bold: true, color: C.ink, align: 'center', margin: 0, isTextBox: true });
    s.addText(t, { x, y: 2.47, w: 0.72, h: 0.3, fontFace: BODY, fontSize: 7, color: ent ? C.coral : C.muted, align: 'center', margin: 0, isTextBox: true });
  });
  text(s, `**B-X** mở đầu thực thể loại X, **I-X** nối tiếp, **O** ngoài thực thể. **${TYPES.length} loại → ${TYPES.length * 2 + 1} nhãn.**`, 0.82, 3.0, 5.5, 0.65, { size: 13.5 });
  table(s, ['Tập', 'Số câu', 'Số token', 'Số thực thể', 'Độ dài TB'], SPLITS.map((k) => [k, int(EDA[k].sentences), int(EDA[k].tokens), int(EDA[k].entity_total), num(EDA[k].len_mean, 1)]),
    { x: 0.6, y: 3.95, w: 5.9, colW: [1.4, 1.1, 1.2, 1.2, 1.0], size: 13, rowH: 0.42 });
  text(s, 'leduckhai/VietMed-NER: transcript hội thoại y tế thật, gán nhãn thủ công.', 0.6, 5.8, 5.9, 0.6, { size: 12, italic: true, color: C.muted });
  card(s, 6.85, 1.35, 5.9, 5.3, C.tint);
  heading(s, 'Văn bản nói, không phải văn bản viết', 7.07, 1.48, 5.5);
  const Q = DQ.quality;
  const NO = DET.text_noise;
  bullets(s, [
    `**Toàn chữ thường, không dấu câu:** ${SPLITS.map((k) => Q[k].uppercase_tokens).join(' / ')} token chữ hoa và ${SPLITS.map((k) => Q[k].punctuation_only_tokens).join(' / ')} token dấu câu (train / val / test)`,
    `**Từ đệm hội thoại:** ${pct(NO.train.filler.sentence_share, 1)}% câu train có "ạ", "vâng", "dạ"…`,
    `**Số viết bằng chữ:** ${num(NO.train.number_words.spans_per_100_sentences, 1)} cụm số / 100 câu train, ${pct(NO.train.number_words.span_share_inside_entity, 0)}% nằm trong thực thể`,
    `**Từ ngoại lai:** ${pct(NO.test.foreign.token_share, 1)}% token test ("parkinson", "vitamin"…), ${pct(NO.test.foreign.share_inside_entity, 0)}% nằm trong thực thể`,
    `**Không có** câu rỗng, token rỗng hay lệch độ dài âm tiết–nhãn ở cả ba tập`,
  ], 7.07, 1.95, 5.5, 4.6, 15.5);
  source(s, 'do_an_may_hoc/results/eda.json, data_quality.json, eda_detail.json (text_noise)');
  s.addNotes(`Bài toán là nhận dạng thực thể có tên trong transcript hội thoại y tế. Mỗi âm tiết được gán một nhãn theo sơ đồ BIO; bộ dữ liệu có ${TYPES.length} loại thực thể, tức ${TYPES.length * 2 + 1} nhãn. Ví dụ "rong huyết" và "rong kinh" là thực thể bệnh – triệu chứng. VietMed-NER có ${int(EDA.train.sentences)} câu train, ${int(EDA.validation.sentences)} câu validation và ${int(EDA.test.sentences)} câu test. Điểm quan trọng: đây là lời nói được phiên âm, không phải văn bản viết. Toàn bộ dữ liệu viết thường, không có dấu câu, có từ đệm như "ạ", "vâng", số được đọc thành chữ, và có nhiều từ ngoại lai như tên thuốc, phần lớn nằm ngay trong thực thể. Vì vậy các mô hình dựa vào chữ hoa hay dấu câu sẽ không có tín hiệu đó. Dữ liệu sạch về mặt kỹ thuật: không có câu rỗng hay lệch độ dài. Thời gian: 1 phút.`);
}

// ============================================================ 3. Imbalance
{
  const s = base(`Phát hiện 1: lớp lớn nhất gấp ${num(DET.class_distribution.imbalance_ratio, 0)} lần lớp nhỏ nhất`, 0);
  const sorted = [...TYPES].sort((a, b) => EDA.train.entity_spans[b] - EDA.train.entity_spans[a]);
  s.addChart(pres.charts.BAR, [{ name: 'train', labels: sorted, values: sorted.map((t) => EDA.train.entity_spans[t]) }], {
    ...chartBase, x: 0.5, y: 1.25, w: 7.6, h: 5.65, barDir: 'bar', chartColors: ['4C72B0'], title: 'Số thực thể trong train theo loại', showLegend: false, showValue: true, dataLabelFontSize: 8.5, dataLabelPosition: 'outEnd', catAxisLabelFontSize: 9, catAxisOrientation: 'maxMin',
  });
  const big = DET.class_distribution.largest;
  const small = DET.class_distribution.smallest;
  kpi(s, `${pct(EDA.train.o_token_ratio, 1)}%`, `token train mang nhãn O; đoán toàn O đã đạt accuracy ${pct(EDA.test.o_token_ratio, 1)}% trên test`, 8.4, 1.3, 4.35, 1.2, C.teal);
  kpi(s, `${num(DET.class_distribution.imbalance_ratio, 0)}×`, `${big} ${int(EDA.train.entity_spans[big])} so với ${small} ${EDA.train.entity_spans[small]} thực thể train`, 8.4, 2.65, 4.35, 1.2, C.gold);
  card(s, 8.4, 4.0, 4.35, 2.9, C.coralTint);
  heading(s, 'Lớp hiếm: kết quả không đáng tin', 8.6, 4.1, 4.0, C.coral, 15);
  bullets(s, DET.class_distribution.rare_types.map((t) => `**${t}:** ${CD[t].train} mẫu train, ${CD[t].test} mẫu test; một thực thể test = **${num(CD[t].test_points_per_entity, 1)}** điểm recall`)
    .concat([`Ngưỡng "hiếm": dưới ${DET.class_distribution.rare_threshold} mẫu train`]), 8.6, 4.55, 4.0, 2.3, 13);
  source(s, 'do_an_may_hoc/results/eda.json, eda_detail.json (class_distribution)');
  s.addNotes(`Phát hiện đầu tiên từ EDA là mất cân bằng. ${pct(EDA.train.o_token_ratio, 1)}% token mang nhãn O, nên một mô hình đoán toàn O đã đạt accuracy khoảng ${pct(EDA.test.o_token_ratio, 0)}%; vì vậy accuracy vô nghĩa và nhóm dùng F1 mức thực thể. Giữa các loại, ${big} có ${int(EDA.train.entity_spans[big])} thực thể train, gấp ${num(DET.class_distribution.imbalance_ratio, 0)} lần ${small} chỉ có ${EDA.train.entity_spans[small]}. Hai lớp hiếm là ORGANIZATION và TRANSPORTATION. Với lớp hiếm, số trên tập test rất nhạy: một thực thể TRANSPORTATION đúng hay sai làm recall của lớp đó thay đổi ${num(CD.TRANSPORTATION.test_points_per_entity, 1)} điểm. Nhóm ghi nhận điều này để không kết luận gì về lớp hiếm ở phần kết quả. Thời gian: 1 phút.`);
}

// ============================================================ 4. Train/test shift
{
  const s = base(`Phát hiện 2: ${pct(OOV.test.unseen_entity_rate)}% thực thể test chưa từng gặp`, 0);
  image(s, 'fig_type_shift.png', 0.5, 1.3, 8.0, 3.4);
  const T = ASR.vietmed_splits;
  card(s, 8.75, 1.3, 4.0, 3.4, C.coralTint);
  heading(s, 'Train/val cùng nguồn, test khác', 8.95, 1.4, 3.7, C.coral, 15);
  bullets(s, [
    `Train: VietMed train ${int(LIN.train.train)} + dev ${int(LIN.train.dev)} + cv ${LIN.train.cv} câu`,
    `Val: dev ${LIN.validation.dev} + train ${LIN.validation.train} + cv ${LIN.validation.cv} ⇒ **chia ngẫu nhiên** cùng nguồn`,
    `Test: bản ghi test riêng (${int(LIN.test.test)} khớp + ${LIN.test.no_exact_match} không khớp nguyên văn)`,
  ], 8.95, 1.85, 3.7, 2.8, 12.5);
  [['Validation', OOV.validation.unseen_entity_rate, C.teal], ['Test', OOV.test.unseen_entity_rate, C.coral]].forEach(([lab, v, col], i) => {
    const y = 4.95 + i * 0.6;
    s.addText(`Chưa gặp — ${lab}`, { x: 0.6, y, w: 2.1, h: 0.5, fontFace: BODY, fontSize: 13, color: C.ink, valign: 'middle', margin: 0, isTextBox: true });
    s.addShape(pres.shapes.RECTANGLE, { x: 2.75, y: y + 0.1, w: 4.0 * v / 0.35, h: 0.3, fill: { color: col }, line: { color: col } });
    s.addText(`${pct(v)}%`, { x: 2.85 + 4.0 * v / 0.35, y, w: 1.2, h: 0.5, fontFace: HEAD, fontSize: 16, bold: true, color: col, valign: 'middle', margin: 0, isTextBox: true });
  });
  card(s, 8.75, 4.9, 4.0, 2.0, C.tint);
  heading(s, 'Chủ đề và hình thức khác', 8.95, 5.0, 3.7, C.navy, 15);
  bullets(s, [`ICD-10 phổ biến nhất: train ${T.train.icd10_top[0][0]} (${pct(T.train.icd10_top[0][1], 0)}%), test ${T.test.icd10_top[0][0]} (${pct(T.test.icd10_top[0][1], 0)}%)`,
    `Test chủ yếu ${T.test.rec_condition_top[0][0]}, ${T.test.rec_condition_top[1][0]}; train là ${T.train.rec_condition_top[0][0]}, ${T.train.rec_condition_top[1][0]}`], 8.95, 5.4, 3.7, 1.45, 12);
  text(s, `Trùng lặp không đáng kể: ${OV.cross_split_exact.validation_in_train.count} câu val trùng train, **${OV.cross_split_exact.test_in_train.count}** câu test trùng train, ${OV.within_split_duplicates.test} câu lặp trong test ⇒ không rò rỉ.`, 0.6, 6.25, 7.9, 0.65, { size: 12.5, italic: true, color: C.muted });
  source(s, 'data_quality.json (oov, lineage), eda_detail.json (per_type_shift, split_overlap), asr_eda.json (vietmed_splits)');
  s.addNotes(`Phát hiện thứ hai quyết định cả câu chuyện: tập test lệch miền so với train. Nhóm đối chiếu từng câu với bộ VietMed gốc và thấy train và validation được chia ngẫu nhiên từ cùng một nguồn, còn test là các bản ghi khác hẳn: chủ đề bệnh khác theo mã ICD-10, và hình thức ghi âm là podcast, talkshow thay vì tư vấn, điện thoại. Hệ quả: chỉ ${pct(OOV.validation.unseen_entity_rate, 1)}% thực thể validation chưa gặp trong train, nhưng ở test là ${pct(OOV.test.unseen_entity_rate, 1)}%. Biểu đồ bên trái cho thấy tỉ lệ này đặc biệt cao ở thiết bị – kỹ thuật và phẫu thuật. Nhóm cũng kiểm tra trùng lặp: không có câu test nào trùng train, nên test không bị rò rỉ. Từ đây nhóm dự đoán: mô hình nào dựa vào ghi nhớ sẽ tụt mạnh trên test. Thời gian: 1 phút 10 giây.`);
}

// ============================================================ 5. Findings -> decisions
{
  const s = base('Từ phát hiện đến quyết định huấn luyện', 0);
  table(s, ['Phát hiện (EDA)', 'Bằng chứng', 'Quyết định'], [
    ['Nhãn O áp đảo', `${pct(EDA.train.o_token_ratio, 1)}% token là O`, 'Thước đo chính: F1 mức thực thể (seqeval strict), kèm macro F1; không dùng accuracy'],
    ['Mất cân bằng', `${num(DET.class_distribution.imbalance_ratio, 0)}×; ORGANIZATION ${CD.ORGANIZATION.train}, TRANSPORTATION ${CD.TRANSPORTATION.train} mẫu train`, 'Không class weight / oversampling, cùng hàm mục tiêu cho mọi mô hình; không kết luận về lớp hiếm'],
    ['Lệch miền train–test', `${pct(OOV.test.unseen_entity_rate)}% thực thể test chưa gặp (val ${pct(OOV.validation.unseen_entity_rate)}%)`, 'Báo cáo riêng recall thực thể đã gặp / chưa gặp; chọn theo val nhưng không coi val là ước lượng test'],
    ['Chuỗi BIO lỗi', `${bioErr.join(' / ')} lần I- sau O (train / val / test)`, 'Giữ nguyên nhãn gốc để không đổi tập đánh giá chính thức'],
    ['Độ dài câu', `≤ ${Math.max(...SPLITS.map((k) => EDA[k].len_max))} âm tiết; ≤ ${subMax} subword`, `max_length = ${DET.subword_length.max_length}: ${subOver} câu bị cắt`],
    ['Trùng lặp', `${OV.cross_split_exact.validation_in_train.count} câu val trùng train, ${OV.cross_split_exact.test_in_train.count} câu test trùng train`, 'Giữ nguyên các tập'],
    ['Nhãn chưa nhất quán', `${LC.type_conflict.surfaces} chuỗi mang nhiều loại; "${LC.tagged_vs_untagged.ambiguous.examples[0].surface}" ${LC.tagged_vs_untagged.ambiguous.examples[0].tagged} lần có nhãn, ${LC.tagged_vs_untagged.ambiguous.examples[0].untagged} lần không`, 'Không sửa nhãn; coi là nhiễu khi phân tích lỗi đoán thừa / bỏ sót'],
  ], { x: 0.6, y: 1.35, w: 12.15, colW: [2.3, 4.15, 5.7], size: 12, rowH: 0.62 });
  card(s, 0.6, 6.25, 12.15, 0.7, C.goldTint);
  text(s, `**Luật chơi:** siêu tham số và seed chọn **chỉ theo validation**; test chấm một lần; so sánh bằng paired bootstrap (${int(NBOOT)} lần lấy mẫu).`, 0.8, 6.25, 11.8, 0.7, { size: 14, valign: 'middle' });
  source(s, 'eda_findings.json, eda.json, eda_detail.json, data_quality.json, ladder_steps.json (protocol)');
  s.addNotes(`Bảng này nối mỗi phát hiện với một quyết định cụ thể. Vì nhãn O áp đảo, nhóm dùng F1 mức thực thể theo seqeval strict. Vì mất cân bằng, nhóm cân nhắc class weight nhưng không dùng: lớp hiếm chỉ có vài mẫu, nhân trọng số hàng trăm lần sẽ khiến mô hình học thuộc vài chuỗi; và để so sánh công bằng, cả sáu mô hình dùng cùng hàm mục tiêu. Vì lệch miền, nhóm báo cáo riêng khả năng nhận ra thực thể đã gặp và chưa gặp. Các lỗi nhãn nhỏ được giữ nguyên để không thay đổi tập test chính thức. Độ dài câu ngắn nên giới hạn ${DET.subword_length.max_length} subword không cắt câu nào. Luật chơi chung: mọi lựa chọn dựa trên validation, test chỉ chấm một lần, và chênh lệch giữa hai mô hình được kiểm định bằng paired bootstrap. Thời gian: 1 phút 10 giây.`);
}

// ============================================================ 6. Model line-up
{
  const s = base('Sáu mô hình, hai họ, cùng một thước đo', 1);
  const cfg = (b) => `lr ${sci(b.learning_rate)}, ${b.epochs} epoch, wd ${num(b.weight_decay)}`;
  table(s, ['Mô hình', 'Họ', 'Đầu vào', 'Cấu hình chọn theo validation'], [
    ['Logistic Regression', 'Cổ điển, từng âm tiết', 'Đặc trưng thủ công', `C = ${num(bestT('Logistic Regression').C)}`],
    ['Linear SVM', 'Cổ điển, từng âm tiết', 'Đặc trưng thủ công', `C = ${num(bestT('Linear SVM').C)}`],
    ['CRF', 'Cổ điển, cả chuỗi', 'Đặc trưng thủ công', `c1 = ${num(bestT('CRF').c1)}, c2 = ${num(bestT('CRF').c2)}`],
    ['XLM-R', 'Transformer đa ngôn ngữ', 'Subword', `checkpoint của tác giả bộ dữ liệu (${num(SPEED.xlm_roberta_baseline.params_millions, 0)}M tham số)`],
    ['PhoBERT-base-v2', 'Transformer tiếng Việt', 'Subword', `${cfg(SWEEP.PhoBERT.best_config)}`],
    ['ViHealthBERT', 'Transformer tiếng Việt y tế', 'Subword', `${cfg(SWEEP.ViHealthBERT.best_config)} (${num(SPEED.vihealthbert.params_millions, 0)}M)`],
  ], { x: 0.6, y: 1.35, w: 12.15, colW: [2.2, 2.6, 2.05, 5.3], size: 13, rowH: 0.48 });
  [['Cổ điển', 'Âm tiết, tiền tố / hậu tố, cửa sổ ±2 âm tiết, bigram → vector thưa (DictVectorizer).', C.navy, C.tint],
    ['Transformer', 'Âm tiết → subword; nhãn gán cho subword đầu, subword còn lại bỏ qua khi tính loss.', C.teal, C.tealTint],
    ['Thước đo', `seqeval strict: khớp đúng ranh giới và loại. Bootstrap theo cặp: ${STEPS.protocol}.`, C.coral, C.coralTint]].forEach(([h, t, col, fill], i) => {
    const x = 0.6 + i * 4.1;
    card(s, x, 4.95, 3.93, 1.95, fill);
    heading(s, h, x + 0.2, 5.05, 3.55, col, 16);
    text(s, t, x + 0.2, 5.5, 3.55, 1.35, { size: 13 });
  });
  source(s, 'model_comparison.json (classical_training), ket_qua_goc/*_validation_sweep.json (best_config), speed_benchmark.json, ladder_steps.json');
  s.addNotes(`Nhóm huấn luyện sáu mô hình thuộc hai họ. Họ cổ điển gồm Logistic Regression và Linear SVM phân loại từng âm tiết độc lập, và CRF giải mã cả chuỗi; cả ba dùng chung bộ đặc trưng thủ công như âm tiết, tiền tố, hậu tố và cửa sổ hai âm tiết mỗi bên. Họ Transformer gồm XLM-RoBERTa đa ngôn ngữ, dùng checkpoint do tác giả bộ dữ liệu công bố, PhoBERT pretrain trên tiếng Việt và ViHealthBERT pretrain thêm trên văn bản y tế; hai mô hình sau do nhóm tự fine-tune. Cột phải là cấu hình được chọn theo validation. Tất cả được chấm cùng thước đo seqeval strict và so sánh theo cặp bằng bootstrap. Thời gian: 1 phút.`);
}

// ============================================================ 7. LogReg & SVM
{
  const s = base('Mô hình cổ điển: C điều khiển underfit và overfit', 1);
  [['Logistic Regression', '4C72B0', 0.5], ['Linear SVM', 'DD8452', 6.7]].forEach(([m, col, x]) => {
    s.addChart(pres.charts.BAR, [{ name: 'F1 validation', labels: trials(m).map((t) => `C = ${num(t.C)}`), values: trials(m).map((t) => r1(t.val_f1)) }], {
      ...chartBase, x, y: 1.25, w: 6.1, h: 3.5, barDir: 'col', chartColors: [col], title: `${m}: F1 validation (%) theo C`, showLegend: false, showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 10, valAxisMinVal: 60, valAxisMaxVal: 90,
    });
  });
  const lr = trials('Logistic Regression');
  const sv = trials('Linear SVM');
  const st = STEPS.steps[0];
  card(s, 0.6, 4.95, 5.95, 1.95, C.tealTint);
  heading(s, 'Học được', 0.82, 5.05, 5.5, C.teal, 16);
  bullets(s, [`C nhỏ ⇒ **underfit**: LogReg ${pct(lr[0].val_f1, 1)}%, SVM ${pct(sv[0].val_f1, 1)}%; SVM C = ${num(sv[sv.length - 1].C)} tụt về ${pct(sv[sv.length - 1].val_f1, 1)}% (overfit)`,
    `Test: LogReg **${pct(M['Logistic Regression'].test_f1)}%**, SVM **${pct(M['Linear SVM'].test_f1)}%** (Δ ${sgn(st.delta)}, CI95 ${ci(st.ci95)})`], 0.82, 5.45, 5.55, 1.4, 13.5);
  card(s, 6.8, 4.95, 5.95, 1.95, C.coralTint);
  heading(s, 'Còn thiếu', 7.02, 5.05, 5.5, C.coral, 16);
  bullets(s, [`Không biết nhãn bên cạnh ⇒ **${int(INV['Logistic Regression'])}** / **${int(INV['Linear SVM'])}** chuyển nhãn BIO vô lý trên test`,
    `Thực thể chưa gặp: chỉ nhận ra ${pct(M['Logistic Regression'].recall_unseen, 1)}% / ${pct(M['Linear SVM'].recall_unseen, 1)}%`], 7.02, 5.45, 5.55, 1.4, 13.5);
  source(s, 'model_comparison.json (classical_training, models), ladder_steps.json; số chuyển nhãn vô lý đếm từ test_predictions.json');
  s.addNotes(`Hai mô hình đầu phân loại từng âm tiết độc lập. Biểu đồ dò hệ số C trên validation minh hoạ rõ đánh đổi bias – variance: C nhỏ là regularization mạnh, mô hình underfit, chỉ ${rng([trials('Logistic Regression')[0].val_f1, trials('Linear SVM')[0].val_f1], 1)}%; C quá lớn thì SVM bắt đầu overfit và giảm lại. Cấu hình tốt nhất đạt khoảng ${pct(bestT('Logistic Regression').val_f1, 0)} đến ${pct(bestT('Linear SVM').val_f1, 0)}% trên validation. Trên test, SVM hơn Logistic Regression ${pct(st.delta)} điểm, khoảng tin cậy không chứa 0. Nhưng cả hai có một điểm yếu cấu trúc: không biết nhãn của âm tiết bên cạnh, nên sinh ra hơn một nghìn lần chuyển nhãn vô lý như I- đứng sau O, và gần như không nhận ra thực thể chưa gặp. Đó là lý do chuyển sang CRF. Thời gian: 1 phút.`);
}

// ============================================================ 8. CRF
{
  const s = base('CRF: mô hình hoá chuỗi thắng lớn, nhưng nhờ ghi nhớ', 1);
  const ct = trials('CRF');
  const c1s = [...new Set(ct.map((t) => t.c1))];
  const c2s = [...new Set(ct.map((t) => t.c2))];
  s.addChart(pres.charts.BAR, c1s.map((c1) => ({ name: `c1 = ${num(c1)}`, labels: c2s.map((c2) => `c2 = ${num(c2)}`), values: c2s.map((c2) => r1(ct.find((t) => t.c1 === c1 && t.c2 === c2).val_f1)) })), {
    ...chartBase, x: 0.5, y: 1.25, w: 5.7, h: 3.6, barDir: 'col', barGrouping: 'clustered', chartColors: SERIES, title: 'Lưới c1 × c2: F1 validation (%)', valAxisMinVal: 80, valAxisMaxVal: 92, showValue: false,
  });
  const LCv = MC.crf_learning_curve;
  s.addChart(pres.charts.LINE, [['train_f1', 'train'], ['validation_f1', 'validation'], ['test_f1', 'test']].map(([k, n]) => ({ name: n, labels: LCv.map((p) => int(p.sentences)), values: LCv.map((p) => r1(p[k])) })), {
    ...chartBase, x: 6.4, y: 1.25, w: 6.4, h: 3.6, chartColors: SERIES, title: 'Đường cong học: F1 (%) theo số câu train', lineSize: 2.5, lineDataSymbolSize: 7, valAxisMinVal: 30, valAxisMaxVal: 100, showValue: true, dataLabelFontSize: 8.5, dataLabelPosition: 't',
  });
  const st = STEPS.steps[1];
  kpi(s, `${pct(M.CRF.test_f1)}%`, `F1 test, cao nhất cả sáu mô hình · CI95 ${pct(M.CRF.test_f1_ci95[0], 1)}–${pct(M.CRF.test_f1_ci95[1], 1)}`, 0.6, 5.05, 3.0, 1.85, C.navy);
  kpi(s, sgn(st.delta), `so với Linear SVM · CI95 ${ci(st.ci95)}; chuyển nhãn vô lý còn ${INV.CRF}`, 3.75, 5.05, 3.0, 1.85, C.teal, C.tealTint);
  card(s, 6.9, 5.05, 5.85, 1.85, C.coralTint);
  heading(s, 'Dấu hiệu ghi nhớ', 7.1, 5.12, 5.5, C.coral, 15);
  bullets(s, [`Train F1 ≈ **${pct(M.CRF.train_f1, 1)}%** ở mọi cỡ dữ liệu`, `Recall thực thể đã gặp **${pct(M.CRF.recall_seen, 1)}%**, chưa gặp chỉ **${pct(M.CRF.recall_unseen, 1)}%**`, `Test vẫn tăng theo dữ liệu (${pct(LCv[0].test_f1, 1)}% → ${pct(LCv[LCv.length - 1].test_f1, 1)}%)`], 7.1, 5.5, 5.5, 1.4, 13);
  source(s, 'model_comparison.json (classical_training.CRF, crf_learning_curve, models.CRF), ladder_steps.json');
  s.addNotes(`CRF học thêm xác suất chuyển giữa các nhãn liền kề và giải mã cả câu cùng lúc. Lưới c1, c2 bên trái cho thấy regularization L2 mạnh, c2 bằng 1, làm giảm điểm rõ rệt; cấu hình tốt nhất là c1 = ${num(bestT('CRF').c1)}, c2 = ${num(bestT('CRF').c2)}. Với cùng đặc trưng, F1 test tăng ${pct(st.delta)} điểm so với SVM lên ${pct(M.CRF.test_f1)}%, và cuối cùng đây là mô hình cao nhất trong cả sáu. Số chuyển nhãn vô lý giảm từ hơn một nghìn xuống ${INV.CRF}. Nhưng đường cong học bên phải cho thấy train F1 gần 100% ở mọi cỡ dữ liệu: CRF ghi nhớ. Khi tách thực thể test, nó nhận ra ${pct(M.CRF.recall_seen, 0)}% thực thể đã gặp nhưng chỉ ${pct(M.CRF.recall_unseen, 0)}% thực thể mới. Đường test vẫn còn đi lên, nên thêm dữ liệu cùng loại có thể còn giúp. Thời gian: 1 phút 10 giây.`);
}

// ============================================================ 9. Transformer sweeps
{
  const s = base('Transformer: learning rate nhỏ và ít epoch gây underfit', 1);
  image(s, 'fig_sweep_underfitting.png', 0.5, 1.3, 8.2, 3.1);
  const lowP = sweepLow('PhoBERT');
  const lowV = sweepLow('ViHealthBERT');
  card(s, 8.95, 1.3, 3.8, 3.1, C.tint);
  heading(s, 'Lưới dò', 9.15, 1.4, 3.4, C.navy, 16);
  bullets(s, [`${SWEEP.PhoBERT.trials.length} cấu hình mỗi mô hình: lr × epoch × weight decay`,
    `Tệ nhất: PhoBERT lr ${sci(lowP.learning_rate)}, ${lowP.epochs} epoch → **${pct(lowP.validation.eval_f1, 1)}%**; ViHealthBERT → ${pct(lowV.validation.eval_f1, 1)}%`,
    'Tốt nhất ở **góc biên** lưới (lr lớn nhất, nhiều epoch nhất) ⇒ lưới có thể chưa đủ rộng'], 9.15, 1.85, 3.45, 2.5, 13);
  card(s, 0.6, 4.6, 12.15, 1.0, C.goldTint);
  text(s, '**Lưu ý:** F1 validation trong hình được chấm trước khi nhóm phát hiện lỗi nhãn "0" (slide 11) nên lệch vài điểm; dùng để đọc **xu hướng** underfit, không so trực tiếp với số đã sửa.', 0.8, 4.6, 11.8, 1.0, { size: 14, valign: 'middle' });
  const H = CURVE.history;
  kpi(s, `${pct(M['XLM-R'].test_f1)}%`, 'XLM-R test F1 (không fine-tune lại)', 0.6, 5.8, 3.9, 1.1, C.muted);
  kpi(s, `${pct(M.PhoBERT.test_f1)}%`, `PhoBERT test F1 · val ${pct(M.PhoBERT.val_f1, 1)}%`, 4.7, 5.8, 3.9, 1.1, C.teal);
  kpi(s, `${pct(M.ViHealthBERT.test_f1)}%`, `ViHealthBERT test F1 · val ${pct(M.ViHealthBERT.val_f1, 1)}%`, 8.8, 5.8, 3.95, 1.1, C.coral);
  source(s, `ket_qua_goc/phobert_validation_sweep.json, vihealthbert_validation_sweep.json; model_comparison.json (models); ${H.length} epoch curve ở slide sau`);
  s.addNotes(`Với hai Transformer do nhóm fine-tune, nhóm dò ${SWEEP.PhoBERT.trials.length} cấu hình gồm learning rate, số epoch và weight decay. Hình cho thấy F1 validation tăng đều theo learning rate và số epoch: với learning rate ${sci(lowP.learning_rate)} và ${lowP.epochs} epoch, PhoBERT chỉ đạt ${pct(lowP.validation.eval_f1, 1)}%, tức mô hình chưa học đủ, underfitting. Cấu hình tốt nhất nằm ở góc biên của lưới, nên có thể lưới chưa đủ rộng; đây là một hạn chế nhóm ghi nhận. Một lưu ý trung thực: các số trong hình được chấm trước khi nhóm phát hiện lỗi nhãn "0" mà em sẽ trình bày ngay sau đây, nên chỉ dùng để đọc xu hướng. Sau khi chấm lại đúng, PhoBERT đạt ${pct(M.PhoBERT.test_f1)}% và ViHealthBERT ${pct(M.ViHealthBERT.test_f1)}% trên test. Thời gian: 1 phút.`);
}

// ============================================================ 10. Epoch curve
{
  const s = base('ViHealthBERT: underfit ở epoch 1, overfit nhẹ về sau', 1);
  const H = CURVE.history;
  const labels = H.map((h) => `E${h.epoch}`);
  s.addChart(pres.charts.LINE, [{ name: 'train', labels, values: H.map((h) => r1(h.train_f1)) }, { name: 'validation', labels, values: H.map((h) => r1(h.validation_f1)) }], {
    ...chartBase, x: 0.5, y: 1.25, w: 6.2, h: 3.9, chartColors: SERIES.slice(0, 2), title: 'ViHealthBERT: F1 (%) theo epoch', lineSize: 2.5, lineDataSymbolSize: 7, valAxisMinVal: 50, valAxisMaxVal: 100,
  });
  s.addChart(pres.charts.LINE, [{ name: 'train', labels, values: H.map((h) => +h.train_loss.toFixed(3)) }, { name: 'validation', labels, values: H.map((h) => +h.validation_loss.toFixed(3)) }], {
    ...chartBase, x: 6.85, y: 1.25, w: 5.95, h: 3.9, chartColors: SERIES.slice(0, 2), title: 'ViHealthBERT: loss theo epoch', lineSize: 2.5, lineDataSymbolSize: 7, valAxisMinVal: 0, valAxisLabelFormatCode: '0.0',
  });
  const last = H[H.length - 1];
  const gap = (m) => pct(M[m].train_f1 - M[m].val_f1, 1);
  [['Underfitting', `Epoch 1: train ${pct(H[0].train_f1, 1)}%, val ${pct(H[0].validation_f1, 1)}% — cả hai đều thấp.`, C.gold, C.goldTint],
    ['Overfitting nhẹ', `Epoch ${H[4].epoch}→${last.epoch}: train loss ${num(H[4].train_loss, 3)} → ${num(last.train_loss, 3)}, val loss đi ngang (${num(H[4].validation_loss, 3)} → ${num(last.validation_loss, 3)}).`, C.coral, C.coralTint],
    ['Khoảng cách', `Train − val: CRF ${gap('CRF')}, PhoBERT ${gap('PhoBERT')}, ViHealthBERT ${gap('ViHealthBERT')} điểm; val → test mất nhiều hơn ⇒ **lệch miền**.`, C.teal, C.tealTint]].forEach(([h, t, col, fill], i) => {
    const x = 0.6 + i * 4.1;
    card(s, x, 5.3, 3.93, 1.6, fill);
    heading(s, h, x + 0.2, 5.38, 3.55, col, 15);
    text(s, t, x + 0.2, 5.78, 3.55, 1.1, { size: 12.5 });
  });
  source(s, `vihealthbert_epoch_curve.json (lr ${sci(CURVE.config.lr)}, wd ${num(CURVE.config.weight_decay)}, seed ${CURVE.config.seed}), model_comparison.json`);
  s.addNotes(`Để trả lời câu hỏi overfit hay underfit, nhóm huấn luyện lại ViHealthBERT và chấm cả train lẫn validation sau mỗi epoch. Ở epoch 1, cả hai đều thấp, khoảng ${pct(H[0].train_f1, 0)}% và ${pct(H[0].validation_f1, 0)}%: underfitting. Từ epoch 2 đến 5, hai đường cùng tăng nhanh. Từ epoch 5 trở đi, train loss tiếp tục giảm còn validation loss đi ngang, train F1 lên ${pct(last.train_f1, 1)}% trong khi validation dừng quanh ${pct(last.validation_f1, 0)}%: overfitting nhẹ. Tuy nhiên khoảng cách giữa validation và test, ${rng(ORDER.map((m) => M[m].val_f1 - M[m].test_f1))} điểm, lớn hơn nhiều khoảng cách train – validation. Vì vậy nguyên nhân chính làm giảm điểm test không phải overfit mà là lệch miền đã thấy ở EDA. Thời gian: 1 phút.`);
}

// ============================================================ 11. Scoring bug
{
  const s = base('Lỗi chúng tôi tự tìm ra: nhãn "0" bị chấm như thực thể', 2);
  card(s, 0.6, 1.35, 5.6, 3.3, C.coralTint);
  heading(s, 'Chuyện gì đã xảy ra', 0.82, 1.45, 5.2, C.coral, 16);
  bullets(s, ['VietMed-NER ghi nhãn ngoài thực thể là **"0"** (số không), không phải **"O"**',
    'seqeval coi mỗi đoạn "0" là một **thực thể giả loại "_"** và tính vào micro P/R/F1',
    `Trên test: **${int(fakeSupport)}** thực thể giả + ${int(EDA.test.entity_total)} thực thể thật = ${int(oldSupport)}`,
    'Validation dùng để chọn cấu hình, epoch và seed cũng bị ảnh hưởng'], 0.82, 1.9, 5.25, 2.7, 13.5);
  s.addChart(pres.charts.BAR, [
    { name: 'Chấm cũ (có "_")', labels: OLD_ROWS.map(([m]) => m), values: OLD_ROWS.map(([, o]) => r1(o.f1)) },
    { name: 'Chấm đúng (18 loại thật)', labels: OLD_ROWS.map(([m]) => m), values: OLD_ROWS.map(([m]) => r1(M[m].test_f1)) },
  ], { ...chartBase, x: 6.4, y: 1.25, w: 6.4, h: 3.5, barDir: 'col', barGrouping: 'clustered', chartColors: ['A8B5C0', C.coral], title: 'Micro F1 test (%) trên cùng checkpoint', showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 11, valAxisMinVal: 50, valAxisMaxVal: 66, dataLabelFormatCode: '0.0' });
  kpi(s, `${sgn(oldDelta)} → ${sgn(PV.delta)}`, 'ViHealthBERT − PhoBERT: số cũ nói "hơn", số đúng kèm CI95', 0.6, 4.9, 4.0, 1.95, C.navy);
  kpi(s, ci(PV.ci95), 'CI95 chứa 0 ⇒ **chênh lệch không phân biệt được với 0**', 4.75, 4.9, 3.85, 1.95, C.coral, C.coralTint);
  card(s, 8.75, 4.9, 4.0, 1.95, C.tealTint);
  heading(s, 'Cách sửa', 8.95, 5.0, 3.7, C.teal, 15);
  bullets(s, ['Đổi "0" → "O" trước khi dựng label2id, huấn luyện và chấm', 'Chấm lại checkpoint cũ; chạy lại 3 seed (slide 13)'], 8.95, 5.4, 3.7, 1.45, 12.5);
  source(s, 'giai_doan_15_ner_finetune_vihealthbert/ketqua/ner_gold_comparison.json (số cũ), model_comparison.json (số đúng, pairs); đính chính trong FINAL_RESULTS.md / README.md');
  s.addNotes(`Đây là phần nhóm muốn nhấn mạnh nhất về quy trình. Bộ dữ liệu ghi nhãn "ngoài thực thể" bằng ký tự số không, chứ không phải chữ O. Thư viện seqeval không nhận ra điều đó, nên coi mỗi đoạn số không là một thực thể giả thuộc loại gạch dưới, và cộng cả vào micro F1. Trên test có ${int(fakeSupport)} thực thể giả như vậy, gần bằng số thực thể thật. Kết quả là các số cũ, ví dụ PhoBERT ${pct(OLD.phobert_best_validation_seed.f1)}% và ViHealthBERT ${pct(OLD.vihealthbert_best_validation_seed.f1)}%, đều bị lệch. Sau khi đổi số không thành O và chấm lại trên cùng checkpoint, cả ba Transformer đều tăng ${rng(OLD_ROWS.map(([m, o]) => M[m].test_f1 - o.f1), 1)} điểm. Quan trọng hơn là kết luận: số cũ nói ViHealthBERT hơn PhoBERT ${pct(oldDelta)} điểm; số đúng là ${pct(PV.delta)} điểm với khoảng tin cậy từ ${sgn(PV.ci95[0])} đến ${sgn(PV.ci95[1])}, chứa 0, tức chênh lệch không phân biệt được với 0; đây không phải phép kiểm định tương đương, nên nhóm không nói mô hình nào tốt hơn. Bài học: phải kiểm tra tập nhãn trước khi tin vào thước đo. Thời gian: 1 phút 15 giây.`);
}

// ============================================================ 12. Results table
{
  const s = base('Kết quả: CRF cao nhất theo F1 strict', 2);
  const crfIdx = ORDER.indexOf('CRF');
  table(s, ['Mô hình', 'Precision', 'Recall', 'F1 test', 'CI95 F1', 'Macro F1', 'F1 val'], ORDER.map((m) => [m, pct(M[m].test_precision, 1), pct(M[m].test_recall, 1), pct(M[m].test_f1), `${pct(M[m].test_f1_ci95[0], 1)}–${pct(M[m].test_f1_ci95[1], 1)}`, pct(M[m].test_macro_f1, 1), pct(M[m].val_f1, 1)]),
    { x: 0.6, y: 1.35, w: 7.6, colW: [1.9, 0.95, 0.85, 0.95, 1.2, 0.95, 0.8], size: 13, highlight: crfIdx, rowH: 0.5 });
  s.addChart(pres.charts.BAR, [['val_f1', 'validation'], ['test_f1', 'test']].map(([k, n]) => ({ name: n, labels: ORDER.map((m) => SHORT[m]), values: ORDER.map((m) => r1(M[m][k])) })), {
    ...chartBase, x: 8.4, y: 1.25, w: 4.45, h: 3.5, barDir: 'col', barGrouping: 'clustered', chartColors: ['A8B5C0', C.navy], title: 'F1 (%): validation vs test', valAxisMinVal: 0, valAxisMaxVal: 100, catAxisLabelFontSize: 8.5, catAxisLabelRotate: -30,
  });
  card(s, 0.6, 5.1, 12.15, 1.8, C.tint);
  bullets(s, [`**CRF** dẫn đầu nhờ **precision ${pct(M.CRF.test_precision, 1)}%**; Transformer có recall cao hơn nhưng đoán thừa (precision ${pct(Math.min(...TR.map((m) => M[m].test_precision)), 1)}–${pct(Math.max(...TR.map((m) => M[m].test_precision)), 1)}%)`,
    `Mọi mô hình mất **${pct(Math.min(...ORDER.map((m) => M[m].val_f1 - M[m].test_f1)), 0)}–${pct(Math.max(...ORDER.map((m) => M[m].val_f1 - M[m].test_f1)), 0)} điểm** từ validation sang test ⇒ lệch miền là giới hạn chung`,
    `Macro F1 thấp hơn micro vì các lớp khó / hiếm kéo xuống (slide 15)`], 0.82, 5.2, 11.8, 1.65, 14);
  source(s, 'model_comparison.json (models: test_precision, test_recall, test_f1, test_f1_ci95, test_macro_f1, val_f1)');
  s.addNotes(`Đây là bảng kết quả cuối cùng sau khi chấm đúng. CRF đạt F1 test cao nhất, ${pct(M.CRF.test_f1)}%, chủ yếu nhờ precision cao nhất: nó ít đoán thừa. Ba Transformer có recall cao hơn nhưng precision thấp hơn nhiều, tức nhận ra nhiều thực thể hơn nhưng cũng đoán thừa và cắt sai ranh giới. Biểu đồ bên phải cho thấy một điều chung cho tất cả: F1 validation từ ${rng(ORDER.map((m) => M[m].val_f1))}%, nhưng xuống còn ${rng(ORDER.map((m) => M[m].test_f1))}% trên test. Khoảng cách ${rng(ORDER.map((m) => M[m].val_f1 - M[m].test_f1))} điểm này xuất hiện ở mọi mô hình, nên nó đến từ dữ liệu, cụ thể là lệch miền, chứ không phải từ việc chọn mô hình. Cột khoảng tin cậy cho thấy chênh lệch nhỏ giữa các Transformer cần được kiểm định, là nội dung slide tiếp theo. Thời gian: 1 phút.`);
}

// ============================================================ 13. Bootstrap & seeds
{
  const s = base('CRF hơn ~1 điểm; hai BERT tiếng Việt chưa tách được', 2);
  const pairRows = Object.entries(MC.pairs).map(([k, p]) => [k.replace('Logistic Regression', 'LogReg'), sgn(p.delta), ci(p.ci95), p.ci95[0] > 0 || p.ci95[1] < 0 ? 'CI không chứa 0' : 'Không phân biệt được với 0']);
  const tieIdx = pairRows.findIndex((r) => r[3] === 'Không phân biệt được với 0');
  table(s, ['Cặp (A − B)', 'Δ F1', 'CI95 bootstrap', 'Kết luận'], pairRows, { x: 0.6, y: 1.35, w: 6.6, colW: [2.25, 0.8, 1.6, 1.95], size: 12, highlight: tieIdx, rowH: 0.45 });
  card(s, 0.6, 4.75, 6.6, 2.15, C.goldTint);
  heading(s, 'Chạy lại 3 seed với cách chấm đúng', 0.82, 4.85, 6.2, C.navy, 15);
  table(s, ['Mô hình', 'Micro F1 (mean ± std)', 'Macro F1'], ['PhoBERT', 'ViHealthBERT'].map((m) => [m, ms(AGG[m].baseline.micro_f1), ms(AGG[m].baseline.macro_f1)]),
    { x: 0.82, y: 5.3, w: 6.15, colW: [1.9, 2.4, 1.85], size: 12.5, rowH: 0.4 });
  text(s, `Seed ${SEEDS}: chênh lệch trung bình nhỏ hơn độ dao động giữa các seed.`, 0.82, 6.5, 6.2, 0.35, { size: 11.5, italic: true, color: C.muted });
  const med = Object.keys(M.ViHealthBERT.per_type_f1).map((t) => [t, M.ViHealthBERT.per_type_f1[t] - M.PhoBERT.per_type_f1[t]]).filter(([, d]) => Math.abs(d) >= 0.02).sort((a, b) => b[1] - a[1]);
  s.addChart(pres.charts.BAR, [{ name: 'Δ F1 (điểm)', labels: med.map(([t]) => t), values: med.map(([, d]) => +(d * 100).toFixed(1)) }], {
    ...chartBase, x: 7.4, y: 1.25, w: 5.4, h: 4.3, barDir: 'bar', chartColors: [C.teal], title: 'ViHealthBERT − PhoBERT theo loại (điểm)', showLegend: false, showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 9, catAxisLabelFontSize: 9, catAxisOrientation: 'maxMin', catAxisLabelPos: 'low',
  });
  text(s, 'Pretrain y tế tăng ở vài loại y khoa nhưng giảm ở loại khác; tổng thể bù trừ nhau.', 7.5, 5.7, 5.2, 0.9, { size: 13 });
  source(s, 'model_comparison.json (pairs, per_type_f1); experiments/004-vi-ner-intermediate-finetune/results/*/aggregate.json (baseline)');
  s.addNotes(`Để biết chênh lệch có thật hay không, nhóm dùng paired bootstrap trên tập test. CRF hơn cả PhoBERT và ViHealthBERT, và khoảng tin cậy không chứa 0, nên chênh lệch có ý nghĩa thống kê, dù chỉ khoảng một điểm. Giữa ViHealthBERT và PhoBERT, chênh lệch ${pct(PV.delta)} điểm với khoảng tin cậy chứa 0: chênh lệch không phân biệt được với 0. Đây không phải phép kiểm định tương đương, nên nhóm chỉ nói rằng chưa tách được hai mô hình. Kết quả chạy lại ba seed với cách chấm đúng củng cố điều này: PhoBERT ${ms(AGG.PhoBERT.baseline.micro_f1)} và ViHealthBERT ${ms(AGG.ViHealthBERT.baseline.micro_f1)}, chênh lệch nhỏ hơn độ dao động giữa các seed. Biểu đồ bên phải cho thấy pretrain y tế giúp một số loại nhưng làm giảm loại khác, nên tổng thể bù trừ nhau. Thời gian: 1 phút.`);
}

// ============================================================ 14. Seen vs unseen
{
  const s = base(`Thực thể mới: ViHealthBERT nhận ra gấp ${num(M.ViHealthBERT.recall_unseen / M.CRF.recall_unseen, 1)} lần CRF`, 2);
  s.addChart(pres.charts.BAR, [['recall_seen', 'Đã gặp trong train'], ['recall_unseen', 'Chưa gặp trong train']].map(([k, n]) => ({ name: n, labels: ORDER.map((m) => SHORT[m]), values: ORDER.map((m) => r1(M[m][k])) })), {
    ...chartBase, x: 0.5, y: 1.25, w: 7.6, h: 4.4, barDir: 'col', barGrouping: 'clustered', chartColors: ['4C72B0', C.coral], title: 'Recall trên test (%)', showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 9, valAxisMaxVal: 100, valAxisMinVal: 0,
  });
  card(s, 0.6, 5.8, 7.4, 1.1, C.tint);
  text(s, `Test có **${int(EDA.test.entity_total - unseenTest)}** thực thể đã gặp và **${int(unseenTest)}** chưa gặp (${pct(OOV.test.unseen_entity_rate, 1)}%). Phần lớn đã gặp ⇒ ghi nhớ vẫn đủ để CRF dẫn đầu F1 tổng.`, 0.8, 5.8, 7.0, 1.1, { size: 13.5, valign: 'middle' });
  const cl = ['Logistic Regression', 'Linear SVM', 'CRF'].map((m) => M[m].recall_unseen);
  const tr = ['XLM-R', 'PhoBERT', 'ViHealthBERT'].map((m) => M[m].recall_unseen);
  kpi(s, `${pct(Math.min(...cl), 1)}–${pct(Math.max(...cl), 1)}%`, 'Cổ điển: recall thực thể chưa gặp', 8.4, 1.3, 4.35, 1.3, C.navy);
  kpi(s, `${pct(Math.min(...tr), 1)}–${pct(Math.max(...tr), 1)}%`, 'Transformer: recall thực thể chưa gặp', 8.4, 2.75, 4.35, 1.3, C.coral, C.coralTint);
  card(s, 8.4, 4.2, 4.35, 2.7, C.goldTint);
  heading(s, 'Chọn mô hình theo dữ liệu', 8.6, 4.3, 4.0, C.navy, 15);
  bullets(s, ['Thuật ngữ lặp lại như train → **CRF**: rẻ, chính xác nhất theo strict', 'Chủ đề bệnh mới → **Transformer** tổng quát hoá tốt hơn'], 8.6, 4.75, 4.0, 2.1, 13.5);
  source(s, 'model_comparison.json (recall_seen, recall_unseen), data_quality.json (oov.test.unseen_entity_rate), eda.json');
  s.addNotes(`Vì sao CRF thắng mà vẫn đáng lo? Nhóm tách thực thể test theo việc đã xuất hiện trong train hay chưa. Với thực thể đã gặp, sáu mô hình khá gần nhau, từ ${rng(ORDER.map((m) => M[m].recall_seen))}%. Với thực thể chưa gặp, ba mô hình cổ điển chỉ nhận ra ${pct(Math.min(...cl), 0)} đến ${pct(Math.max(...cl), 0)}%, trong khi ba Transformer nhận ra ${pct(Math.min(...tr), 0)} đến ${pct(Math.max(...tr), 0)}%, gần gấp ba CRF. Nhưng vì khoảng ${pct(1 - OOV.test.unseen_entity_rate, 0)}% thực thể test là thực thể đã gặp, lợi thế ghi nhớ vẫn đủ để CRF dẫn đầu F1 tổng. Kết luận thực tế: nếu dữ liệu sử dụng lặp lại thuật ngữ như lúc huấn luyện thì CRF là lựa chọn rẻ và chính xác; nếu gặp chủ đề bệnh mới thì Transformer an toàn hơn. Thời gian: 1 phút.`);
}

// ============================================================ 15. Per-type F1
{
  const s = base('F1 theo loại: lớp khó và lớp hiếm kéo điểm xuống', 2);
  image(s, 'fig_per_type_f1_test.png', 0.4, 1.3, 12.5, 3.7);
  const worst = Object.entries(M.CRF.per_type_f1).sort((a, b) => a[1] - b[1]).slice(0, 3);
  card(s, 0.6, 5.2, 6.0, 1.7, C.tint);
  heading(s, 'Khó với mọi mô hình', 0.82, 5.28, 5.6, C.navy, 15);
  bullets(s, [`CRF thấp nhất: ${worst.map(([t, v]) => `${t} ${pct(v, 0)}%`).join(', ')}`,
    `PREVENTIVEMED: ${CD.PREVENTIVEMED.train} mẫu train nhưng chỉ ${CD.PREVENTIVEMED.test} mẫu test`], 0.82, 5.7, 5.6, 1.2, 13);
  card(s, 6.75, 5.2, 6.0, 1.7, C.coralTint);
  heading(s, 'Không kết luận về lớp hiếm', 6.97, 5.28, 5.6, C.coral, 15);
  bullets(s, DET.class_distribution.rare_types.map((t) => `${t}: ${CD[t].train} mẫu train, ${CD[t].test} mẫu test; F1 PhoBERT / ViHealthBERT = ${pct(M.PhoBERT.per_type_f1[t], 0)} / ${pct(M.ViHealthBERT.per_type_f1[t], 0)}%`), 6.97, 5.7, 5.6, 1.2, 13);
  source(s, 'fig_per_type_f1_test.png và model_comparison.json (per_type_f1), eda_detail.json (class_distribution)');
  s.addNotes(`Bảng nhiệt thể hiện F1 theo từng loại thực thể của sáu mô hình. Nghề nghiệp, thuốc – hoá chất, ngày giờ đạt cao ở mọi mô hình. Ngược lại, thiết bị – kỹ thuật, dự phòng, tổ chức thấp ở tất cả. Thiết bị – kỹ thuật khó vì ${pct(DET.per_type_shift.per_type.MEDDEVICETECHNIQUE.test_unseen_rate, 0)}% thực thể test của nó chưa gặp trong train. Với dự phòng, train có ${CD.PREVENTIVEMED.train} mẫu nhưng test chỉ có ${CD.PREVENTIVEMED.test}, nên điểm dao động mạnh. Với hai lớp hiếm, ORGANIZATION và TRANSPORTATION, PhoBERT và ViHealthBERT đạt F1 cao nhất chỉ ${pct(Math.max(...['PhoBERT', 'ViHealthBERT'].flatMap((m) => DET.class_distribution.rare_types.map((t) => M[m].per_type_f1[t]))), 0)}%; nhưng vì train chỉ có ${CD.ORGANIZATION.train} và ${CD.TRANSPORTATION.train} mẫu, nhóm không rút ra kết luận nào về mô hình từ hai lớp này. Thời gian: 1 phút.`);
}

// ============================================================ 16. Error types
{
  const s = base('Lỗi còn lại: lệch ranh giới và đoán thừa, ít sai loại', 2);
  const CL = CONF.labels;
  const CM = CONF.matrices.ViHealthBERT;
  const top = CL.filter((l) => l !== 'O').sort((a, b) => EDA.test.entity_spans[b] - EDA.test.entity_spans[a]).slice(0, 7);
  const keep = ['O', ...top];
  const rowN = (l) => { const r = CM[CL.indexOf(l)]; const tot = r.reduce((a, b) => a + b, 0); return (c) => r[CL.indexOf(c)] / tot; };
  const heat = (v) => { const t = Math.min(1, v); const mix = (a, b) => Math.round(a + (b - a) * t); return [mix(0xFF, 0x0F), mix(0xFF, 0x2A), mix(0xFF, 0x3D)].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase(); };
  const abbr = (l) => l.slice(0, 7);
  const hdr = [{ text: 'Vàng ↓ / Dự đoán →', options: { bold: true, fontSize: 9, color: C.white, fill: { color: C.navy } } },
    ...keep.map((c) => ({ text: abbr(c), options: { bold: true, fontSize: 9, color: C.white, fill: { color: C.navy }, align: 'center' } }))];
  const body = keep.map((g) => { const f = rowN(g); return [{ text: abbr(g), options: { bold: true, fontSize: 10, color: C.ink, fill: { color: 'F7FAFB' } } },
    ...keep.map((c) => { const v = f(c); return { text: pct(v, 0), options: { fontSize: 12, bold: g === c, align: 'center', color: v > 0.45 ? C.white : C.ink, fill: { color: heat(v) } } }; })]; });
  s.addTable([hdr, ...body], { x: 0.6, y: 1.35, w: 5.9, colW: [1.1, ...keep.map(() => 4.8 / keep.length)], rowH: 0.5, fontFace: BODY, border: { type: 'solid', pt: 0.5, color: C.line }, margin: [1, 2, 1, 2] });
  text(s, `Confusion mức token của ViHealthBERT trên test, % theo hàng; ${keep.length - 1} loại nhiều nhất + O (đủ ${CL.length - 1} loại trong báo cáo).`, 0.6, 6.0, 5.9, 0.6, { size: 11, italic: true, color: C.muted });
  const offDiag = top.flatMap((g) => top.filter((c) => c !== g).map((c) => [g, c, rowN(g)(c)])).sort((a, b) => b[2] - a[2])[0];
  const toO = top.map((g) => [g, rowN(g)('O')]).sort((a, b) => b[1] - a[1])[0];
  const so = (m) => M[m].span_outcomes;
  table(s, ['Mô hình', 'Khớp', 'Lệch biên', 'Sai loại', 'Bỏ sót', 'Thừa'], ORDER.map((m) => [SHORT[m], int(so(m).exact), int(so(m).boundary), int(so(m).wrong_type), int(so(m).missed), int(so(m).spurious)]),
    { x: 6.7, y: 1.35, w: 6.05, colW: [1.45, 0.9, 1.0, 0.9, 0.9, 0.9], size: 12, rowH: 0.42, highlight: ORDER.indexOf('CRF') });
  card(s, 6.7, 4.55, 6.05, 2.35, C.tealTint);
  heading(s, 'Đọc bảng', 6.92, 4.65, 5.6, C.teal, 15);
  bullets(s, [`Transformer bỏ sót ít hơn (${int(so('ViHealthBERT').missed)} so với CRF ${int(so('CRF').missed)}) nhưng đoán thừa nhiều hơn (${int(so('ViHealthBERT').spurious)} so với ${int(so('CRF').spurious)})`,
    `Sai loại chỉ ${int(Math.min(...ORDER.map((m) => so(m).wrong_type)))}–${int(Math.max(...ORDER.map((m) => so(m).wrong_type)))} thực thể ⇒ vấn đề chính là **ranh giới**`,
    'Hướng tự nhiên: BERT-CRF (chưa thực hiện)'], 6.92, 5.05, 5.65, 1.8, 13);
  source(s, 'model_comparison.json (span_outcomes), confusion_all_models.json (ViHealthBERT, chuẩn hoá theo hàng)');
  s.addNotes(`Nhóm phân loại lỗi ở mức thực thể thành năm nhóm: khớp chính xác, lệch ranh giới, sai loại, bỏ sót và đoán thừa. Transformer bỏ sót ít hơn nhiều so với CRF, nhưng đoán thừa gần gấp đôi. Số thực thể bị sai loại rất ít ở mọi mô hình, nên vấn đề chính không phải nhầm loại mà là xác định ranh giới và đoán thừa. Confusion matrix bên trái là của ViHealthBERT ở mức token, chuẩn hoá theo hàng, chỉ giữ ${keep.length - 1} loại nhiều nhất cho dễ đọc. Nhầm lẫn lớn nhất là giữa thực thể và nhãn O, ví dụ ${pct(toO[1], 0)}% token ${toO[0]} bị đoán thành O; giữa hai loại, lớn nhất là ${offDiag[0]} bị đoán thành ${offDiag[1]}, ${pct(offDiag[2], 0)}%. Đây chính là loại lỗi mà lớp CRF xử lý tốt, nên hướng tự nhiên tiếp theo là BERT-CRF; nhóm chưa thực hiện hướng này. Thời gian: 50 giây.`);
}

// ============================================================ 17. Vi-Ner intermediate fine-tune
{
  const s = base('Thử thêm 1: học Vi-Ner trước không tăng F1 tổng', 3);
  const TCv = VN.type_coverage;
  card(s, 0.6, 1.35, 5.1, 2.1, C.tint);
  heading(s, 'Ý tưởng', 0.82, 1.45, 4.7, C.navy, 15);
  bullets(s, [`Vi-Ner (văn bản viết): ORGANIZATION ${int(TCv.ORGANIZATION.vi_ner_train)} so với ${TCv.ORGANIZATION.vietmed_train}; LOCATION ${int(TCv.LOCATION.vi_ner_train)} so với ${TCv.LOCATION.vietmed_train}`,
    'Bước 1 học Vi-Ner (viết thường, bỏ dấu câu) → bước 2 thay đầu 18 loại, học VietMed-NER'], 0.82, 1.85, 4.75, 1.6, 12.5);
  const row = (m) => {
    const b = AGG[m].baseline.micro_f1.mean; const i = AGG[m].intermediate.micro_f1.mean;
    return [m, pct(b), pct(i), sgn(i - b)];
  };
  table(s, ['Encoder', 'Chỉ VietMed', 'Vi-Ner → VietMed', 'Δ micro'], ['PhoBERT', 'ViHealthBERT'].map(row), { x: 0.6, y: 3.65, w: 5.1, colW: [1.5, 1.2, 1.5, 0.9], size: 12.5, rowH: 0.42 });
  text(s, `Micro F1 test (%), trung bình ${AGGF.PhoBERT.seeds.length} seed (${SEEDS}), cách chấm đúng.`, 0.6, 4.95, 5.1, 0.4, { size: 11, italic: true, color: C.muted });
  const types = ['LOCATION', 'DATETIME', 'ORGANIZATION'];
  s.addChart(pres.charts.BAR, [
    ['PhoBERT', 'baseline', 'PhoBERT'], ['PhoBERT', 'intermediate', 'PhoBERT + Vi-Ner'], ['ViHealthBERT', 'baseline', 'ViHealthBERT'], ['ViHealthBERT', 'intermediate', 'ViHealthBERT + Vi-Ner'],
  ].map(([m, k, n]) => ({ name: n, labels: types, values: types.map((t) => r1(aggT(m, k, t))) })), {
    ...chartBase, x: 5.9, y: 1.25, w: 6.9, h: 3.9, barDir: 'col', barGrouping: 'clustered', chartColors: ['9DB8D9', '4C72B0', 'A8DCD4', C.teal], title: 'F1 test (%) theo loại, trung bình 3 seed', showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 9, valAxisMinVal: 0, valAxisMaxVal: 90,
  });
  const dl = (m, t) => aggT(m, 'intermediate', t) - aggT(m, 'baseline', t);
  card(s, 0.6, 5.45, 12.15, 1.45, C.coralTint);
  bullets(s, [`LOCATION **${sgn(dl('PhoBERT', 'LOCATION'))} / ${sgn(dl('ViHealthBERT', 'LOCATION'))}** điểm nhưng DATETIME **${sgn(dl('PhoBERT', 'DATETIME'))} / ${sgn(dl('ViHealthBERT', 'DATETIME'))}** (PhoBERT / ViHealthBERT); ORGANIZATION là nhiễu: ${CD.ORGANIZATION.train} mẫu train, ${CD.ORGANIZATION.test} mẫu test`,
    '**Không đổi checkpoint demo.** Vi-Ner **chưa rõ nguồn gốc và giấy phép**; 3 seed chỉ là ước lượng ban đầu, chưa phải khoảng tin cậy'], 0.82, 5.5, 11.8, 1.35, 13);
  source(s, 'experiments/004-vi-ner-intermediate-finetune/results/{phobert,vihealthbert}/aggregate.json, README.md; vi_ner_comparison.json (type_coverage)');
  s.addNotes(`Từ EDA, nhóm thấy ORGANIZATION và LOCATION rất ít mẫu, trong khi bộ Vi-Ner có hàng nghìn mẫu cho các loại này. Nhóm thử fine-tune hai bước: học Vi-Ner trước, sau khi viết thường và bỏ dấu câu cho giống lời nói, rồi thay đầu phân loại và học VietMed-NER. Mỗi nhánh chạy ba seed với cùng siêu tham số và cách chấm đúng. Kết quả: F1 tổng không tăng, PhoBERT gần như đứng yên còn ViHealthBERT giảm ${pct(Math.abs(AGG.ViHealthBERT.intermediate.micro_f1.mean - AGG.ViHealthBERT.baseline.micro_f1.mean))} điểm. Theo loại, LOCATION tăng ${rng(['PhoBERT', 'ViHealthBERT'].map((m) => dl(m, 'LOCATION')), 1)} điểm nhưng DATETIME giảm ${rng(['PhoBERT', 'ViHealthBERT'].map((m) => -dl(m, 'DATETIME')), 1)} điểm; ORGANIZATION thay đổi trong phạm vi nhiễu vì chỉ có ${CD.ORGANIZATION.train} mẫu train. Thêm vào đó, Vi-Ner chưa rõ nguồn gốc và giấy phép. Vì vậy nhóm không thay checkpoint của demo. Thời gian: 1 phút.`);
}

// ============================================================ 18. Correction models
{
  const s = base('Thử thêm 2: sửa lỗi transcript làm hỏng câu đúng', 3);
  const A = X1.A_asr_raw; const B = X1.B_after_correction;
  card(s, 0.6, 1.35, 5.6, 0.5, C.tint);
  heading(s, `Zero-shot (${X1.num_samples} câu test, PhoWhisper)`, 0.8, 1.4, 5.3, C.navy, 15);
  kpi(s, `${pct(A.wer)}% → ${pct(B.wer)}%`, 'WER trước → sau khi sửa (tăng)', 0.6, 2.0, 5.6, 1.2, C.coral, C.coralTint);
  kpi(s, `${X1.sentence_level.improved} ↑ · ${X1.sentence_level.worsened} ↓`, `câu tốt lên / xấu đi; ${X1.sentence_level.unchanged} câu không đổi`, 0.6, 3.35, 2.75, 1.2, C.navy);
  kpi(s, `${X1.reference_left_untouched}/${X1.num_samples}`, `transcript chuẩn giữ nguyên; WER trên câu chuẩn ${pct(X1.C_overcorrection_on_gold.wer)}%`, 3.45, 3.35, 2.75, 1.2, C.gold, C.goldTint);
  const epoch1 = LORA.every((r) => r.best_checkpoint === 'epoch-1');
  const oc = LORA.map((r) => r.history[0].reference_overcorrection_rate);
  image(s, 'fig_lora_overfitting.png', 6.45, 1.3, 6.35, 3.3);
  card(s, 6.45, 4.75, 6.3, 2.15, C.coralTint);
  heading(s, `Fine-tune LoRA (${LORA.length} seed)`, 6.65, 4.83, 5.9, C.coral, 15);
  bullets(s, [`Train loss giảm (${LORA[0].history.map((h) => num(h.token_cross_entropy, 2)).join(' → ')}) nhưng WER dev tăng (${LORA[0].history.map((h) => `${pct(h.dev_wer)}%`).join(' → ')}) ⇒ **overfit**`,
    `Early stopping chọn epoch 1${epoch1 ? ' ở cả 3 seed' : ''}; vẫn sửa nhầm **${pct(Math.min(...oc), 0)}–${pct(Math.max(...oc), 0)}%** transcript chuẩn (dev)`], 6.65, 5.23, 5.95, 1.65, 12.5);
  card(s, 0.6, 4.75, 5.6, 2.15, C.goldTint);
  heading(s, 'Hệ quả', 0.8, 4.83, 5.3, C.navy, 15);
  bullets(s, ['Sửa tự động có thể **ghi đè nội dung đúng**; không áp dụng tự động', 'Mọi thử nghiệm sửa lỗi phải đo **cùng với NER**, không chỉ WER (slide sau)'], 0.8, 5.23, 5.3, 1.65, 13);
  source(s, 'experiments/001-zeroshot-correction-vietmed/outputs/evaluation-summary.json; ket_qua_goc/lora_training_runs.json, fig_lora_overfitting.png');
  s.addNotes(`Hướng thứ hai là sửa lỗi transcript của ASR trước khi đưa vào NER. Thử zero-shot với mô hình sửa lỗi tiếng Việt có sẵn trên ${X1.num_samples} câu test: WER còn tăng nhẹ, từ ${pct(A.wer)}% lên ${pct(B.wer)}%, chỉ ${X1.sentence_level.improved} câu tốt lên và ${X1.sentence_level.worsened} câu xấu đi. Khi đưa transcript chuẩn vào, mô hình vẫn sửa ${X1.num_samples - X1.reference_left_untouched} trên ${X1.num_samples} câu vốn đã đúng. Nhóm tiếp tục fine-tune bằng LoRA trên dữ liệu VietMed: train loss giảm đều nhưng WER trên dev tăng ngay sau epoch 1, một ví dụ overfitting điển hình, nên early stopping chọn epoch 1 ở cả ba seed. Ngay cả checkpoint tốt nhất vẫn sửa nhầm ${rng(oc)}% transcript chuẩn trên dev. Kết luận: sửa tự động có thể ghi đè nội dung đúng. Thời gian: 1 phút.`);
}

// ============================================================ 19. Correction before NER
{
  const s = base(`Thử thêm 3: sửa lỗi trước NER chỉ thêm ${pct(corrGain, 2)} điểm F1`, 3);
  const br = [['raw', 'ASR thô'], ['raw_normalized', 'ASR thô + chuẩn hoá'], ['corrected', 'Đã sửa'], ['corrected_normalized', 'Đã sửa + chuẩn hoá'], ['gold_text', 'Transcript chuẩn']];
  s.addChart(pres.charts.BAR, [{ name: 'F1', labels: br.map(([, n]) => n), values: br.map(([k]) => +(f5(k) * 100).toFixed(2)) }], {
    ...chartBase, x: 0.5, y: 1.25, w: 7.2, h: 4.4, barDir: 'col', chartColors: [C.navy], title: `Entity micro F1 (%) của PhoBERT demo, ${int(X5.source.scored_utterances)} câu PhoWhisper`, showLegend: false, showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 11, valAxisMinVal: 40, valAxisMaxVal: 66, catAxisLabelFontSize: 9.5,
  });
  kpi(s, `${sgn(corrGain, 3)}`, `điểm F1: sửa lỗi so với chỉ chuẩn hoá (${X5.normalized_comparison.corrected_minus_raw_true_positives} thực thể đúng thêm)`, 7.95, 1.3, 4.8, 1.25, C.coral, C.coralTint);
  kpi(s, `${sgn(normGain, 2)}`, 'điểm F1: chỉ viết thường + bỏ dấu câu', 7.95, 2.7, 4.8, 1.25, C.teal, C.tealTint);
  card(s, 7.95, 4.1, 4.8, 2.8, C.tint);
  heading(s, 'Vì sao chuẩn hoá giúp?', 8.15, 4.2, 4.4, C.navy, 15);
  bullets(s, [`${int(TC.raw_terminal_period_count)}/${int(X5.source.scored_utterances)} transcript PhoWhisper kết thúc bằng **dấu chấm**; NER học trên văn bản không dấu câu`,
    `${int(WS_HYP.length)} transcript Whisper-small hiện có: **${wsNormChanged}** câu có chữ hoa hoặc dấu câu ⇒ bước chuẩn hoá sẽ không đổi câu nào; chưa đo tác động lên pipeline demo`], 8.15, 4.6, 4.45, 2.25, 13);
  card(s, 0.6, 5.8, 7.1, 1.1, C.goldTint);
  text(s, `**Không đưa mô hình sửa lỗi vào demo.** Kết quả trên PhoWhisper, không ước lượng trực tiếp pipeline Whisper-small. Khoảng cách chuẩn → ASR: ${pct(f5('gold_text'))}% → ${pct(f5('raw'))}%.`, 0.8, 5.8, 6.8, 1.1, { size: 13, valign: 'middle' });
  source(s, 'experiments/005-correction-before-ner/results.json (ner, normalized_comparison, text_changes), README.md; ket_qua_goc/asr_test_whisper_small.jsonl (đếm lúc build)');
  s.addNotes(`Thí nghiệm thứ ba đo trực tiếp điều quan trọng: sửa lỗi có giúp NER không. Nhóm chạy cùng checkpoint PhoBERT của demo trên bốn phiên bản transcript PhoWhisper của ${int(X5.source.scored_utterances)} câu test. Ban đầu có vẻ sửa lỗi giúp tăng F1, nhưng khi thêm nhánh đối chứng chỉ viết thường và bỏ dấu câu, phần tăng gần như biến mất: sửa lỗi chỉ thêm ${pct(corrGain, 3)} điểm, tương đương ${X5.normalized_comparison.corrected_minus_raw_true_positives} thực thể. Toàn bộ phần tăng ${pct(normGain, 2)} điểm đến từ chuẩn hoá, chủ yếu là bỏ dấu chấm ở cuối câu mà PhoWhisper luôn thêm vào. Trong ${int(WS_HYP.length)} transcript Whisper-small hiện có, không câu nào có chữ hoa hay dấu câu, nên bước chuẩn hoá sẽ không thay đổi câu nào trong số đó; nhóm chưa đo tác động trên pipeline demo đầy đủ. Vì vậy nhóm không đưa mô hình sửa lỗi vào demo. Lưu ý: các số này đo trên PhoWhisper, không phải pipeline Whisper-small của demo. Thời gian: 1 phút 10 giây.`);
}

// ============================================================ 20. ASR & demo pipeline
{
  const s = base(`PhoWhisper-medium giữ ${pct(PW.entity_survival.ALL.exact_rate, 1)}% thực thể (${int(PW.utterances)} câu)`, 4);
  image(s, 'fig_asr_overview.png', 0.4, 1.25, 12.5, 3.6);
  const steps = [['Audio', 'hội thoại y tế'], ['Whisper-small', 'MultiMed-ST'], ['Văn bản', 'thường, không dấu câu'], ['PhoBERT NER', 'checkpoint demo']];
  steps.forEach(([t, d], i) => {
    const x = 0.6 + i * 1.62;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 5.05, w: 1.45, h: 0.95, fill: { color: i === 3 ? C.coral : C.tint }, line: { color: i === 3 ? C.coral : C.line }, rectRadius: 0.08 });
    s.addText(t, { x, y: 5.08, w: 1.45, h: 0.45, fontFace: HEAD, fontSize: 12, bold: true, color: i === 3 ? C.white : C.navy, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
    s.addText(d, { x, y: 5.5, w: 1.45, h: 0.4, fontFace: BODY, fontSize: 9, color: i === 3 ? C.white : C.muted, align: 'center', margin: 0, isTextBox: true });
    if (i < 3) s.addText('→', { x: x + 1.43, y: 5.3, w: 0.2, h: 0.4, fontSize: 14, color: C.muted, align: 'center', margin: 0, isTextBox: true });
  });
  text(s, `Pipeline demo dùng **Whisper-small**: thực thể còn nguyên **${pct(WS.entity_survival.ALL.exact_rate, 1)}%** (n = ${int(WS.entity_survival.ALL.n)} thực thể, ${int(WS.utterances)} câu nói), thấp hơn PhoWhisper-medium.`, 0.6, 6.1, 6.4, 0.85, { size: 12.5, color: C.coral });
  table(s, ['Hệ ASR', 'Số câu nói', 'WER', 'Thực thể còn nguyên'], [
    ['PhoWhisper-medium', int(PW.utterances), `${pct(PW.wer.corpus, 1)}%`, `${pct(PW.entity_survival.ALL.exact_rate, 1)}%`],
    ['PhoWhisper-medium', int(PW500.utterances), `${pct(PW500.wer.corpus, 1)}%`, `${pct(PW500.entity_survival.ALL.exact_rate, 1)}%`],
    ['Whisper-small (demo)', int(WS.utterances), `${pct(WS.wer.corpus, 1)}%`, `${pct(WS.entity_survival.ALL.exact_rate, 1)}%`],
  ], { x: 7.2, y: 5.0, w: 5.55, colW: [2.0, 1.0, 0.95, 1.6], size: 12, rowH: 0.38, highlight: 2 });
  text(s, `Lỗi ASR: sai dấu chỉ ${pct(PW.errors.diacritic_share_of_errors, 1)}%; chèn / xoá ở hai đầu câu ${pct(PW.errors.edge_share_of_errors, 1)}% (PhoWhisper).`, 7.2, 6.55, 5.55, 0.45, { size: 11.5, italic: true, color: C.muted });
  source(s, 'asr_eda.json (systems: wer, entity_survival, errors), fig_asr_overview.png; experiments/005 README (demo = Whisper-small + PhoBERT)');
  s.addNotes(`Hệ thống thực tế nhận transcript do ASR sinh ra. Nhóm dùng transcript có sẵn: PhoWhisper-medium trên toàn bộ ${int(PW.utterances)} câu nói test, và Whisper-small của demo trên ${int(WS.utterances)} câu đầu. Trên ${int(PW.utterances)} câu, PhoWhisper-medium có WER ${pct(PW.wer.corpus, 1)}% và giữ nguyên ${pct(PW.entity_survival.ALL.exact_rate, 1)}% trong ${int(PW.entity_survival.ALL.n)} thực thể vàng; đây không phải mô hình của demo. Trên cùng ${int(WS.utterances)} câu, Whisper-small kém hơn: WER ${pct(WS.wer.corpus, 1)}% và chỉ ${pct(WS.entity_survival.ALL.exact_rate, 1)}% thực thể còn nguyên; thiết bị – kỹ thuật và phẫu thuật mất nhiều nhất. Phân tích lỗi cho thấy sai dấu chỉ chiếm ${pct(PW.errors.diacritic_share_of_errors, 1)}% lỗi, còn hơn một nửa là chèn hoặc xoá từ ở hai đầu câu, tức lỗi cắt đoạn âm thanh, thứ mà mô hình văn bản không sửa được. Đó cũng là lý do sửa lỗi văn bản không giúp NER. Thời gian: 1 phút.`);
}

// ============================================================ 21. Lessons & limits
{
  const s = base('Bài học và giới hạn', 4);
  card(s, 0.6, 1.35, 6.0, 5.55, C.tealTint);
  heading(s, 'Bài học', 0.82, 1.45, 5.6, C.teal);
  bullets(s, ['**Kiểm tra nhãn trước khi tin thước đo:** "0" ≠ "O" đã làm lệch mọi số Transformer', '**EDA quyết định cách đánh giá:** lệch miền ⇒ tách thực thể đã gặp / chưa gặp', '**Luôn có nhánh đối chứng:** phần tăng của sửa lỗi hoá ra là của việc bỏ dấu chấm', '**Kiểm định chênh lệch:** bootstrap và nhiều seed: PhoBERT − ViHealthBERT không phân biệt được với 0', '**Mô hình đơn giản vẫn mạnh:** CRF thắng khi dữ liệu lặp lại thuật ngữ'], 0.82, 1.9, 5.6, 4.9, 17);
  card(s, 6.85, 1.35, 5.9, 5.55, C.coralTint);
  heading(s, 'Giới hạn', 7.07, 1.45, 5.5, C.coral);
  bullets(s, [`Lớp hiếm (ORGANIZATION ${CD.ORGANIZATION.train}, TRANSPORTATION ${CD.TRANSPORTATION.train} mẫu train): F1 theo loại không đáng tin`,
    'Lưới dò Transformer chấm trước khi sửa lỗi "0", cấu hình tốt nhất ở biên lưới; chưa dò lại',
    'Vi-Ner chưa rõ nguồn gốc, giấy phép; chỉ 3 seed',
    `Thí nghiệm sửa lỗi dùng PhoWhisper; Whisper-small chỉ có ${int(WS.utterances)} câu transcript`,
    'Chưa thử BERT-CRF, trọng số lớp, dữ liệu cùng miền test'], 7.07, 1.9, 5.5, 4.9, 17);
  source(s, 'tổng hợp từ các slide trước');
  s.addNotes('Nhóm rút ra năm bài học. Thứ nhất, phải kiểm tra tập nhãn trước khi tin vào thước đo; một ký tự số không thay cho chữ O đã làm lệch mọi con số Transformer. Thứ hai, EDA quyết định cách đánh giá: phát hiện lệch miền khiến nhóm tách riêng thực thể đã gặp và chưa gặp. Thứ ba, luôn cần nhánh đối chứng: phần tăng tưởng là của mô hình sửa lỗi hoá ra là của việc bỏ dấu chấm cuối câu. Thứ tư, chênh lệch nhỏ phải được kiểm định bằng bootstrap và nhiều seed. Thứ năm, mô hình đơn giản như CRF vẫn rất mạnh khi dữ liệu lặp lại thuật ngữ. Về giới hạn: lớp hiếm quá ít mẫu, lưới dò siêu tham số chưa được chạy lại sau khi sửa lỗi chấm điểm, Vi-Ner chưa rõ giấy phép, thí nghiệm sửa lỗi chưa đo trên pipeline Whisper-small đầy đủ, và nhóm chưa thử BERT-CRF. Thời gian: 1 phút 10 giây.');
}

// ============================================================ 22. Conclusion
{
  const s = pres.addSlide();
  slideNo += 1;
  s.background = { color: C.navy };
  s.addText('Kết luận', { x: 0.8, y: 0.5, w: 11.7, h: 0.8, fontFace: HEAD, fontSize: 32, bold: true, color: C.white, margin: 0, isTextBox: true });
  const tiles = [
    [`${pct(M.CRF.test_f1)}%`, 'CRF: F1 test cao nhất (strict)'],
    [`${pct(M.PhoBERT.test_f1)} / ${pct(M.ViHealthBERT.test_f1)}`, 'PhoBERT vs ViHealthBERT: chênh lệch không phân biệt được với 0'],
    [`${pct(M.ViHealthBERT.recall_unseen, 1)}%`, 'ViHealthBERT: thực thể chưa gặp, cao nhất'],
    [`${sgn(corrGain, 3)}`, 'Sửa lỗi transcript trước NER: không đáng kể'],
  ];
  tiles.forEach(([big, lab], i) => {
    const x = 0.8 + i * 2.98;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.6, w: 2.8, h: 2.1, fill: { color: '17384F' }, line: { color: '2F5A76' }, rectRadius: 0.08 });
    s.addText(big, { x: x + 0.15, y: 1.75, w: 2.5, h: 0.9, fontFace: HEAD, fontSize: 24, bold: true, color: i === 0 ? 'F4A58A' : '9FD8CF', margin: 0, valign: 'middle', isTextBox: true });
    s.addText(lab, { x: x + 0.15, y: 2.7, w: 2.5, h: 0.9, fontFace: BODY, fontSize: 13, color: 'D6E2EA', margin: 0, valign: 'top', isTextBox: true });
  });
  s.addText('Nút thắt nằm ở dữ liệu — lệch miền, lớp hiếm, ranh giới nhãn — hơn là ở việc chọn mô hình.', { x: 0.8, y: 4.05, w: 11.7, h: 0.9, fontFace: HEAD, fontSize: 21, italic: true, color: C.white, margin: 0, valign: 'middle', isTextBox: true });
  s.addText('Cảm ơn Thầy và các bạn đã lắng nghe!  ·  Hỏi & đáp', { x: 0.8, y: 5.5, w: 11.7, h: 0.8, fontFace: HEAD, fontSize: 26, bold: true, color: '9FD8CF', align: 'center', margin: 0, valign: 'middle', isTextBox: true });
  s.addText(`${slideNo} / ${TOTAL}`, { x: W - 1.6, y: 7.05, w: 1.0, h: 0.3, fontFace: BODY, fontSize: 10, color: '9FB3C2', align: 'right', margin: 0, isTextBox: true });
  s.addNotes(`Tóm lại: trên tập test lệch miền của VietMed-NER, CRF đạt F1 strict cao nhất với ${pct(M.CRF.test_f1)}%. Giữa PhoBERT và ViHealthBERT, sau khi sửa lỗi chấm điểm, chênh lệch không phân biệt được với 0 theo bootstrap và ba seed. Transformer, đặc biệt ViHealthBERT, nhận ra thực thể chưa gặp tốt hơn nhiều, gần ${pct(M.ViHealthBERT.recall_unseen, 0)}%. Các hướng thử thêm, học Vi-Ner trước và sửa lỗi transcript trước NER, không cải thiện F1 tổng nên không được đưa vào demo. Thông điệp chính: nút thắt nằm ở dữ liệu, gồm lệch miền, lớp hiếm và ranh giới nhãn, hơn là ở việc chọn mô hình. Cảm ơn Thầy và các bạn đã lắng nghe; nhóm sẵn sàng trả lời câu hỏi. Thời gian: 45 giây.`);
}

if (slideNo !== TOTAL) throw new Error(`slide count ${slideNo} != TOTAL ${TOTAL}`);

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
