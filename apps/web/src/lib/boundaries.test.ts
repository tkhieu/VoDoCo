import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapEntities } from './entities';
import { currentText, exportSession } from './export';
import { SessionController } from './session';
import { sha256, type Schema } from './api';

const model: Schema['ModelIdentity'] = { logical_id: 'phobert', repo_id: null, revision: null, checkpoint_sha256: 'a'.repeat(64), tokenizer: 'test-tokenizer', label_map_sha256: 'b'.repeat(64), device: 'cuda:0', dtype: 'float32' };
const vihealthModel: Schema['ModelIdentity'] = { ...model, logical_id: 'vihealthbert-ner-seed2024' };
const entity: Schema['Entity'] = { id: 'occurrence-1', text: 'đau', label: 'DISEASESYMTOM', start: 2, end: 5, offset_unit: 'unicode_codepoint', score: 0.9 };
const readyFor = (logicalId: Schema['ModelIdentity']['logical_id'], supportsOffsets = true): Schema['ModelStatus'] => ({
  status: 'ready',
  identity: { ...model, logical_id: logicalId },
  token_limit: logicalId === 'asr' ? null : logicalId === 'logreg' || logicalId === 'linear-svm' || logicalId === 'crf' ? 4096 : 256,
  supports_offsets: supportsOffsets,
  error: null,
});
const ready = readyFor('phobert');
const modelResponse: Schema['ModelsResponseV2'] = {
  api_version: '2',
  models: {
    asr: readyFor('asr', false),
    logreg: readyFor('logreg'),
    'linear-svm': readyFor('linear-svm'),
    crf: readyFor('crf'),
    xlmr: readyFor('xlmr'),
    phobert: ready,
    'vihealthbert-ner-seed2024': readyFor('vihealthbert-ner-seed2024', false),
  },
  limits: { upload_bytes: 10485760, upload_seconds: 30, record_seconds: 10, text_body_bytes: 32768 },
};
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('exact Unicode occurrences', () => {
  it('maps supplementary code points and keeps the second repeated occurrence distinct', () => {
    const text = '😀 đau, đau';
    const mapped = mapEntities(text, [entity, { ...entity, id: 'occurrence-2', start: 7, end: 10 }, { ...entity, id: 'unmapped', start: null, end: null }]);
    expect(mapped.map(item => [item.utf16Start, item.utf16End])).toEqual([[3, 6], [8, 11], [null, null]]);
    expect(text.slice(mapped[1].utf16Start!, mapped[1].utf16End!)).toBe('đau');
  });
  it('does not guess mismatching, normalized, or overlapping locations', () => {
    expect(mapEntities('đau', [{ ...entity, start: 0, end: 3 }, { ...entity, id: 'overlap', text: 'au', start: 1, end: 3 }]).every(item => item.utf16Start === null)).toBe(true);
    expect(mapEntities('a\u0301', [{ ...entity, text: 'á', start: 0, end: 2 }])[0].utf16Start).toBeNull();
  });
});

