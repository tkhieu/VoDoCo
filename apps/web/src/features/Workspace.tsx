import { useEffect, useState } from 'react';
import { Columns2, FileText, Pencil, RefreshCw } from 'lucide-react';
import { Button, Notice, Tabs, TabContent } from '../components/ui';
import { modelName, type Model, type Schema } from '../lib/api';
import type { Session, SessionController } from '../lib/session';
import { EntityPanel, Transcript } from './Entities';

const stageLabels: Record<Schema['Job']['stage'], string> = { receiving: 'Đang nhận audio…', queued: 'Đang chờ lượt xử lý…', decoding: 'Đang chuẩn bị audio…', transcribing: 'Đang phiên âm…', recognizing: 'Đang nhận diện thực thể…', finished: 'Lượt xử lý đã kết thúc.' };
const noEntities: Schema['Entity'][] = [];
export function Workspace({ session, controller, models, modelError, refreshModels }: { session: Session; controller: SessionController; models: Schema['ModelsResponse'] | null; modelError: string | null; refreshModels: () => void }) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [compareModel, setCompareModel] = useState<Model>('xlmr');
  const [compareSelected, setCompareSelected] = useState<string | null>(null);
  useEffect(() => { setSelected(null); }, [session.source, session.model, session.review?.revision]);
  useEffect(() => {
    if (session.view === 'compare' && session.asr) {
      for (const model of ['xlmr', 'phobert'] as const) {
        if (session.slots.raw[model].state === 'unavailable') void controller.recognize('raw', [model]);
      }
    }
  }, [session.view, session.asr, session.slots.raw, models?.models.xlmr.status, models?.models.phobert.status, controller]);
  const source = session.source;
  const text = source === 'raw' ? session.asr?.raw_text ?? '' : session.review?.text ?? '';
  const slot = session.slots[source][session.model];
  const ready = models?.models[session.model].status === 'ready';
  const textEntities = slot.state === 'succeeded' ? slot.result?.entities ?? noEntities : noEntities;
  const confirmed = source === 'raw' ? session.rawConfirmed : session.review?.confirmed ?? false;
  const headingConfirmed = session.view === 'compare' ? session.rawConfirmed : confirmed;
  const rawCompareSlot = session.slots.raw[compareModel];
  return <section className="workspace"><div className="session-heading"><div><h1>{session.audio?.name ?? 'Phiên làm việc'}</h1><p className="metadata">{session.metadata?.duration_seconds.toFixed(1) ?? session.audio?.duration?.toFixed(1) ?? 'Chưa xác định'} giây · ASR: Whisper-small · NER: {modelName[session.model]} {session.model === 'xlmr' ? 'baseline' : 'fine-tuned'}</p></div><span className="badge">{headingConfirmed ? 'Đã rà soát' : 'Chưa rà soát'}</span></div>
    {session.audio && <div className="panel player"><audio controls src={session.audio.url} preload="metadata" aria-label="Nghe audio để đối chiếu phiên âm" /><Button variant="ghost" onClick={event => { const audio = event.currentTarget.parentElement?.querySelector('audio'); if (audio) audio.currentTime = 0; }}>Nghe từ đầu</Button></div>}
    {session.audioState === 'loading' && <Notice>{session.stage ? stageLabels[session.stage] : 'Đang xử lý audio…'} Bạn có thể tiếp tục nghe audio trong lúc chờ.</Notice>}
    {session.audioState === 'paused' && <Notice error>{session.message}<Button onClick={() => controller.resume()}>Tiếp tục kiểm tra lượt này</Button></Notice>}
    {session.audioState === 'failed' && !session.asr && <Notice error>{session.message || 'Chưa tạo được bản phiên âm. Hãy nghe lại và thử đoạn rõ hơn.'}<Button onClick={() => void controller.transcribe()} disabled={models?.models.asr.status !== 'ready' || !ready}>Thử phiên âm lại</Button></Notice>}
    {modelError && <Notice error>{modelError}<Button variant="ghost" onClick={refreshModels}>Kiểm tra lại dịch vụ</Button></Notice>}
    {session.asr && <Tabs value={session.view} onValueChange={value => controller.setView(value as Session['view'])} label="Chế độ workspace" items={[{ value: 'review', label: <><FileText />Rà soát</> }, { value: 'compare', label: <><Columns2 />So sánh model</> }]}>
      <TabContent value="review"><div className="review-grid"><section className="panel transcript-panel"><div className="panel-heading"><h2>Bản phiên âm</h2><FileText aria-hidden="true" /></div>
        <Tabs value={source} onValueChange={value => { controller.setSource(value as Session['source']); setEditing(false); }} label="Nguồn văn bản" items={[{ value: 'raw', label: 'ASR gốc' }, { value: 'review', label: 'Bản rà soát' }]}>
          <TabContent value="raw"><Transcript text={session.asr.raw_text} entities={textEntities} selected={selected} onSelect={id => { setSelected(id); document.getElementById(`review-row-${id}`)?.focus(); }} prefix="review" /></TabContent>
          <TabContent value="review">{editing ? <><label htmlFor="review-text" className="metadata">Bản rà soát có thể chỉnh sửa. Không thay đổi ASR gốc.</label><textarea id="review-text" className="review-editor" value={session.review?.text ?? ''} onChange={event => controller.edit(event.target.value)} autoFocus spellCheck={false} /></> : <Transcript text={session.review?.text ?? ''} entities={textEntities} selected={selected} onSelect={id => { setSelected(id); document.getElementById(`review-row-${id}`)?.focus(); }} prefix="review" />}</TabContent>
        </Tabs>
        {source === 'review' && slot.state === 'stale' && <Notice>Văn bản đã thay đổi. Cập nhật thực thể để tiếp tục. Highlight và kết quả cũ không còn được dùng.</Notice>}
        <div className="transcript-footer"><p className="metadata">Bản ASR gốc luôn được giữ lại.</p>{source === 'raw' ? <Button onClick={() => { controller.setSource('review'); setEditing(true); }}><Pencil />Tạo bản rà soát</Button> : <Button onClick={() => setEditing(!editing)}><Pencil />{editing ? 'Xong chỉnh sửa' : 'Chỉnh sửa văn bản'}</Button>}</div>
        {source === 'review' && <Button variant={slot.state === 'stale' || slot.state === 'unavailable' ? 'default' : 'outline'} disabled={!ready || !text.trim() || ['loading', 'paused', 'succeeded'].includes(slot.state)} onClick={() => { setEditing(false); void controller.recognize('review', [session.model]); }}><RefreshCw />Cập nhật thực thể</Button>}
        <label className="review-confirm"><input type="checkbox" checked={confirmed} onChange={event => controller.confirm(event.target.checked)} />Tôi đã nghe đối chiếu bản này</label>
        <p className="metadata">Trạng thái do bạn xác nhận, không phải chứng nhận của model.</p>
      </section><EntityPanel key={`${source}-${session.model}-${session.review?.revision ?? 0}`} text={text} slot={slot} source={source} model={session.model} status={models?.models[session.model]} retry={() => { setEditing(false); void controller.recognize(source, [session.model]); }} resume={() => controller.resume(slot.jobId)} selected={selected} onSelect={setSelected} prefix="review" /></div>
      <label className="model-select workspace-model">Model NER<select value={session.model} onChange={event => controller.selectModel(event.target.value as Model)}><option value="phobert">PhoBERT fine-tuned</option><option value="xlmr">XLM-R baseline</option></select></label>
      <p className="metadata prediction-notice">Kết quả do model dự đoán; cần nghe đối chiếu.</p></TabContent>
      <TabContent value="compare"><Notice>Nguồn: cùng bản ASR gốc cho cả hai model. Chỉ chạy NER, không chạy lại ASR. Bản rà soát vẫn được giữ nguyên.</Notice><section className="panel compare-transcript"><div className="panel-heading"><h2>Cùng bản ASR gốc</h2><span className="badge">Chỉ đọc</span></div><Transcript text={session.asr.raw_text} entities={rawCompareSlot.state === 'succeeded' ? rawCompareSlot.result?.entities ?? noEntities : noEntities} selected={compareSelected} onSelect={id => { setCompareSelected(id); document.getElementById(`compare-${compareModel}-row-${id}`)?.focus(); }} prefix={`compare-${compareModel}`} /></section>
        <div className="compare-grid">{(['xlmr', 'phobert'] as const).map(model => <EntityPanel key={model} text={session.asr!.raw_text} slot={session.slots.raw[model]} source="raw" model={model} status={models?.models[model]} retry={() => void controller.recognize('raw', [model])} resume={() => controller.resume(session.slots.raw[model].jobId)} selected={compareModel === model ? compareSelected : null} onSelect={id => { setCompareModel(model); setCompareSelected(id); }} prefix={`compare-${model}`} comparison />)}</div>
        <details className="benchmark"><summary>Benchmark tham khảo <span className="metadata">VietMed-NER · 3.497 câu test</span></summary><table><caption>Entity-level micro F1, benchmark offline đã lưu</caption><thead><tr><th scope="col">Mô hình</th><th scope="col">F1</th></tr></thead><tbody><tr><th scope="row">XLM-R baseline</th><td>58,62%</td></tr><tr><th scope="row">PhoBERT fine-tuned</th><td>62,42%</td></tr></tbody></table><p className="metadata">Metric offline trên văn bản có nhãn, không phải chất lượng audio vừa upload. Nguồn: notebook integrated_multimed_benchmark_colab.ipynb, giai đoạn 14, kết quả gold đã chuẩn hóa nhãn nền.</p></details><p className="metadata">Hai model đều có thể sai. Nhiều thực thể hơn không đồng nghĩa với chính xác hơn.</p>
      </TabContent>
    </Tabs>}
  </section>;
}
