import { describe, it, expect } from 'vitest';
import { validateServiceSpec, validateManifest, generateManifestTemplate } from './ocx-manifest';

/** A valid docker-compose service spec used as the happy-path baseline. */
function validService() {
  return {
    type: 'docker-compose',
    projectName: 'izzi-svc-social-auto-poster',
    compose: 'service/docker-compose.izzi.yml',
    ports: [{ name: 'api', container: 3001, healthPath: '/health', bind: '127.0.0.1' }],
    secrets: [{ key: 'JWT_SECRET', gen: 'hex:64' }],
    readyTimeoutMs: 180_000,
    inject: { backendUrl: 'http://127.0.0.1:${port.api}' },
    requires: { docker: true },
    fallback: { remoteEnvVar: 'AUTOPOST_BACKEND_URL' },
  };
}

describe('validateServiceSpec', () => {
  it('accepts a well-formed docker-compose service', () => {
    const r = validateServiceSpec(validService());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('requires an izzi-svc- project namespace', () => {
    const r = validateServiceSpec({ ...validService(), projectName: 'my-backend' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('projectName'))).toBe(true);
  });

  it('rejects path traversal in the compose path', () => {
    const r = validateServiceSpec({ ...validService(), compose: '../../etc/evil.yml' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('traversal'))).toBe(true);
  });

  it('rejects an absolute compose path (both OS styles)', () => {
    expect(validateServiceSpec({ ...validService(), compose: '/etc/x.yml' }).valid).toBe(false);
    expect(validateServiceSpec({ ...validService(), compose: 'C:\\x.yml' }).valid).toBe(false);
  });

  it('rejects a non-loopback port bind (no LAN exposure)', () => {
    const r = validateServiceSpec({
      ...validService(),
      ports: [{ name: 'api', container: 3001, bind: '0.0.0.0' }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('loopback'))).toBe(true);
  });

  it('accepts loopback binds and defaults (bind omitted)', () => {
    expect(validateServiceSpec({ ...validService(), ports: [{ name: 'api', container: 3001 }] }).valid).toBe(true);
    expect(
      validateServiceSpec({ ...validService(), ports: [{ name: 'api', container: 3001, bind: 'localhost' }] }).valid,
    ).toBe(true);
  });

  it('requires at least one port', () => {
    expect(validateServiceSpec({ ...validService(), ports: [] }).valid).toBe(false);
  });

  it('rejects an out-of-range container port', () => {
    expect(validateServiceSpec({ ...validService(), ports: [{ name: 'api', container: 70000 }] }).valid).toBe(false);
  });

  it('flags duplicate port names', () => {
    const r = validateServiceSpec({
      ...validService(),
      ports: [
        { name: 'api', container: 3001 },
        { name: 'api', container: 3002 },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('duplicated'))).toBe(true);
  });

  it('validates secret key + generator shape', () => {
    expect(validateServiceSpec({ ...validService(), secrets: [{ key: 'jwt', gen: 'hex:64' }] }).valid).toBe(false);
    expect(validateServiceSpec({ ...validService(), secrets: [{ key: 'JWT_SECRET', gen: 'md5' }] }).valid).toBe(false);
  });

  it('requires a command for node/binary services', () => {
    const r = validateServiceSpec({ type: 'node', projectName: 'izzi-svc-x', ports: [{ name: 'api', container: 3001 }] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('command'))).toBe(true);
  });

  it('warns when a docker-compose service has no fallback', () => {
    const spec = validService();
    delete (spec as any).fallback;
    const r = validateServiceSpec(spec);
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.includes('fallback'))).toBe(true);
  });

  it('rejects a non-object service', () => {
    expect(validateServiceSpec(null).valid).toBe(false);
    expect(validateServiceSpec([]).valid).toBe(false);
  });
});

describe('validateManifest with service block', () => {
  function baseManifest() {
    return {
      ...generateManifestTemplate('social-auto-poster'),
      permissions: ['net.http', 'ui.panel'],
      activationEvents: ['onStartup'],
    };
  }

  it('is valid when service is absent (backward compatible)', () => {
    expect(validateManifest(baseManifest()).valid).toBe(true);
  });

  it('is valid with a well-formed service', () => {
    const r = validateManifest({ ...baseManifest(), service: validService() });
    expect(r.valid).toBe(true);
  });

  it('surfaces service errors through the top-level manifest validation', () => {
    const r = validateManifest({ ...baseManifest(), service: { ...validService(), projectName: 'bad' } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('projectName'))).toBe(true);
  });
});