it('late NER cannot recreate entities after another edit; export retains the new draft and immutable raw', async () => {
  const controller = new SessionController();
  controller.models = modelResponse;
  const raw = '😀 đau, đau'; const rawHash = await sha256(raw);
  let deliver!: (response: Response) => void;
  let received!: () => void;
  const sent = new Promise<void>(resolve => { received = resolve; });
  let pendingRequest!: Schema['NerRequest'];
  let pendingId = '';
  vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => {
    const id = url.split('/').pop()!.split('?')[0];
    if (url.includes('/audio-jobs/')) {
      const headers = options.headers as Record<string, string>;
      const job: Schema['Job'] = { api_version: '1', job_id: id, session_id: controller.getSnapshot().id, kind: 'audio', status: 'succeeded', stage: 'finished', created_at: new Date().toISOString(), expires_at: new Date().toISOString(), input_sha256: headers['X-Input-Sha256'], result: { audio: null, asr: { raw_text: raw, text_sha256: rawHash, model: { ...model, logical_id: 'asr' }, generation_settings: { language: 'Vietnamese' }, postprocessing: 'strip_surrounding_whitespace', duration_ms: 10 }, ner: { phobert: { status: 'succeeded', source: 'raw', revision: 0, text_sha256: rawHash, model, entities: [entity], error: null, duration_ms: 10 } }, source: 'raw', revision: 0, text_sha256: rawHash }, errors: [] };
      return Promise.resolve(Response.json(job));
    }
    pendingRequest = JSON.parse(options.body as string); pendingId = id; received();
    // Intentionally ignore AbortSignal: a transport can finish after local disposal.
    return new Promise<Response>(resolve => { deliver = resolve; });
  }));
  controller.setAudio(new Blob(['audio']), 'clip.wav', 'Test-owned fixture', 1);
  await controller.transcribe();
  controller.setSource('review'); controller.edit('đau lần một');
  const pending = controller.recognize('review', ['phobert']);
  await sent;
  controller.confirm(true); controller.edit('đã sửa lần hai\n');
  expect(controller.getSnapshot().slots.review.phobert.state).toBe('stale');
  expect(controller.getSnapshot().review?.confirmed).toBe(false);
  const job: Schema['Job'] = { api_version: '1', job_id: pendingId, session_id: pendingRequest.session_id, kind: 'ner', status: 'succeeded', stage: 'finished', created_at: new Date().toISOString(), expires_at: new Date().toISOString(), input_sha256: pendingRequest.text_sha256, result: { audio: null, asr: null, source: pendingRequest.source, revision: pendingRequest.revision, text_sha256: pendingRequest.text_sha256, ner: { phobert: { status: 'succeeded', source: pendingRequest.source, revision: pendingRequest.revision, text_sha256: pendingRequest.text_sha256, model, entities: [{ ...entity, start: 0, end: 3 }], error: null, duration_ms: 10 } } }, errors: [] };
  deliver(Response.json(job)); await pending;
  const session = controller.getSnapshot();
  expect(session.slots.review.phobert).toEqual({ state: 'stale' });
  expect(session.asr?.raw_text).toBe(raw);
  expect(currentText(session)).toBe('đã sửa lần hai\n');
  const exported = exportSession(session);
  expect(exported.review?.text).toBe('đã sửa lần hai\n');
  expect(exported.results.review.phobert.entities).toEqual([]);
  expect(exported.results.raw.phobert.entities[0].text).toBe('đau');
  expect(JSON.stringify(exported)).not.toContain(pendingId);
  controller.setView('compare');
  expect(currentText(controller.getSnapshot())).toBe(raw);
  controller.reset();
});


it('routes the exact ViHealthBERT id and stores only its result slot', async () => {
  const controller = new SessionController();
  controller.models = modelResponse;
  controller.selectModel('vihealthbert-ner-seed2024');
  const raw = 'Bệnh nhân đau đầu.';
  const rawHash = await sha256(raw);
  let requestedUrl = '';
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    requestedUrl = url;
    const id = url.split('/').pop()!.split('?')[0];
    if (url.includes('/ner-jobs/')) {
      const request: Schema['NerRequest'] = JSON.parse(options.body as string);
      const job: Schema['Job'] = {
        api_version: '1', job_id: id, session_id: request.session_id, kind: 'ner', status: 'succeeded', stage: 'finished',
        created_at: new Date().toISOString(), expires_at: new Date().toISOString(), input_sha256: request.text_sha256,
        result: {
          audio: null, asr: null, source: request.source, revision: request.revision, text_sha256: request.text_sha256,
          ner: { 'vihealthbert-ner-seed2024': { status: 'succeeded', source: request.source, revision: request.revision, text_sha256: request.text_sha256, model: { ...vihealthModel, checkpoint_sha256: 'c'.repeat(64) }, entities: [entity], error: null, duration_ms: 10 } },
        },
        errors: [],
      };
      return Response.json(job);
    }
    const inputHash = (options.headers as Record<string, string>)['X-Input-Sha256'];
    const job: Schema['Job'] = {
      api_version: '1', job_id: id, session_id: controller.getSnapshot().id, kind: 'audio', status: 'succeeded', stage: 'finished',
      created_at: new Date().toISOString(), expires_at: new Date().toISOString(), input_sha256: inputHash,
      result: {
        audio: null,
        asr: { raw_text: raw, text_sha256: rawHash, model: { ...model, logical_id: 'asr' }, generation_settings: { language: 'Vietnamese' }, postprocessing: 'strip_surrounding_whitespace', duration_ms: 10 },
        ner: { 'vihealthbert-ner-seed2024': { status: 'succeeded', source: 'raw', revision: 0, text_sha256: rawHash, model: vihealthModel, entities: [entity], error: null, duration_ms: 10 } },
        source: 'raw', revision: 0, text_sha256: rawHash,
      },
      errors: [],
    };
    return Response.json(job);
  }));
  controller.setAudio(new Blob(['audio']), 'clip.wav', 'Test-owned fixture', 1);
  await controller.transcribe();
  expect(requestedUrl).toContain('ner_model=vihealthbert-ner-seed2024');
  const session = controller.getSnapshot();
  expect(session.slots.raw['vihealthbert-ner-seed2024'].state).toBe('succeeded');
  expect(session.slots.raw.phobert.state).toBe('unavailable');
  const exported = exportSession(session);
  expect(exported.selected_model).toBe('vihealthbert-ner-seed2024');
  expect(exported.results.raw['vihealthbert-ner-seed2024']).toMatchObject({
    state: 'succeeded',
    model: { logical_id: 'vihealthbert-ner-seed2024' },
    entities: [{ text: 'đau', start: null, end: null }],
  });
  controller.setSource('review');
  controller.edit(`${raw} đã sửa`);
  await controller.recognize('review', ['vihealthbert-ner-seed2024']);
  expect(controller.getSnapshot().slots.review['vihealthbert-ner-seed2024'].state).toBe('failed');
  expect(exportSession(controller.getSnapshot()).results.review['vihealthbert-ner-seed2024'].entities).toEqual([]);
  controller.reset();
});

