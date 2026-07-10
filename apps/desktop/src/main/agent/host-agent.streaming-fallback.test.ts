import { describe, expect, it } from 'vitest';
import { isStreamingUnsupportedError } from './host-agent';

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

  it('does NOT match unrelated errors (so only this case falls back)', () => {
    expect(isStreamingUnsupportedError(new Error('http 500: internal error'))).toBe(false);
    expect(isStreamingUnsupportedError(new Error('http 401: Unauthorized'))).toBe(false);
    expect(isStreamingUnsupportedError(new Error('fetch failed: ECONNREFUSED'))).toBe(false);
    // 400 but not a "not supported" reason -> real bad request, don't silently retry
    expect(isStreamingUnsupportedError(new Error('http 400: invalid tool schema'))).toBe(false);
  });
});
