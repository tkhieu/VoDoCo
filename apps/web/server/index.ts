import express, { type Request, type Response } from 'express';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { components } from '../../../contracts/generated/demo-api.js';

type ApiError = components['schemas']['ApiError'];
const UPLOAD_BYTES = 10_485_760;
const TEXT_BYTES = 32_768;
const RESPONSE_BYTES = 262_144;
const UUID = '[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}';
const JOB_PATH = new RegExp(`^/api/v1/(audio-jobs|ner-jobs|jobs)/(${UUID})$`);
const HEX_256 = /^[a-f0-9]{64}$/;
const LOOPBACK: Record<string, true> = { '127.0.0.1': true, localhost: true, '[::1]': true };
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface ProxyConfig {
  port: number;
  origin: URL;
  upstream: URL | null;
  token: string;
  preview: boolean;
  samplePath: string | null;
  sampleProvenance: string;
  staticDirectory: string;
}

function matchesAppOrigin(candidate: string | undefined, configured: URL): boolean {
  if (!candidate) return false;
  try {
    const parsed = new URL(candidate);
    if (parsed.origin === configured.origin) return true;
    return Object.hasOwn(LOOPBACK, parsed.hostname)
      && Object.hasOwn(LOOPBACK, configured.hostname)
      && parsed.protocol === configured.protocol
      && parsed.port === configured.port;
  } catch {
    return false;
  }
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const origin = new URL(env.APP_ORIGIN || `http://127.0.0.1:${port}`);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error('APP_ORIGIN must be an origin without credentials or path');
  }
  const local = Object.hasOwn(LOOPBACK, origin.hostname);
  if (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) {
    throw new Error('APP_ORIGIN requires HTTPS outside localhost');
  }
  const preview = Boolean(env.REPLIT_DEV_DOMAIN);
  const upstream = env.INFERENCE_BASE_URL ? new URL(env.INFERENCE_BASE_URL) : null;
  if (upstream) {
    const localUpstream = local && !preview && upstream.protocol === 'http:' && Object.hasOwn(LOOPBACK, upstream.hostname);
    const composeUpstream = env.INFERENCE_COMPOSE_SERVICE === '1' && !preview
      && upstream.protocol === 'http:' && upstream.hostname === 'inference' && upstream.port === '8000';
    const podUpstream = upstream.protocol === 'https:' && /^[a-z0-9-]+-8000\.proxy\.runpod\.net$/.test(upstream.hostname) && !upstream.port;
    if ((!localUpstream && !composeUpstream && !podUpstream) || upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash) {
      throw new Error('INFERENCE_BASE_URL must be the fixed Compose, RunPod, or local development origin');
    }
  }
  const token = env.INFERENCE_SERVICE_TOKEN || '';
  if (upstream && Buffer.byteLength(token, 'utf8') < 32) throw new Error('INFERENCE_SERVICE_TOKEN must contain at least 32 bytes');
  if (/[^\x21-\x7e]/.test(token)) throw new Error('INFERENCE_SERVICE_TOKEN must contain printable ASCII without spaces');
  const sampleProvenance = env.DEMO_SAMPLE_PROVENANCE || '';
  const samplePath = env.DEMO_SAMPLE_APPROVED === '1' && env.DEMO_SAMPLE_PATH && sampleProvenance
    ? resolve(appDirectory, '../..', env.DEMO_SAMPLE_PATH) : null;
  return { port, origin, upstream, token, preview, samplePath, sampleProvenance, staticDirectory: resolve(appDirectory, 'dist') };
}

function fail(res: Response, status: number, code: string, message: string, retryable = false): void {
  if (res.headersSent || res.destroyed) return;
  const error: ApiError = { code, stage: 'proxy', retryable, message };
  res.status(status).json({ error });
}

function rejectBody(req: Request, res: Response, status: number, code: string, message: string): void {
  req.pause();
  res.setHeader('Connection', 'close');
  fail(res, status, code, message);
}

