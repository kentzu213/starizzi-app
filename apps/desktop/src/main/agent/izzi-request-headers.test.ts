import { describe, expect, it } from 'vitest';
import { buildIzziSourceHeaders, modelSupportsTools } from './izzi-request-headers';

describe('buildIzziSourceHeaders', () => {
  it.each([
    'https://api.izziapi.com/v1/chat/completions',
    'https://izziapi.com/v1/models',
  ])('attributes official Izzi HTTPS requests: %s', (url) => {
    expect(buildIzziSourceHeaders(url)).toEqual({ 'X-Source-Platform': 'starizzi' });
  });

  it.each([
    'https://custom.example.dev/v1/chat/completions',
    'https://api.izziapi.com.evil.test/v1/chat/completions',
    'http://api.izziapi.com/v1/chat/completions',
    'not-a-url',
  ])('does not leak the platform header to non-official endpoints: %s', (url) => {
    expect(buildIzziSourceHeaders(url)).toEqual({});
  });
});

describe('modelSupportsTools', () => {
  it('disables tools only for direct Sol while keeping SmartRouter and Grok capable', () => {
    expect(modelSupportsTools('gpt-5.6-sol')).toBe(false);
    expect(modelSupportsTools('izzi/gpt-5.6-sol')).toBe(false);
    expect(modelSupportsTools('izzi-smart')).toBe(true);
    expect(modelSupportsTools('grok-4.5-high')).toBe(true);
  });
});
