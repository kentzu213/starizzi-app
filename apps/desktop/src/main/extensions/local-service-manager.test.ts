import { describe, it, expect } from 'vitest';
import {
  parseGenSpec,
  generateSecretValue,
  resolveInject,
  resolveInjectAll,
  buildComposeUpArgs,
  buildComposeDownArgs,
  parseComposePsRunning,
  checkPortFree,
  findFreePort,
} from './local-service-manager';

describe('parseGenSpec', () => {
  it('parses hex and base64 specs', () => {
    expect(parseGenSpec('hex:64')).toEqual({ kind: 'hex', len: 64 });
    expect(parseGenSpec('base64:32')).toEqual({ kind: 'base64', len: 32 });
  });
  it('rejects malformed specs', () => {
    expect(parseGenSpec('md5')).toBeNull();
    expect(parseGenSpec('hex:0')).toBeNull();
    expect(parseGenSpec('hex:')).toBeNull();
    expect(parseGenSpec('')).toBeNull();
  });
});

describe('generateSecretValue', () => {
  it('produces a hex string of the requested length', () => {
    const v = generateSecretValue('hex:64');
    expect(v).toMatch(/^[0-9a-f]{64}$/);
  });
  it('produces distinct values (crypto-random)', () => {
    expect(generateSecretValue('hex:32')).not.toEqual(generateSecretValue('hex:32'));
  });
  it('produces base64 from N random bytes', () => {
    const v = generateSecretValue('base64:32');
    expect(v.length).toBeGreaterThanOrEqual(40); // 32 bytes → 44 chars incl padding
  });
  it('throws on a bad spec', () => {
    expect(() => generateSecretValue('nope')).toThrow();
  });
});

describe('resolveInject', () => {
  it('substitutes ${port.name} with the allocated host port', () => {
    expect(resolveInject('http://127.0.0.1:${port.api}', { api: 3001 })).toBe('http://127.0.0.1:3001');
  });
  it('leaves an unknown port token empty', () => {
    expect(resolveInject('http://127.0.0.1:${port.web}', { api: 3001 })).toBe('http://127.0.0.1:');
  });
  it('resolveInjectAll maps every key', () => {
    const out = resolveInjectAll({ backendUrl: 'http://127.0.0.1:${port.api}', webUrl: 'http://127.0.0.1:${port.web}' }, { api: 3001, web: 3005 });
    expect(out).toEqual({ backendUrl: 'http://127.0.0.1:3001', webUrl: 'http://127.0.0.1:3005' });
  });
});

describe('compose args (array-form, no shell interpolation)', () => {
  it('builds up args with -p / -f / --env-file / up -d', () => {
    expect(buildComposeUpArgs('izzi-svc-x', '/ext/compose.yml', '/data/.env')).toEqual([
      'compose', '-p', 'izzi-svc-x', '-f', '/ext/compose.yml', '--env-file', '/data/.env', 'up', '-d',
    ]);
  });
  it('down args never include -v (volumes are preserved)', () => {
    const args = buildComposeDownArgs('izzi-svc-x', '/ext/compose.yml', '/data/.env');
    expect(args).toContain('down');
    expect(args).not.toContain('-v');
    expect(args).not.toContain('--volumes');
  });
});

describe('parseComposePsRunning', () => {
  it('detects running from a JSON array', () => {
    expect(parseComposePsRunning('[{"Service":"api","State":"running"}]')).toBe(true);
  });
  it('detects running from newline-delimited JSON', () => {
    expect(parseComposePsRunning('{"Service":"api","State":"exited"}\n{"Service":"db","State":"running"}')).toBe(true);
  });
  it('returns false when nothing is running or output is empty', () => {
    expect(parseComposePsRunning('[{"Service":"api","State":"exited"}]')).toBe(false);
    expect(parseComposePsRunning('')).toBe(false);
    expect(parseComposePsRunning('garbage')).toBe(false);
  });
});

describe('port allocation', () => {
  it('reports a bound port as not free, and finds an alternative', async () => {
    const net = await import('node:net');
    const srv = net.createServer();
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
    const addr = srv.address();
    const taken = addr && typeof addr === 'object' ? addr.port : 0;

    expect(await checkPortFree(taken)).toBe(false);
    const alt = await findFreePort(taken);
    expect(alt).toBeGreaterThan(0);
    expect(alt).not.toBe(taken);

    await new Promise<void>((resolve) => srv.close(() => resolve()));
  });
});