describe('immutable ASR and explicit NER recovery', () => {
  async function audioSession(status: Schema['Job']['status'] = 'running') {
    const controller = new SessionController();
    controller.models = modelResponse;
    const raw = '😀 đau, đau\n'; const hash = await sha256(raw);
    controller.setAudio(new Blob(['audio']), 'clip.wav', 'Test-owned fixture', 1);
    const job = (url: string, options: RequestInit): Schema['Job'] => ({
      api_version: '1', job_id: url.split('/').pop()!.split('?')[0], session_id: controller.getSnapshot().id, kind: 'audio', status, stage: status === 'running' ? 'recognizing' : 'finished',
      created_at: new Date().toISOString(), expires_at: new Date().toISOString(), input_sha256: (options.headers as Record<string, string>)['X-Input-Sha256'],
      result: { audio: null, asr: { raw_text: raw, text_sha256: hash, model: { ...model, logical_id: 'asr' }, generation_settings: { language: 'Vietnamese' }, postprocessing: 'strip_surrounding_whitespace', duration_ms: 10 }, ner: {}, source: 'raw', revision: 0, text_sha256: hash }, errors: [],
    });
    return { controller, raw, hash, job };
  }
  function nerJob(url: string, request: Schema['NerRequest']): Schema['Job'] {
    return {
      api_version: '1', job_id: url.split('/').pop()!, session_id: request.session_id, kind: 'ner', status: 'succeeded', stage: 'finished',
      created_at: new Date().toISOString(), expires_at: new Date().toISOString(), input_sha256: request.text_sha256,
      result: { audio: null, asr: null, source: request.source, revision: request.revision, text_sha256: request.text_sha256, ner: Object.fromEntries(request.models.map(id => [id, { status: 'succeeded', source: request.source, revision: request.revision, text_sha256: request.text_sha256, model: { ...model, logical_id: id }, entities: [entity], error: null, duration_ms: 10 }])) },
      errors: [],
    };
  }

  it('retains raw, draft, confirmations and independent NER after registry loss; recovery never reruns ASR', async () => {
    vi.useFakeTimers(); vi.stubGlobal('document', { hidden: false });
    const { controller, raw, hash, job } = await audioSession();
    let audioJob!: Schema['Job']; let audioPuts = 0; let polls = 0;
    const nerRequests: Schema['NerRequest'][] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url.includes('/audio-jobs/')) {
        audioPuts++; audioJob = job(url, options);
        return Response.json(audioPuts === 1 ? audioJob : { ...audioJob, status: 'succeeded', stage: 'finished' });
      }
      if (url.includes('/ner-jobs/')) {
        const body: Schema['NerRequest'] = JSON.parse(options.body as string); nerRequests.push(body);
        return Response.json(nerJob(url, body));
      }
      return ++polls === 1 ? Response.json(audioJob) : Response.json({ api_version: '1', error: { code: 'JOB_UNAVAILABLE', message: 'Registry lost', stage: 'connection', retryable: true } }, { status: 404 });
    }));
    const received = new Promise<void>(resolve => { const unsubscribe = controller.subscribe(() => { if (controller.getSnapshot().asr) { unsubscribe(); resolve(); } }); });
    const pending = controller.transcribe(); await received;
    controller.confirm(true); controller.setSource('review'); controller.edit('đã nghe và sửa\n'); controller.confirm(true);
    await controller.recognize('raw', ['xlmr']);
    const review = controller.getSnapshot().review;
    const independent = controller.getSnapshot().slots.raw.xlmr.result;
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.getSnapshot().asr?.raw_text).toBe(raw);
    expect(controller.getSnapshot().review).toEqual(review);
    await vi.advanceTimersByTimeAsync(1000); await pending;
    expect(controller.getSnapshot().audioState).toBe('complete');
    expect(controller.getSnapshot().slots.raw.phobert.state).toBe('failed');
    expect(controller.getSnapshot().slots.raw.xlmr.result).toEqual(independent);
    await controller.transcribe();
    expect(audioPuts).toBe(1);
    await controller.recognize('raw', ['phobert']);
    const recovered = controller.getSnapshot();
    expect(nerRequests.map(request => request.models)).toEqual([['xlmr'], ['phobert']]);
    expect(nerRequests.every(request => request.text === raw && request.text_sha256 === hash && request.source === 'raw' && request.revision === 0)).toBe(true);
    expect(recovered.slots.raw.phobert.state).toBe('succeeded');
    expect(recovered.slots.raw.xlmr.result).toEqual(independent);
    expect(recovered.asr?.raw_text).toBe(raw);
    expect(recovered.rawConfirmed).toBe(true);
    expect(recovered.review).toEqual(review);
    await controller.transcribe(); expect(audioPuts).toBe(1);
    controller.setAudio(new Blob(['new audio']), 'new.wav', 'Test-owned fixture', 1);
    await controller.transcribe(); expect(audioPuts).toBe(2);
    expect(controller.getSnapshot().review).toBeNull();
    expect(controller.getSnapshot().rawConfirmed).toBe(false);
    controller.reset();
  });

  it('does not turn a concurrent NER intent still hashing into a retry of a newly failed attempt', async () => {
    const { controller, raw, job } = await audioSession('succeeded');
    let puts = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url.includes('/audio-jobs/')) return Response.json(job(url, options));
      puts++;
      return puts === 1 ? Response.json({ api_version: '1', error: { code: 'QUEUE_FULL', message: 'Queue full', stage: 'queued', retryable: true } }, { status: 429 }) : Response.json(nerJob(url, JSON.parse(options.body as string)));
    }));
    await controller.transcribe();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    let finishHash!: (digest: ArrayBuffer) => void;
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async () => digest).mockImplementationOnce(() => new Promise<ArrayBuffer>(resolve => { finishHash = resolve; }));
    const first = controller.recognize('raw', ['xlmr']);
    const concurrent = controller.recognize('raw', ['xlmr']);
    await first;
    expect(controller.getSnapshot().slots.raw.xlmr.state).toBe('failed');
    finishHash(digest); await concurrent;
    expect(puts).toBe(1);
    expect(controller.getSnapshot().slots.raw.xlmr.state).toBe('failed');
    await controller.recognize('raw', ['xlmr']);
    expect(puts).toBe(2);
    expect(controller.getSnapshot().slots.raw.xlmr.state).toBe('succeeded');
    controller.reset();
  });

  it('keeps a disconnected model paused until the same job is explicitly resumed', async () => {
    const { controller, job } = await audioSession('succeeded');
    let pendingUrl = ''; let pendingRequest!: Schema['NerRequest']; let puts = 0; let connected = false;
    const polled: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url.includes('/audio-jobs/')) return Response.json(job(url, options));
      if (url.includes('/ner-jobs/')) {
        puts++; pendingUrl = url; pendingRequest = JSON.parse(options.body as string);
        throw new TypeError('Disconnected after submission');
      }
      polled.push(url);
      if (!connected) throw new TypeError('Still disconnected');
      return Response.json(nerJob(pendingUrl, pendingRequest));
    }));
    await controller.transcribe(); await controller.recognize('raw', ['xlmr']);
    expect(controller.getSnapshot().slots.raw.xlmr.state).toBe('paused');
    await controller.recognize('raw', ['xlmr']); expect(puts).toBe(1);
    connected = true;
    const recovered = new Promise<void>(resolve => { const unsubscribe = controller.subscribe(() => { if (controller.getSnapshot().slots.raw.xlmr.state === 'succeeded') { unsubscribe(); resolve(); } }); });
    controller.resume(controller.getSnapshot().slots.raw.xlmr.jobId); await recovered;
    expect(puts).toBe(1);
    expect(polled).toEqual([pendingUrl.replace('/ner-jobs/', '/jobs/'), pendingUrl.replace('/ner-jobs/', '/jobs/')]);
    expect(controller.getSnapshot().slots.raw.xlmr.result?.text_sha256).toBe(controller.getSnapshot().asr?.text_sha256);
    controller.reset();
  });
});
