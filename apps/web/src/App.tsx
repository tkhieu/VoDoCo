import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Download, Info, Plus, X } from 'lucide-react';
import { Button, Dialog, Notice } from './components/ui';
import { AudioInput } from './features/AudioInput';
import { Workspace } from './features/Workspace';
import { errorMessage, modelName, nerModels, request, type Schema } from './lib/api';
import { SessionController, type Session } from './lib/session';
import { download } from './lib/export';

function ExportAction({ session, className = '' }: { session: Session; className?: string }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<'txt' | 'json'>('txt');
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const comparison = session.view === 'compare';
  const source = comparison ? 'raw' : session.source;
  const slot = session.slots[source][session.model];
  const comparisonIncomplete = comparison && nerModels.some(model => session.slots.raw[model].state !== 'succeeded');
  return <div className={className}><Dialog open={open} onOpenChange={value => { setOpen(value); setMessage(null); }} trigger={<Button variant={!comparison && slot.state === 'stale' ? 'outline' : 'default'} disabled={!session.asr}><Download />Xuất kết quả</Button>} title="Xuất kết quả" description="Không kèm audio. Giữ nguồn văn bản, phiên bản và trạng thái rà soát."><fieldset className="export-options"><legend>Định dạng</legend><label><input type="radio" name={`format-${className}`} checked={format === 'txt'} onChange={() => setFormat('txt')} />TXT · bản văn bản đang xem</label><label><input type="radio" name={`format-${className}`} checked={format === 'json'} onChange={() => setFormat('json')} />JSON · toàn bộ phiên</label></fieldset><p className="metadata">{comparison ? 'Nguồn: ASR gốc · phiên bản 0. TXT là văn bản trung lập model; JSON giữ kết quả và provenance của cả sáu model.' : <>Nguồn: {source === 'raw' ? 'ASR gốc' : 'Bản rà soát'} · phiên bản {source === 'review' ? session.review?.revision : 0} · {modelName[session.model]}. TXT giữ nguyên văn bản; nguồn, model và trạng thái rà soát nằm trong tên tệp. JSON giữ đầy đủ provenance.</>}</p>{comparisonIncomplete ? <Notice>Một số model chưa có kết quả thành công. TXT vẫn giữ nguyên văn bản; JSON ghi riêng trạng thái hiện tại của từng model.</Notice> : !comparison && slot.state !== 'succeeded' ? <Notice>Thực thể {slot.state === 'stale' ? 'chưa cập nhật theo bản sửa' : 'chưa sẵn sàng'}. Vẫn có thể tải văn bản; JSON không gắn thực thể cũ vào bản mới.</Notice> : null}{message && <Notice error={failed}>{message}</Notice>}<div className="dialog-actions"><Button onClick={() => setOpen(false)}>Đóng</Button><Button variant="default" onClick={() => { try { download(session, format); setFailed(false); setMessage('Đã bắt đầu tải xuống. Kiểm tra mục tải xuống của trình duyệt; ứng dụng không xác nhận tệp đã được lưu.'); } catch { setFailed(true); setMessage('Không thể tải xuống kết quả. Phiên làm việc và các chỉnh sửa vẫn được giữ nguyên. Hãy thử tải lại.'); } }}><Download />Tải xuống</Button></div></Dialog></div>;
}
function ModelInfo({ models, error, refresh }: { models: Schema['ModelsResponseV2'] | null; error: string | null; refresh: () => void }) {
  return <Popover.Root><Popover.Trigger asChild><Button variant="ghost"><Info /><span>Thông tin mô hình</span></Button></Popover.Trigger><Popover.Portal><Popover.Content className="model-popover" sideOffset={8} collisionPadding={16}><h2>Thông tin mô hình</h2>{error && <Notice error>{error}</Notice>}{(['asr', ...nerModels] as const).map(id => { const model = models?.models[id]; const identity = model?.identity; return <section key={id}><h3>{id === 'asr' ? 'Whisper-small' : modelName[id]}</h3><p className="metadata">{model?.status === 'ready' ? 'Đã sẵn sàng' : model?.status === 'missing' ? 'Chưa nạp checkpoint' : model?.status === 'error' ? 'Lỗi nạp mô hình' : 'Đang kiểm tra / nạp mô hình'}</p>{model?.error && <p>{model.error.message}</p>}{identity && <dl><dt>Checkpoint</dt><dd><code title={identity.checkpoint_sha256 ?? 'Không có'}>{identity.checkpoint_sha256?.slice(0, 12) ?? 'Không có'}…</code></dd><dt>Thiết bị / dtype</dt><dd>{identity.device} · {identity.dtype}</dd><dt>Tokenizer</dt><dd>{identity.tokenizer}</dd>{model.token_limit && <><dt>Giới hạn token</dt><dd>{model.token_limit} · {model.supports_offsets ? 'Có offset kiểm chứng' : 'Chỉ danh sách thực thể'}</dd></>}</dl>}</section>; })}<Button variant="ghost" onClick={refresh}>Làm mới trạng thái</Button><Popover.Arrow /></Popover.Content></Popover.Portal></Popover.Root>;
}
export function App() {
  const [controller] = useState(() => new SessionController());
  const session = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [route, setRoute] = useState(location.pathname === '/workspace' ? 'workspace' : 'input');
  const [models, setModels] = useState<Schema['ModelsResponseV2'] | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  const modelRequest = useRef(0);
  const refreshModels = useCallback(() => {
    const ticket = ++modelRequest.current;
    void request<Schema['ModelsResponseV2']>('/api/v2/models').then(result => {
      if (ticket !== modelRequest.current) return;
      controller.models = result; setModels(result); setModelError(null);
    }).catch(error => { if (ticket !== modelRequest.current) return; controller.models = null; setModels(null); setModelError(errorMessage(error)); });
  }, [controller]);
  useEffect(() => {
    refreshModels();
    const interval = setInterval(refreshModels, 10000);
    return () => { clearInterval(interval); modelRequest.current++; };
  }, [refreshModels]);
  useEffect(() => { main.current?.focus({ preventScroll: true }); }, [route]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (controller.getSnapshot().audio) { event.preventDefault(); event.returnValue = ''; } };
    const onPopState = () => {
      if (controller.getSnapshot().audio && location.pathname !== '/workspace' && route === 'workspace') { history.pushState(null, '', '/workspace'); setLeaveOpen(true); }
      else setRoute(location.pathname === '/workspace' ? 'workspace' : 'input');
    };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('popstate', onPopState);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('popstate', onPopState); };
  }, [controller, route]);
  function discard() { controller.reset(); setLeaveOpen(false); history.pushState(null, '', '/'); setRoute('input'); }
  return <><a className="skip-link" href="#main">Đến nội dung chính</a><header className="app-header"><div className="header-inner"><div className="brand-group"><span className="wordmark">VoDoCo</span><span className="badge">Demo nghiên cứu</span></div><div className="header-actions">{route === 'workspace' ? <><Dialog open={leaveOpen} onOpenChange={setLeaveOpen} returnFocus={() => window.matchMedia('(max-width: 767px)').matches ? document.getElementById('mobile-new-record') : null} trigger={<Button className="desktop-new-record"><Plus />Bản ghi mới</Button>} title="Bỏ phiên chưa xuất?" description="Tải tệp mới sẽ thay thế phiên hiện tại. Ở lại để giữ audio, transcript và các chỉnh sửa. Không có tự động lưu."><p className="metadata">Đổi phiên không hủy tác vụ đã chạy trên máy chủ. Kết quả cũ sẽ không được gắn vào phiên mới.</p><div className="dialog-actions"><Button onClick={() => setLeaveOpen(false)}>Ở lại</Button><Button variant="destructive" onClick={discard}>Bỏ phiên và bắt đầu mới</Button></div></Dialog><ExportAction session={session} className="desktop-export" /></> : <ModelInfo models={models} error={modelError} refresh={refreshModels} />}</div></div></header><main id="main" className="container" tabIndex={-1} ref={main}>{route === 'input' ? <AudioInput session={session} controller={controller} models={models} modelError={modelError} refreshModels={refreshModels} start={() => { history.pushState(null, '', '/workspace'); setRoute('workspace'); void controller.transcribe(); }} /> : session.audio ? <><Workspace session={session} controller={controller} models={models} modelError={modelError} refreshModels={refreshModels} /><div className="workspace-bottom"><ExportAction session={session} className="mobile-export" /><Button id="mobile-new-record" className="mobile-new-record" onClick={() => setLeaveOpen(true)}><Plus />Bản ghi mới</Button><ModelInfo models={models} error={modelError} refresh={refreshModels} /><p className="metadata">Bản demo nghiên cứu, không dùng để chẩn đoán.</p></div></> : <section className="empty-session"><h1>Phiên này không còn trong bộ nhớ</h1><p>Reload hoặc đóng tab không giữ audio và transcript. Demo không tự lưu phiên.</p><Button variant="default" onClick={discard}>Bắt đầu một bản ghi</Button></section>}</main></>;
}