function proxy(req: Request, res: Response, config: ProxyConfig): void {
  const url = new URL(req.originalUrl, config.origin);
  const match = JOB_PATH.exec(url.pathname);
  const isModels = url.pathname === '/api/v1/models';
  if (!isModels && !match) {
    fail(res, 404, 'NOT_FOUND', 'Không tìm thấy API.');
    return;
  }
  const kind = match?.[1];
  const method = kind === 'audio-jobs' || kind === 'ner-jobs' ? 'PUT' : 'GET';
  if (req.method !== method) {
    res.setHeader('Allow', method);
    rejectBody(req, res, 405, 'METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ.');
    return;
  }
  const audio = kind === 'audio-jobs';
  const queryKeys = [...url.searchParams.keys()];
  if (audio ? queryKeys.length !== 1 || queryKeys[0] !== 'ner_model' || !['phobert', 'xlmr'].includes(url.searchParams.get('ner_model') || '') : queryKeys.length !== 0) {
    rejectBody(req, res, 400, 'BAD_REQUEST', 'Tham số yêu cầu không hợp lệ.');
    return;
  }
  if (!isModels && !HEX_256.test(req.get('X-Job-Token') || '')) {
    rejectBody(req, res, 404, 'JOB_UNAVAILABLE', 'Không tìm thấy tác vụ hoặc quyền truy cập.');
    return;
  }
  if (audio && (!HEX_256.test(req.get('X-Input-Sha256') || '') || !new RegExp(`^${UUID}$`).test(req.get('X-Session-Id') || ''))) {
    rejectBody(req, res, 400, 'BAD_REQUEST', 'Thông tin đầu vào không hợp lệ.');
    return;
  }
  const contentType = (req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (method === 'PUT' && contentType !== (audio ? 'application/octet-stream' : 'application/json')) {
    rejectBody(req, res, 415, 'UNSUPPORTED_MEDIA', 'Định dạng yêu cầu không được hỗ trợ.');
    return;
  }
  const limit = audio ? UPLOAD_BYTES : TEXT_BYTES;
  const declaredLength = req.get('Content-Length');
  if (declaredLength !== undefined && (!/^\d+$/.test(declaredLength) || !Number.isSafeInteger(Number(declaredLength)))) {
    rejectBody(req, res, 400, 'BAD_REQUEST', 'Kích thước yêu cầu không hợp lệ.');
    return;
  }
  if (declaredLength !== undefined && Number(declaredLength) > limit) {
    rejectBody(req, res, 413, 'INPUT_TOO_LARGE', audio ? 'Audio vượt quá 10 MiB.' : 'Văn bản vượt quá giới hạn yêu cầu.');
    return;
  }
  if (method === 'GET' && (Number(declaredLength || 0) > 0 || req.get('Transfer-Encoding'))) {
    rejectBody(req, res, 400, 'BAD_REQUEST', 'GET không nhận nội dung yêu cầu.');
    return;
  }
  if (!config.upstream || !config.token || config.preview) {
    rejectBody(req, res, 503, 'SERVICE_UNAVAILABLE', 'Dịch vụ inference chưa được kết nối trong môi trường này.');
    return;
  }

  const target = new URL(`${url.pathname.slice(4)}${url.search}`, config.upstream);
  const headers: Record<string, string> = { Authorization: `Bearer ${config.token}`, Accept: 'application/json' };
  for (const header of ['X-Job-Token', 'X-Session-Id', 'X-Input-Sha256']) {
    const value = req.get(header);
    if (value) headers[header] = value;
  }
  if (method === 'PUT') headers['Content-Type'] = contentType;
  if (method === 'PUT' && declaredLength !== undefined) headers['Content-Length'] = declaredLength;
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
  let settled = false;
  let size = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      callback(size > limit ? new Error('BODY_LIMIT') : null, size > limit ? undefined : chunk);
    },
  });
  const upstream = transport(target, { method, headers }, (incoming) => {
    const chunks: Buffer[] = [];
    let responseSize = 0;
    incoming.on('data', (chunk: Buffer) => {
      responseSize += chunk.length;
      if (responseSize > RESPONSE_BYTES) {
        finishError(502, 'SERVICE_UNAVAILABLE', 'Phản hồi inference vượt quá giới hạn.');
        incoming.destroy();
      } else chunks.push(chunk);
    });
    incoming.on('error', () => finishError(502, 'SERVICE_UNAVAILABLE', 'Mất kết nối với dịch vụ inference.'));
    incoming.on('end', () => {
      if (settled) return;
      const status = incoming.statusCode || 502;
      if (status >= 300 && status < 400) {
        finishError(502, 'SERVICE_UNAVAILABLE', 'Dịch vụ inference trả về chuyển hướng không được phép.');
        return;
      }
      let body: unknown;
      try {
        if (!incoming.headers['content-type']?.toLowerCase().includes('application/json')) throw new Error('NON_JSON');
        body = JSON.parse(Buffer.concat(chunks, responseSize).toString('utf8'));
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('BAD_JSON');
      } catch {
        finishError(502, 'SERVICE_UNAVAILABLE', 'Dịch vụ inference chưa trả về phản hồi hợp lệ.');
        return;
      }
      settled = true;
      clearTimeout(deadline);
      if (!req.readableEnded && method === 'PUT') {
        req.unpipe(limiter);
        limiter.unpipe(upstream);
        req.pause();
        res.setHeader('Connection', 'close');
        upstream.end();
      }
      const retryAfter = incoming.headers['retry-after'];
      if (typeof retryAfter === 'string' && /^\d{1,5}$/.test(retryAfter)) res.setHeader('Retry-After', retryAfter);
      res.status(status).json(body);
    });
  });
  function finishError(status: number, code: string, message: string): void {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    req.unpipe(limiter);
    limiter.unpipe(upstream);
    upstream.destroy();
    if (!req.readableEnded) {
      req.pause();
      res.setHeader('Connection', 'close');
    }
    fail(res, status, code, message, status >= 500);
  }
  const deadline = setTimeout(() => finishError(504, 'SERVICE_UNAVAILABLE', 'Hết thời gian kết nối. Kiểm tra trạng thái tác vụ trước khi thử lại.'), method === 'PUT' ? 60_000 : 10_000);
  deadline.unref();
  upstream.on('error', () => finishError(502, 'SERVICE_UNAVAILABLE', 'Không kết nối được dịch vụ inference.'));
  limiter.on('error', () => finishError(413, 'INPUT_TOO_LARGE', audio ? 'Audio vượt quá 10 MiB.' : 'Văn bản vượt quá giới hạn yêu cầu.'));
  req.on('aborted', () => {
    settled = true;
    clearTimeout(deadline);
    upstream.destroy();
    limiter.destroy();
  });
  res.on('close', () => {
    clearTimeout(deadline);
    if (!settled) {
      settled = true;
      upstream.destroy();
      limiter.destroy();
    }
  });
  if (method === 'PUT') req.pipe(limiter).pipe(upstream);
  else upstream.end();
}

