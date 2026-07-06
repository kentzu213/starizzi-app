import { describe, expect, it } from 'vitest';
import {
  forceSmartModel,
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
