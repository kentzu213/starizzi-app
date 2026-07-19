import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  chatCompletionJsonToSse,
  createNonStreamingRetryBody,
  FIXED_PRICE_STREAMING_ERROR,
  forceSmartModel,
  IzziLlmProxy,
  isFixedPriceStreamingLimitation,
  isForwardablePath,
  parseBearer,
  safeTokenEqual,
  IZZI_SMART_MODEL,
} from './izzi-llm-proxy';

describe('forceSmartModel', () => {
  it('overwrites the model with izzi-smart, preserving other fields', () => {
    const input = Buffer.from(JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], stream: true }));
    const out = JSON.parse(forceSmartModel(input).toString('utf8'));
    expect(out.model).toBe(IZZI_SMART_MODEL);
    expect(out.stream).toBe(true);
    expect(out.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('adds model when absent', () => {
    const out = JSON.parse(forceSmartModel(Buffer.from(JSON.stringify({ messages: [] }))).toString('utf8'));
    expect(out.model).toBe(IZZI_SMART_MODEL);
  });

  it('returns non-JSON bodies unchanged', () => {
    const raw = Buffer.from('not json');
    expect(forceSmartModel(raw)).toBe(raw);
  });

  it('returns empty bodies unchanged', () => {
    const empty = Buffer.alloc(0);
    expect(forceSmartModel(empty)).toBe(empty);
  });

  it('leaves a JSON array untouched (only objects are patched)', () => {
    const arr = Buffer.from(JSON.stringify([1, 2, 3]));
    expect(forceSmartModel(arr).toString('utf8')).toBe('[1,2,3]');
  });
});

describe('isForwardablePath', () => {
  it('accepts /v1/* routes', () => {
    expect(isForwardablePath('/v1/chat/completions')).toBe(true);
    expect(isForwardablePath('/v1/models')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isForwardablePath('/')).toBe(false);
    expect(isForwardablePath('/health')).toBe(false);
    expect(isForwardablePath('/v2/chat')).toBe(false);
  });
});

describe('safeTokenEqual', () => {
  it('is true only for identical non-empty tokens', () => {
    expect(safeTokenEqual('abc123', 'abc123')).toBe(true);
  });

  it('is false for different tokens or empty input', () => {
    expect(safeTokenEqual('abc123', 'abc124')).toBe(false);
    expect(safeTokenEqual('abc', 'abcd')).toBe(false);
    expect(safeTokenEqual('', '')).toBe(false);
    expect(safeTokenEqual('abc', '')).toBe(false);
  });
});