export function createApp(config = readConfig()) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'");
    next();
  });
  app.get('/healthz', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ status: 'ok' }); });
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const requestOrigin = req.get('Host') ? `${config.origin.protocol}//${req.get('Host')}` : undefined;
    if (config.preview || !matchesAppOrigin(requestOrigin, config.origin)) {
      rejectBody(req, res, 403, 'ORIGIN_DENIED', 'API chỉ khả dụng tại địa chỉ ứng dụng đã cấu hình.');
      return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !matchesAppOrigin(req.get('Origin'), config.origin)) {
      rejectBody(req, res, 403, 'ORIGIN_DENIED', 'Nguồn yêu cầu không hợp lệ.');
      return;
    }
    next();
  });
  async function approvedSample(): Promise<boolean> {
    if (!config.samplePath) return false;
    try {
      const info = await stat(config.samplePath);
      return info.isFile() && info.size > 0 && info.size <= UPLOAD_BYTES;
    } catch { return false; }
  }
  app.get('/api/sample', async (_req, res) => {
    const available = await approvedSample();
    res.json(available ? { available: true, name: basename(config.samplePath!), provenance: config.sampleProvenance } : { available: false });
  });
  app.get('/api/sample/audio', async (_req, res) => {
    if (!await approvedSample()) { fail(res, 404, 'SAMPLE_UNAVAILABLE', 'Chưa cấu hình audio mẫu được phép sử dụng.'); return; }
    res.sendFile(config.samplePath!, { cacheControl: false, lastModified: false }, (error) => {
      if (error && !res.headersSent) fail(res, 503, 'SAMPLE_UNAVAILABLE', 'Không đọc được audio mẫu.');
    });
  });
  app.use('/api', (req, res) => proxy(req, res, config));
  app.use(express.static(config.staticDirectory, { index: false, dotfiles: 'deny' }));
  app.use((req, res) => {
    if (req.method === 'GET' && ['/', '/workspace'].includes(req.path)) {
      res.sendFile(resolve(config.staticDirectory, 'index.html'), (error) => {
        if (error && !res.headersSent) fail(res, 503, 'APP_UNAVAILABLE', 'Ứng dụng chưa được build.');
      });
    } else fail(res, 404, 'NOT_FOUND', 'Không tìm thấy trang.');
  });
  app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    fail(res, error instanceof URIError ? 400 : 500, 'REQUEST_FAILED', 'Không thể xử lý yêu cầu.');
  });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = readConfig();
  const server = createApp(config).listen(config.port, Object.hasOwn(LOOPBACK, config.origin.hostname) && !config.preview ? '127.0.0.1' : '0.0.0.0', () => {
    console.log(`VoDoCo web ready on port ${config.port}`);
  });
  server.requestTimeout = 65_000;
  server.headersTimeout = 15_000;
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 5_000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
