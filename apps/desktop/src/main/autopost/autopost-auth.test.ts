import { describe, expect, it } from 'vitest';
import { jwtExpiryMs } from './autopost-auth';

function fakeJwt(payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

describe('autopost-auth jwtExpiryMs', () => {
  it('decodes exp (seconds) to milliseconds', () => {
    expect(jwtExpiryMs(fakeJwt({ exp: 1_700_000_000, sub: 'u1', workspaceId: 'w1' }))).toBe(1_700_000_000_000);
  });

  it('returns 0 for missing/invalid exp or a malformed token (fail-safe)', () => {
    expect(jwtExpiryMs(fakeJwt({ sub: 'u1' }))).toBe(0);
    expect(jwtExpiryMs('not-a-jwt')).toBe(0);
    expect(jwtExpiryMs('')).toBe(0);
    expect(jwtExpiryMs('header.only')).toBe(0);
  });
});