describe('parseBearer', () => {
  it('extracts the token from a Bearer header', () => {
    expect(parseBearer('Bearer sk-123')).toBe('sk-123');
    expect(parseBearer('bearer   sk-456  ')).toBe('sk-456');
  });

  it('returns null for missing or malformed headers', () => {
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer('Basic abc')).toBeNull();
    expect(parseBearer('')).toBeNull();
  });
});

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve((server.address() as { port: number }).port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function postChat(
  port: number,
  token: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': String(body.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('fixed-price streaming fallback helpers', () => {
  it('matches only the exact known HTTP 400 streaming limitation', () => {
    const body = Buffer.from(JSON.stringify({ error: { message: FIXED_PRICE_STREAMING_ERROR } }));
    expect(isFixedPriceStreamingLimitation(400, body)).toBe(true);
    expect(isFixedPriceStreamingLimitation(500, body)).toBe(false);
    expect(isFixedPriceStreamingLimitation(400, Buffer.from(JSON.stringify({
      error: { message: `${FIXED_PRICE_STREAMING_ERROR} extra` },
    })))).toBe(false);
    expect(isFixedPriceStreamingLimitation(400, Buffer.from('not json'))).toBe(false);
  });

  it('clones a streaming chat body with stream=false and preserves its request fields', () => {
    const input = {
      model: IZZI_SMART_MODEL,
      stream: true,
      messages: [{ role: 'user', content: 'use the tool' }],
      tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
      tool_choice: 'auto',
      temperature: 0.2,
    };
    const retry = createNonStreamingRetryBody(Buffer.from(JSON.stringify(input)));
    expect(retry).not.toBeNull();
    expect(JSON.parse(retry!.toString('utf8'))).toEqual({ ...input, stream: false });
    expect(createNonStreamingRetryBody(Buffer.from(JSON.stringify({ ...input, stream: false })))).toBeNull();
  });

  it('adapts content and tool_calls to OpenAI SSE and terminates with [DONE]', () => {
    const json = Buffer.from(JSON.stringify({
      id: 'chatcmpl-retry',
      object: 'chat.completion',
      created: 123,
      model: IZZI_SMART_MODEL,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'fallback ok',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'lookup', arguments: '{"query":"izzi"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }));

    const sse = chatCompletionJsonToSse(json)?.toString('utf8');
    expect(sse).toBeTruthy();
    const payloads = sse!
      .split('\n\n')
      .filter(Boolean)
      .map((event) => event.replace(/^data: /, ''));
    expect(payloads.at(-1)).toBe('[DONE]');

    const delta = JSON.parse(payloads[0]);
    expect(delta.object).toBe('chat.completion.chunk');
    expect(delta.choices[0].delta.content).toBe('fallback ok');
    expect(delta.choices[0].delta.tool_calls).toEqual([{
      index: 0,
      id: 'call_1',
      type: 'function',
      function: { name: 'lookup', arguments: '{"query":"izzi"}' },
    }]);
    const terminal = JSON.parse(payloads[1]);
    expect(terminal.choices[0]).toMatchObject({ delta: {}, finish_reason: 'tool_calls' });
  });
});

describe('IzziLlmProxy fixed-price streaming fallback', () => {
  it('retries as JSON with the same idempotency key, then returns valid SSE', async () => {
    const requests: Array<{ headers: http.IncomingHttpHeaders; body: Record<string, unknown> }> = [];
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        requests.push({
          headers: req.headers,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        });
        res.setHeader('Content-Type', 'application/json');
        if (requests.length === 1) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { message: FIXED_PRICE_STREAMING_ERROR } }));
          return;
        }
        res.end(JSON.stringify({
          id: 'chatcmpl-retried',
          created: 456,
          model: IZZI_SMART_MODEL,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{
                id: 'call_2',
                type: 'function',
                function: { name: 'lookup', arguments: '{"query":"api"}' },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        }));
      });
    });
    const upstreamPort = await listen(upstream);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-llm-proxy-'));
    const proxy = new IzziLlmProxy({
      resolveCredential: async () => 'test-credential',
      statePath: path.join(tempDir, 'state.json'),
      upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
    });

    try {
      const runtime = await proxy.ensureStarted();
      const messages = [{ role: 'user', content: 'call lookup' }];
      const tools = [{ type: 'function', function: { name: 'lookup' } }];
      const response = await postChat(runtime.port, runtime.token, {
        model: 'client-model',
        stream: true,
        messages,
        tools,
      });

      expect(requests).toHaveLength(2);
      expect(requests.map(({ body }) => body.stream)).toEqual([true, false]);
      expect(requests.map(({ body }) => body.model)).toEqual([IZZI_SMART_MODEL, IZZI_SMART_MODEL]);
      expect(requests.every(({ body }) => JSON.stringify(body.messages) === JSON.stringify(messages))).toBe(true);
      expect(requests.every(({ body }) => JSON.stringify(body.tools) === JSON.stringify(tools))).toBe(true);
      expect(requests[0].headers['x-source-platform']).toBe('starizzi');
      expect(requests[0].headers['idempotency-key']).toBeTruthy();
      expect(requests[1].headers['idempotency-key']).toBe(requests[0].headers['idempotency-key']);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.body).toContain('"tool_calls"');
      expect(response.body).toMatch(/data: \[DONE\]\n\n$/);
    } finally {
      await proxy.stop();
      await close(upstream);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
