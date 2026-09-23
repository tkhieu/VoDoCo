import { capability, errorMessage, HttpError, nerModels, request, sha256, terminal, type Model, type Schema, type Source } from './api';

export type Slot = { state: 'unavailable' | 'stale' | 'loading' | 'succeeded' | 'failed' | 'paused'; result?: Schema['NerResult']; message?: string; jobId?: string };
export type Review = { text: string; revision: number; hash: string | null; confirmed: boolean };
export type Session = {
  id: string; createdAt: string; model: Model; view: 'review' | 'compare'; source: Source;
  audio: { blob: Blob; url: string; name: string; provenance: string; duration: number | null } | null;
  metadata: Schema['AudioMetadata'] | null; asr: Schema['AsrResult'] | null; review: Review | null;
  rawConfirmed: boolean; audioState: 'idle' | 'loading' | 'paused' | 'failed' | 'complete';
  stage: Schema['Job']['stage'] | null; message: string | null;
  slots: Record<Source, Record<Model, Slot>>;
};
type Attempt = { id: string; token: string; session: string; kind: 'audio' | 'ner'; source: Source; revision: number; hash: string; models: Model[]; identities: Partial<Record<Model, Schema['ModelIdentity']>>; controller: AbortController; started: number; epoch: number };
const emptySlots = (): Record<Model, Slot> => Object.fromEntries(nerModels.map(model => [model, { state: 'unavailable' }])) as Record<Model, Slot>;
function freshSession(): Session {
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), model: 'phobert', view: 'review', source: 'raw', audio: null, metadata: null, asr: null, review: null, rawConfirmed: false, audioState: 'idle', stage: null, message: null, slots: { raw: emptySlots(), review: emptySlots() } };
}
export function matchingResult(result: Schema['NerResult'], expected: { source: Source; revision: number; hash: string; model: Model; identity?: Schema['ModelIdentity'] }): boolean {
  if (result.source !== expected.source || result.revision !== expected.revision || result.text_sha256 !== expected.hash) return false;
  if (result.model === null) return result.status === 'failed';
  const actual = result.model;
  if (actual.logical_id !== expected.model) return false;
  const identity = expected.identity;
  return !identity || (actual.logical_id === identity.logical_id && actual.repo_id === identity.repo_id && actual.revision === identity.revision && actual.checkpoint_sha256 === identity.checkpoint_sha256 && actual.tokenizer === identity.tokenizer && actual.label_map_sha256 === identity.label_map_sha256 && actual.device === identity.device && actual.dtype === identity.dtype);
}
export class SessionController {
  private value = freshSession();
  private listeners = new Set<() => void>();
  private attempts = new Map<string, Attempt>();
  private audioAttempt: string | null = null;
  models: Schema['ModelsResponseV2'] | null = null;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.value;
  private update(patch: Partial<Session>) { this.value = { ...this.value, ...patch }; this.listeners.forEach(listener => listener()); }
  private setSlot(source: Source, model: Model, slot: Slot) { this.update({ slots: { ...this.value.slots, [source]: { ...this.value.slots[source], [model]: slot } } }); }
  reset() {
    this.attempts.forEach(attempt => attempt.controller.abort()); this.attempts.clear(); this.audioAttempt = null;
    if (this.value.audio) URL.revokeObjectURL(this.value.audio.url);
    this.value = freshSession(); this.listeners.forEach(listener => listener());
  }
  setAudio(blob: Blob, name: string, provenance: string, duration: number | null) {
    const model = this.value.model;
    this.reset(); this.update({ model, audio: { blob, name, provenance, duration, url: URL.createObjectURL(blob) } });
  }
  setView(view: Session['view']) { this.update({ view }); }
  setSource(source: Source) {
    if (source === 'review' && !this.value.review && this.value.asr) this.update({ review: { text: this.value.asr.raw_text, revision: 0, hash: this.value.asr.text_sha256, confirmed: false } });
    this.update({ source });
  }
  selectModel(model: Model) {
    if (this.value.model === model) return;
    this.attempts.forEach(attempt => { if (attempt.source === 'review') attempt.controller.abort(); });
    this.update({ model, slots: { ...this.value.slots, review: emptySlots() } });
  }
  edit(text: string) {
    if (!this.value.review) return;
    this.attempts.forEach(attempt => { if (attempt.source === 'review') attempt.controller.abort(); });
    this.update({ review: { text, revision: this.value.review.revision + 1, hash: null, confirmed: false }, slots: { ...this.value.slots, review: Object.fromEntries(nerModels.map(model => [model, { state: 'stale' }])) as Record<Model, Slot> } });
  }
  confirm(confirmed: boolean) {
    if (this.value.source === 'review' && this.value.review) this.update({ review: { ...this.value.review, confirmed } });
    else this.update({ rawConfirmed: confirmed });
  }
  private current(attempt: Attempt, epoch = attempt.epoch): boolean {
    if (this.value.id !== attempt.session || attempt.controller.signal.aborted || attempt.epoch !== epoch) return false;
    if (attempt.kind === 'audio') return this.audioAttempt === attempt.id;
    const revision = attempt.source === 'raw' ? 0 : this.value.review?.revision;
    const hash = attempt.source === 'raw' ? this.value.asr?.text_sha256 : this.value.review?.hash;
    return revision === attempt.revision && hash === attempt.hash && attempt.models.some(model => this.value.slots[attempt.source][model].jobId === attempt.id);
  }
  private apply(job: Schema['Job'], attempt: Attempt) {
    if (!this.current(attempt)) return;
    if (job.job_id !== attempt.id || job.session_id !== attempt.session || job.input_sha256 !== attempt.hash || job.kind !== attempt.kind) throw new Error('Mismatched job envelope');
    if (attempt.kind === 'audio') {
      const asr = job.result?.asr;
      if (asr && this.value.asr && (asr.raw_text !== this.value.asr.raw_text || asr.text_sha256 !== this.value.asr.text_sha256)) throw new Error('Mismatched immutable ASR');
      this.update({ stage: job.stage, ...(!this.value.asr && asr ? { asr } : {}), ...(!this.value.metadata && job.result?.audio ? { metadata: job.result.audio } : {}), audioState: terminal(job) ? (asr || this.value.asr ? 'complete' : 'failed') : 'loading', message: job.errors.length ? job.errors.map(error => `${error.message} (${error.code})`).join(' ') : null });
    }
    const source = attempt.source;
    const hash = attempt.kind === 'audio' ? this.value.asr?.text_sha256 : attempt.hash;
    for (const model of attempt.models) {
      if (this.value.slots[source][model].jobId !== attempt.id) continue;
      const result = job.result?.ner[model];
      if (result && hash && matchingResult(result, { source, revision: attempt.revision, hash, model, identity: attempt.identities[model] })) {
        this.setSlot(source, model, { state: result.status, result, jobId: attempt.id, message: result.error ? `${result.error.message} (${result.error.code})` : undefined });
      } else if (terminal(job) && this.value.slots[source][model].state === 'loading') {
        this.setSlot(source, model, { state: 'failed', jobId: attempt.id, message: job.errors.map(error => error.message).join(' ') || 'Chưa nhận được kết quả khớp với văn bản và model. Thử nhận diện lại.' });
      }
    }
  }
  private pause(attempt: Attempt, error: unknown) {
    if (!this.current(attempt)) return;
    const unavailable = error instanceof HttpError && [404, 409].includes(error.status);
    if (attempt.kind === 'audio') this.update({ audioState: unavailable ? (this.value.asr ? 'complete' : 'failed') : 'paused', message: errorMessage(error) });
    attempt.models.forEach(model => {
      const slot = this.value.slots[attempt.source][model];
      if (slot.jobId === attempt.id && slot.state !== 'succeeded' && slot.state !== 'failed') this.setSlot(attempt.source, model, { ...slot, state: unavailable ? 'failed' : 'paused', message: errorMessage(error) });
    });
    if (unavailable) { attempt.controller.abort(); this.attempts.delete(attempt.id); }
  }
  private async poll(attempt: Attempt, initial?: Schema['Job']) {
    const epoch = ++attempt.epoch;
    try {
      let job = initial;
      while (this.current(attempt, epoch)) {
        if (Date.now() - attempt.started > 600000) throw new Error('Client wait deadline');
        if (!job) job = await request<Schema['Job']>(`/api/v1/jobs/${attempt.id}`, { headers: { 'X-Job-Token': attempt.token }, signal: attempt.controller.signal });
        if (!this.current(attempt, epoch)) return;
        this.apply(job, attempt);
        if (terminal(job)) return;
        await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timer); attempt.controller.signal.removeEventListener('abort', finish); resolve(); };
          const timer = setTimeout(finish, document.hidden ? 4000 : 1000);
          attempt.controller.signal.addEventListener('abort', finish, { once: true });
        });
        job = undefined;
      }
    } catch (error) { if (this.current(attempt, epoch)) this.pause(attempt, error); }
  }
  resume(jobId?: string) {
    const attempt = this.attempts.get(jobId ?? this.audioAttempt ?? '');
    if (!attempt || !this.current(attempt)) return;
    attempt.started = Date.now();
    if (attempt.kind === 'audio') this.update({ audioState: 'loading', message: null });
    attempt.models.forEach(model => { const slot = this.value.slots[attempt.source][model]; if (slot.jobId === attempt.id && slot.state === 'paused') this.setSlot(attempt.source, model, { ...slot, state: 'loading', message: undefined }); });
    void this.poll(attempt);
  }
  private createAttempt(kind: Attempt['kind'], source: Source, revision: number, hash: string, models: Model[]): Attempt {
    const attempt: Attempt = { id: crypto.randomUUID(), token: capability(), session: this.value.id, kind, source, revision, hash, models, identities: {}, controller: new AbortController(), started: Date.now(), epoch: 0 };
    for (const model of models) { const identity = this.models?.models[model].identity; if (identity) attempt.identities[model] = identity; }
    this.attempts.set(attempt.id, attempt);
    models.forEach(model => this.setSlot(source, model, { state: 'loading', jobId: attempt.id }));
    return attempt;
  }
  async transcribe() {
    const { audio, id, model } = this.value;
    if (!audio || this.value.asr || ['loading', 'paused'].includes(this.value.audioState)) return;
    this.update({ audioState: 'loading', message: null, stage: null });
    let attempt: Attempt | undefined;
    try {
      const hash = await sha256(await audio.blob.arrayBuffer());
      if (this.value.id !== id || this.value.model !== model) return;
      attempt = this.createAttempt('audio', 'raw', 0, hash, [model]); this.audioAttempt = attempt.id;
      const job = await request<Schema['Job']>(`/api/v1/audio-jobs/${attempt.id}?ner_model=${model}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Job-Token': attempt.token, 'X-Session-Id': id, 'X-Input-Sha256': hash }, body: audio.blob, signal: attempt.controller.signal }, 65000);
      await this.poll(attempt, job);
    } catch (error) {
      if (attempt && this.current(attempt)) {
        if (error instanceof HttpError && error.status < 500) { this.update({ audioState: 'failed', message: errorMessage(error) }); this.setSlot('raw', model, { state: 'failed', message: errorMessage(error) }); }
        else await this.poll(attempt);
      } else if (this.value.id === id) this.update({ audioState: 'failed', message: errorMessage(error) });
    }
  }
  async recognize(source: Source, models: Model[]) {
    const sessionId = this.value.id;
    const text = source === 'raw' ? this.value.asr?.raw_text : this.value.review?.text;
    const revision = source === 'raw' ? 0 : this.value.review?.revision;
    if (!text?.trim() || revision === undefined) return;
    const eligible = models.filter(model => this.models?.models[model].status === 'ready' && !['loading', 'paused', 'succeeded'].includes(this.value.slots[source][model].state));
    if (!eligible.length) return;
    const slots = this.value.slots[source];
    const selectedModel = this.value.model;
    let attempt: Attempt | undefined;
    try {
      const hash = await sha256(text);
      if (this.value.id !== sessionId || (source === 'review' && (this.value.review?.revision !== revision || this.value.model !== selectedModel))) return;
      // An intervening attempt must not become an implicit retry after it fails.
      if (eligible.some(model => this.value.slots[source][model] !== slots[model])) return;
      if (source === 'review' && this.value.review) this.update({ review: { ...this.value.review, hash } });
      const body: Schema['NerRequest'] = { session_id: sessionId, source, revision, text, text_sha256: hash, models: eligible };
      const encoded = JSON.stringify(body);
      if (new TextEncoder().encode(encoded).byteLength > 32768) {
        eligible.forEach(model => this.setSlot(source, model, { state: 'failed', message: 'Yêu cầu văn bản vượt 32 KiB. NER chưa xử lý toàn văn; hãy dùng bản rà soát ngắn hơn. Transcript đầy đủ vẫn được giữ.' })); return;
      }
      attempt = this.createAttempt('ner', source, revision, hash, eligible);
      const job = await request<Schema['Job']>(`/api/v1/ner-jobs/${attempt.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Job-Token': attempt.token }, body: encoded, signal: attempt.controller.signal });
      await this.poll(attempt, job);
    } catch (error) {
      if (attempt && this.current(attempt)) {
        if (error instanceof HttpError && error.status < 500) eligible.forEach(model => this.setSlot(source, model, { state: 'failed', message: errorMessage(error) }));
        else await this.poll(attempt);
      } else if (!attempt && this.value.id === sessionId && (source === 'raw' || (this.value.review?.revision === revision && this.value.model === selectedModel))) eligible.forEach(model => { if (this.value.slots[source][model] === slots[model]) this.setSlot(source, model, { state: 'failed', message: errorMessage(error) }); });
    }
  }
}
