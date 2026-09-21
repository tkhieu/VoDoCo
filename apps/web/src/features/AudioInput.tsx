import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, Headphones, Mic, Square, Upload } from 'lucide-react';
import { Button, Notice, TabContent, Tabs } from '../components/ui';
import { modelName, type Model, type Schema } from '../lib/api';
import type { Session, SessionController } from '../lib/session';

export function AudioInput({ session, controller, models, modelError, refreshModels, start }: { session: Session; controller: SessionController; models: Schema['ModelsResponse'] | null; modelError: string | null; refreshModels: () => void; start: () => void }) {
  const [tab, setTab] = useState('upload');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [sample, setSample] = useState<{ available: boolean; name?: string; provenance?: string } | null>(null);
  const [sampleError, setSampleError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const interval = useRef<number | undefined>(undefined);
  const intent = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/sample', { cache: 'no-store', signal: abort.signal }).then(async response => { if (!response.ok) throw new Error('Sample unavailable'); const info = await response.json(); if (!abort.signal.aborted) setSample(info); }).catch(() => { if (!abort.signal.aborted) setSampleError(true); });
    return () => { abort.abort(); abandonInput(); };
  }, []);
  function releaseRecorder() {
    clearTimeout(timer.current); clearInterval(interval.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    recorder.current = null;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
  }
  function abandonInput() {
    intent.current?.abort(); intent.current = null;
    releaseRecorder();
  }
  function beginInput() {
    abandonInput();
    const ticket = new AbortController(); intent.current = ticket;
    setError(null); setBusy(true); setRecording(false);
    return ticket;
  }
  function current(ticket: AbortController) { return intent.current === ticket && !ticket.signal.aborted; }
  function stop() {
    setBusy(true); releaseRecorder(); setRecording(false);
  }
  async function selectAudio(ticket: AbortController, blob: Blob, name: string, provenance: string, recordedDuration?: number) {
    if (!current(ticket)) return;
    let url: string | undefined;
    try {
      if (!blob.size) throw new Error('Không đọc được audio. Hãy chọn lại tệp.');
      if (blob.size > 10485760) throw new Error('Tệp vượt 10 MiB. Chọn tệp nhỏ hơn.');
      const header = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
      if (!current(ticket)) return;
      const ascii = new TextDecoder('latin1').decode(header);
      const supported = (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') || ascii.startsWith('ID3') || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0) || ascii.slice(4, 8) === 'ftyp' || (header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3);
      if (!supported) throw new Error('Không hỗ trợ dữ liệu trong tệp này. Chọn audio WAV, MP3, M4A hoặc WebM.');
      url = URL.createObjectURL(blob);
      const media = document.createElement('audio'); media.preload = 'metadata';
      const duration = await new Promise<number | null>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout); ticket.signal.removeEventListener('abort', aborted);
          media.onloadedmetadata = null; media.onerror = null;
          media.removeAttribute('src'); media.load();
        };
        const aborted = () => { cleanup(); reject(new DOMException('Audio input abandoned', 'AbortError')); };
        const timeout = setTimeout(() => { cleanup(); reject(new Error('Không đọc được audio trong thời gian cho phép. Hãy chọn lại tệp.')); }, 10000);
        media.onloadedmetadata = () => { const duration = Number.isFinite(media.duration) ? media.duration : recordedDuration ?? null; cleanup(); resolve(duration); };
        media.onerror = () => { cleanup(); reject(new Error('Trình duyệt không đọc được audio này. Hãy chọn lại tệp WAV, MP3, M4A hoặc WebM.')); };
        ticket.signal.addEventListener('abort', aborted, { once: true });
        media.src = url!;
      });
      if (duration !== null && duration > 30) throw new Error('Audio dài hơn 30 giây. Chọn đoạn ngắn hơn. Hệ thống không tự cắt audio.');
      if (current(ticket)) controller.setAudio(blob, name, provenance, duration);
    } catch (reason) { if (current(ticket)) setError(reason instanceof Error ? reason.message : 'Không đọc được audio.'); }
    finally { if (url) URL.revokeObjectURL(url); if (current(ticket)) setBusy(false); }
  }
  async function record() {
    const ticket = beginInput();
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Trình duyệt này không hỗ trợ ghi âm. Bạn có thể tải tệp audio.');
      const mime = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error('Không có định dạng ghi âm được hỗ trợ. Bạn có thể tải tệp audio.');
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!current(ticket)) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream.current = acquired;
      const instance = new MediaRecorder(acquired, { mimeType: mime }); recorder.current = instance;
      const chunks: Blob[] = []; const started = performance.now();
      instance.ondataavailable = event => { if (current(ticket) && event.data.size) chunks.push(event.data); };
      instance.onerror = () => { acquired.getTracks().forEach(track => track.stop()); if (!current(ticket)) return; abandonInput(); setRecording(false); setBusy(false); setError('Không ghi được audio. Bạn có thể tải tệp hoặc thử ghi lại.'); };
      instance.onstop = () => {
        acquired.getTracks().forEach(track => track.stop());
        if (!current(ticket)) return;
        clearTimeout(timer.current); clearInterval(interval.current);
        recorder.current = null; stream.current = null; setRecording(false); setBusy(true);
        const actualMime = instance.mimeType || chunks[0]?.type || mime;
        void selectAudio(ticket, new Blob(chunks, { type: actualMime }), `ban-ghi.${actualMime.includes('mp4') ? 'm4a' : 'webm'}`, 'Ghi âm chủ động trong trình duyệt', (performance.now() - started) / 1000);
      };
      instance.start(); setRecording(true); setBusy(false); setSeconds(0);
      interval.current = window.setInterval(() => { if (current(ticket)) setSeconds(Math.min(10, (performance.now() - started) / 1000)); }, 100);
      timer.current = window.setTimeout(() => { if (current(ticket)) stop(); }, 10000);
    } catch (reason) { if (current(ticket)) { abandonInput(); setRecording(false); setBusy(false); setError(reason instanceof DOMException ? 'Không truy cập được micro. Cho phép micro trong trình duyệt rồi thử ghi lại, hoặc tải tệp audio.' : reason instanceof Error ? reason.message : 'Không truy cập được micro.'); } }
  }
  async function selectSample() {
    if (!sample?.available) return;
    const ticket = beginInput();
    try {
      const response = await fetch('/api/sample/audio', { cache: 'no-store', signal: AbortSignal.any([ticket.signal, AbortSignal.timeout(15000)]) });
      if (!current(ticket)) return;
      if (!response.ok) throw new Error('Không tải được audio mẫu. Hãy tải tệp của bạn hoặc thử lại.');
      const blob = await response.blob();
      if (current(ticket)) await selectAudio(ticket, blob, sample.name ?? 'audio-mau', sample.provenance ?? 'Audio mẫu được cấp quyền bởi chủ demo');
    } catch (reason) { if (current(ticket)) setError(reason instanceof Error ? reason.message : 'Không tải được audio mẫu.'); }
    finally { if (current(ticket)) setBusy(false); }
  }
  const selected = models?.models[session.model];
  const ready = models?.models.asr.status === 'ready' && selected?.status === 'ready';
  const active = ['loading', 'paused'].includes(session.audioState);
  return <section className="input-view"><div className="input-intro"><h1>Từ tiếng nói đến thực thể y tế</h1><p className="muted">Đưa vào một đoạn audio để phiên âm và rà soát.</p></div>
    <div className="panel input-card"><Tabs value={tab} onValueChange={value => { abandonInput(); setRecording(false); setBusy(false); setError(null); setTab(value); }} label="Cách đưa audio vào" items={[{ value: 'upload', label: <><Upload />Tải tệp</> }, { value: 'record', label: <><Mic />Ghi âm</> }]}>
      <TabContent value="upload"><input ref={input} hidden id="audio-file" type="file" accept=".wav,.mp3,.m4a,.webm,audio/*" onChange={event => { const file = event.target.files?.[0]; if (file && !active) void selectAudio(beginInput(), file, file.name, 'Audio do người dùng cung cấp'); event.target.value = ''; }} /><div className="dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && !busy && !active) void selectAudio(beginInput(), file, file.name, 'Audio do người dùng cung cấp'); }}><Upload className="upload-symbol" /><h2>Kéo thả audio vào đây</h2><Button onClick={() => input.current?.click()} disabled={busy || active}>Chọn tệp</Button><p className="metadata">Audio tối đa 30 giây · 10 MiB<br />Máy chủ kiểm tra định dạng và thời lượng thực.</p></div></TabContent>
      <TabContent value="record"><div className="dropzone"><Mic className="upload-symbol" /><h2>{recording ? 'Đang ghi âm' : 'Nói rõ, ở gần micro.'}</h2><p>{recording ? `${seconds.toFixed(1)} / 10 giây` : 'Ghi tối đa 10 giây. Nghe lại trước khi gửi.'}</p>{recording ? <Button onClick={stop} variant="destructive"><Square />Dừng</Button> : <Button onClick={() => void record()} disabled={busy || active}><Mic />{session.audio ? 'Ghi lại' : 'Bắt đầu ghi'}</Button>}<p className="metadata">Không gửi audio cho đến khi bạn bắt đầu xử lý.</p></div></TabContent>
    </Tabs>
    {session.audio && <div className="audio-preview"><strong>{session.audio.name}</strong><p className="metadata">{session.audio.duration === null ? 'Thời lượng sẽ được máy chủ kiểm tra' : `${session.audio.duration.toFixed(1)} giây`} · {(session.audio.blob.size / 1024).toFixed(1)} KiB</p><audio controls src={session.audio.url} preload="metadata" aria-label="Nghe lại audio đầu vào" /></div>}
    {error && <Notice error>{error}</Notice>}
    <Button className="w-full" variant="default" disabled={!session.audio || !ready || busy || recording || active} onClick={start}><ArrowRight />{busy ? 'Đang đọc audio…' : 'Phiên âm và nhận diện'}</Button>
    <div className="model-readiness" aria-live="polite">{modelError ? <Notice error>{modelError}<Button variant="ghost" onClick={refreshModels}>Kiểm tra lại dịch vụ</Button></Notice> : !models || selected?.status === 'loading' || models.models.asr.status === 'loading' ? <p>Đang nạp mô hình… Chờ mô hình sẵn sàng trước khi bắt đầu.</p> : ready ? <p className="metadata inline-center"><CheckCircle2 />{modelName[session.model]} đã sẵn sàng · {session.audio ? 'Có thể bắt đầu xử lý' : 'Chọn audio để bắt đầu'}</p> : <Notice>{selected?.status === 'missing' ? `Chưa nạp checkpoint ${modelName[session.model]}` : selected?.error?.message || models.models.asr.error?.message || 'Mô hình chưa sẵn sàng.'}{session.model === 'phobert' && models.models.xlmr.status === 'ready' && <Button onClick={() => controller.selectModel('xlmr')}>Dùng XLM-R baseline</Button>}<Button variant="ghost" onClick={refreshModels}>Kiểm tra lại mô hình</Button></Notice>}</div>
    {models && <label className="model-select">Model NER<select value={session.model} disabled={active} onChange={event => controller.selectModel(event.target.value as Model)}><option value="phobert">PhoBERT fine-tuned</option><option value="xlmr">XLM-R baseline</option></select></label>}
    </div>
    <div className="sample-shortcut"><span className="metadata">Chưa có file?</span><Button variant="ghost" disabled={!sample?.available || busy || recording || active} onClick={() => void selectSample()}><Headphones />Thử audio mẫu</Button></div>
    {(!sample?.available || sampleError) && <p className="metadata centered">{sampleError ? 'Không đọc được thông tin audio mẫu. Bạn vẫn có thể tải tệp hoặc ghi âm.' : sample === null ? 'Đang kiểm tra audio mẫu…' : 'Audio mẫu chưa được cấp quyền hoặc chưa được cấu hình. Bạn vẫn có thể tải tệp hoặc ghi âm.'}</p>}
    <div className="input-notices metadata"><p>Chỉ dùng audio được phép sử dụng.</p><p>Bản demo nghiên cứu, không dùng để chẩn đoán.</p><details><summary>Audio và dữ liệu được xử lý ở đâu?</summary><p>Audio đi qua Replit và được xử lý trên RunPod. Audio tạm được xóa sau xử lý hoặc lỗi; kết quả có thể được giữ tối đa 15 phút và mất sớm hơn khi dịch vụ khởi động lại. Phiên trình duyệt chỉ nằm trong bộ nhớ của tab, không tự lưu. Không đưa thông tin bệnh nhân vào demo.</p></details></div>
  </section>;
}
