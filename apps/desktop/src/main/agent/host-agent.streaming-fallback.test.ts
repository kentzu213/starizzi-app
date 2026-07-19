import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStreamingUnsupportedError, runHostAgentTurn } from './host-agent';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Guards the trigger for the non-streaming fallback: codex-lb on a Codex/ChatGPT
 * account rejects streaming+function-calling for some models (e.g. gpt-5.6-sol)
 * with a 400 "model is not supported" — we must detect that (and only that) to
 * retry non-streamed. Real error verified against the live endpoint.
 */
describe('isStreamingUnsupportedError', () => {
  it('matches the codex-lb / ChatGPT-account 400 "not supported" error', () => {
    const real =
      "http 400: {\"error\":{\"message\":\"The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account.\",\"type\":\"invalid_request_error\",\"code\":\"invalid_request_error\"}}";
    expect(isStreamingUnsupportedError(new Error(real))).toBe(true);
    expect(isStreamingUnsupportedError(real)).toBe(true);
  });

  it('matches the production 400 "streaming temporarily unavailable" error', () => {
    const real =
      'http 400: {"error":{"message":"streaming temporarily unavailable for this model","type":"invalid_request_error"}}';
    expect(isStreamingUnsupportedError(new Error(real))).toBe(true);
    expect(isStreamingUnsupportedError(real)).toBe(true);
  });

  it('does NOT match unrelated errors (so only this case falls back)', () => {
    expect(isStreamingUnsupportedError(new Error('http 500: internal error'))).toBe(false);
    expect(isStreamingUnsupportedError(new Error('http 401: Unauthorized'))).toBe(false);
    expect(isStreamingUnsupportedError(new Error('fetch failed: ECONNREFUSED'))).toBe(false);
    // 400 but not a known streaming limitation -> real bad request, don't silently retry
    expect(isStreamingUnsupportedError(new Error('http 400: invalid tool schema'))).toBe(false);
  });
});
describe('runHostAgentTurn production fallback', () => {
  it('retries the same direct Sol round with stream=false, no tools, and one idempotency key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: 'Streaming is temporarily unavailable for fixed-price models; retry with stream=false.',
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: 'SOL_OK' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await runHostAgentTurn({
      config: {
        baseUrl: 'https://api.izziapi.com/v1',
        authType: 'x-api-key',
        selectedModel: 'gpt-5.6-sol',
      },
      apiKey: 'test-key',
      message: 'reply exactly SOL_OK',
      history: [],
      images: [],
      mode: 'agent',
      turnId: 'turn-1',
      requestApproval: async () => 'deny',
    });

    expect(result).toEqual({ reply: 'SOL_OK' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requests = fetchMock.mock.calls.map(([, init]) => ({
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    }));
    expect(requests.map(({ body }) => body.stream)).toEqual([true, false]);
    expect(requests.map(({ body }) => body.model)).toEqual(['gpt-5.6-sol', 'gpt-5.6-sol']);
    expect(requests.every(({ body }) => body.tools === undefined && body.tool_choice === undefined)).toBe(true);
    expect(requests[0].headers['X-Source-Platform']).toBe('starizzi');
    expect(requests[0].headers['Idempotency-Key']).toBeTruthy();
    expect(requests[1].headers['Idempotency-Key']).toBe(requests[0].headers['Idempotency-Key']);
  });

  it('keeps tools for a local Sol-capable custom endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        'data: {"choices":[{"delta":{"content":"LOCAL_SOL_OK"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await runHostAgentTurn({
      config: {
        baseUrl: 'http://127.0.0.1:2455/v1',
        authType: 'bearer',
        selectedModel: 'gpt-5.6-sol',
      },
      apiKey: 'test-key',
      message: 'reply exactly LOCAL_SOL_OK',
      history: [],
      images: [],
      mode: 'agent',
      turnId: 'turn-local',
      requestApproval: async () => 'deny',
    });

    expect(result).toEqual({ reply: 'LOCAL_SOL_OK' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    const headers = init?.headers as Record<string, string>;
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tool_choice).toBe('auto');
    expect(headers['X-Source-Platform']).toBeUndefined();
    expect(headers['Idempotency-Key']).toBeUndefined();
  });
});
