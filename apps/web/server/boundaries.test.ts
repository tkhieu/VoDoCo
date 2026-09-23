import { createServer, request as httpRequest, type RequestListener, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { createApp, readConfig, type ProxyConfig } from './index.js';

const servers: Server[] = [];

async function listen(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing TCP address');
  return new URL(`http://127.0.0.1:${address.port}`);
}

async function requestStatus(
  url: URL,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return await new Promise<number>((resolve, reject) => {
    const request = httpRequest(url, { method: init.method, headers: init.headers }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    request.once('error', reject);
    request.end(init.body);
  });
}

async function startProxy(upstream: URL, preview = false) {
  const config: ProxyConfig = {
    port: 0, origin: new URL('http://127.0.0.1'), upstream,
    token: 'test-only-service-token-with-at-least-32-bytes', preview,
    samplePath: null, sampleProvenance: '', staticDirectory: '/nonexistent-vodoco-test-assets',
  };
  const origin = await listen(createApp(config));
  config.origin = origin;
  config.port = Number(origin.port);
  return origin;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
});

it('allows only the exact Compose inference service when explicitly enabled', () => {
  const base = {
    APP_ORIGIN: 'https://vodoco.hieutk.dev',
    INFERENCE_COMPOSE_SERVICE: '1',
    INFERENCE_SERVICE_TOKEN: 's'.repeat(32),
  };
  expect(readConfig({ ...base, INFERENCE_BASE_URL: 'http://inference:8000' }).upstream?.origin)
    .toBe('http://inference:8000');
  expect(() => readConfig({ ...base, INFERENCE_COMPOSE_SERVICE: undefined, INFERENCE_BASE_URL: 'http://inference:8000' }))
    .toThrow(/INFERENCE_BASE_URL/);
  for (const upstream of [
    'http://inference:8001',
    'http://other:8000',
    'https://inference:8000',
    'http://inference:8000/path',
    'http://user:password@inference:8000',
  ]) {
    expect(() => readConfig({ ...base, INFERENCE_BASE_URL: upstream })).toThrow(/INFERENCE_BASE_URL/);
  }
});

it('denies the entire preview API even with a configured inference credential', async () => {
  let accesses = 0;
  const upstream = await listen((_req, res) => { accesses += 1; res.end('{}'); });
  const origin = await startProxy(upstream, true);
  for (const path of ['/api/v1/models', '/api/v2/models', '/api/sample', '/api/sample/audio']) {
    const response = await fetch(new URL(path, origin));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'ORIGIN_DENIED' } });
  }
  expect(accesses).toBe(0);
  expect((await fetch(new URL('/healthz', origin))).status).toBe(200);
});

it('rejects cross-origin mutations before privileged inference access', async () => {
  let accesses = 0;
  const upstream = await listen((_req, res) => {
    accesses += 1;
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end('{"accepted":true}');
  });
  const origin = await startProxy(upstream);
  const target = new URL('/api/v1/ner-jobs/11111111-1111-4111-8111-111111111111', origin);
  const headers = { 'Content-Type': 'application/json', 'X-Job-Token': 'a'.repeat(64), Origin: 'https://attacker.example' };
  const denied = await fetch(target, { method: 'PUT', headers, body: '{}' });
  expect(denied.status).toBe(403);
  expect(accesses).toBe(0);
  const accepted = await fetch(target, { method: 'PUT', headers: { ...headers, Origin: origin.origin }, body: '{}' });
  expect(accepted.status).toBe(202);
  expect(accesses).toBe(1);
});

it('accepts equivalent loopback origins without accepting remote hosts', async () => {
  let accesses = 0;
  const upstream = await listen((_req, res) => {
    accesses += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  const origin = await startProxy(upstream);
  const localhost = new URL(origin);
  localhost.hostname = 'localhost';
  const accepted = await requestStatus(new URL('/api/v1/models', origin), {
    headers: { Host: localhost.host },
  });
  expect(accepted).toBe(200);
  const mutation = await requestStatus(new URL('/api/v1/ner-jobs/11111111-1111-4111-8111-111111111111', origin), {
    method: 'PUT',
    headers: {
      Host: localhost.host,
      Origin: localhost.origin,
      'Content-Type': 'application/json',
      'X-Job-Token': 'a'.repeat(64),
    },
    body: '{}',
  });
  expect(mutation).toBe(200);
  const denied = await requestStatus(new URL('/api/v1/models', origin), {
    headers: { Host: 'attacker.example' },
  });
  expect(denied).toBe(403);
  expect(accesses).toBe(2);
});

it('never follows upstream redirects to another credential recipient', async () => {
  let redirected = false;
  const recipient = await listen((_req, res) => { redirected = true; res.end('{}'); });
  const upstream = await listen((_req, res) => {
    res.writeHead(307, { Location: recipient.href });
    res.end();
  });
  const origin = await startProxy(upstream);
  const response = await fetch(new URL('/api/v1/models', origin));
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
  expect(redirected).toBe(false);
});

it('forwards the exact ViHealthBERT audio model id and rejects near matches', async () => {
  let accesses = 0;
  let forwardedUrl = '';
  const upstream = await listen((req, res) => {
    accesses += 1;
    forwardedUrl = req.url ?? '';
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end('{"accepted":true}');
  });
  const origin = await startProxy(upstream);
  const headers = {
    Origin: origin.origin,
    'Content-Type': 'application/octet-stream',
    'X-Job-Token': 'a'.repeat(64),
    'X-Input-Sha256': 'b'.repeat(64),
    'X-Session-Id': '22222222-2222-4222-8222-222222222222',
  };
  const base = '/api/v1/audio-jobs/33333333-3333-4333-8333-333333333333?ner_model=';
  expect(await requestStatus(new URL(`${base}vihealthbert-ner-seed2024`, origin), { method: 'PUT', headers, body: 'x' })).toBe(202);
  expect(await requestStatus(new URL(`${base}vihealthbert-ner-seed2024-typo`, origin), { method: 'PUT', headers, body: 'x' })).toBe(400);
  expect(accesses).toBe(1);
  expect(forwardedUrl).toBe('/v1/audio-jobs/33333333-3333-4333-8333-333333333333?ner_model=vihealthbert-ner-seed2024');
});
it('bounds chunked audio by actual bytes and aborts the receiving upstream', async () => {
  let release!: () => void;
  const aborted = new Promise<void>((resolve) => { release = resolve; });
  let received = 0;
  const upstream = await listen((req) => {
    req.on('data', (chunk: Buffer) => { received += chunk.length; });
    req.once('aborted', release);
  });
  const origin = await startProxy(upstream);
  let chunks = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (chunks < 160) controller.enqueue(new Uint8Array(65_536));
      else if (chunks === 160) controller.enqueue(Uint8Array.of(1));
      else controller.close();
      chunks += 1;
    },
  });
  const init = {
    method: 'PUT', body, duplex: 'half' as const,
    headers: {
      Origin: origin.origin, 'Content-Type': 'application/octet-stream',
      'X-Job-Token': 'a'.repeat(64), 'X-Input-Sha256': 'b'.repeat(64),
      'X-Session-Id': '22222222-2222-4222-8222-222222222222',
    },
  };
  const response = await fetch(new URL('/api/v1/audio-jobs/33333333-3333-4333-8333-333333333333?ner_model=phobert', origin), init);
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ error: { code: 'INPUT_TOO_LARGE' } });
  await aborted;
  expect(received).toBeLessThanOrEqual(10_485_760);
});
