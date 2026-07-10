import { describe, it, expect } from 'vitest';
import {
  MAX_LOG_LINES,
  deriveEndpoint,
  endpointFromBaseUrl,
  capLogs,
  phaseFromStatus,
  statusHasService,
  shouldAutoStart,
} from './extension-service-panel.logic';

describe('deriveEndpoint', () => {
  it('prefers the api port', () => {
    expect(deriveEndpoint({ api: 3001, web: 3005 })).toBe('127.0.0.1:3001');
  });
  it('falls back to the first port when there is no api port', () => {
    expect(deriveEndpoint({ web: 3005 })).toBe('127.0.0.1:3005');
  });
  it('returns null when ports are missing/empty', () => {
    expect(deriveEndpoint(undefined)).toBeNull();
    expect(deriveEndpoint({})).toBeNull();
  });
});

describe('endpointFromBaseUrl', () => {
  it('strips http/https scheme', () => {
    expect(endpointFromBaseUrl('http://127.0.0.1:3001')).toBe('127.0.0.1:3001');
    expect(endpointFromBaseUrl('https://autopost.izziapi.com')).toBe('autopost.izziapi.com');
  });
  it('returns null for empty/undefined', () => {
    expect(endpointFromBaseUrl(undefined)).toBeNull();
    expect(endpointFromBaseUrl('')).toBeNull();
  });
});

describe('capLogs', () => {
  it('appends within the cap', () => {
    expect(capLogs(['a'], 'b', 3)).toEqual(['a', 'b']);
  });
  it('keeps only the newest `max` lines', () => {
    expect(capLogs(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });
  it('defaults to MAX_LOG_LINES', () => {
    const full = Array.from({ length: MAX_LOG_LINES }, (_v, i) => `l${i}`);
    const next = capLogs(full, 'new');
    expect(next.length).toBe(MAX_LOG_LINES);
    expect(next[next.length - 1]).toBe('new');
    expect(next[0]).toBe('l1'); // oldest ('l0') dropped
  });
});

describe('phaseFromStatus', () => {
  it('is running when the backend is running', () => {
    expect(phaseFromStatus({ running: true })).toBe('running');
  });
  it('is idle when not running', () => {
    expect(phaseFromStatus({ running: false })).toBe('idle');
    expect(phaseFromStatus({})).toBe('idle');
  });
});

describe('statusHasService', () => {
  it('true only when the query succeeded AND a service is declared', () => {
    expect(statusHasService({ success: true, hasService: true })).toBe(true);
    expect(statusHasService({ success: true, hasService: false })).toBe(false);
    expect(statusHasService({ success: false, hasService: true })).toBe(false);
    expect(statusHasService({})).toBe(false);
  });
});

describe('shouldAutoStart', () => {
  const base = { isInstalled: true, hasService: true, running: false, alreadyStarted: false };

  it('auto-starts for an installed, service-having, not-running, not-yet-started extension', () => {
    expect(shouldAutoStart(base)).toBe(true);
  });
  it('does not auto-start when not installed', () => {
    expect(shouldAutoStart({ ...base, isInstalled: false })).toBe(false);
  });
  it('does not auto-start when there is no service', () => {
    expect(shouldAutoStart({ ...base, hasService: false })).toBe(false);
  });
  it('does not auto-start when already running', () => {
    expect(shouldAutoStart({ ...base, running: true })).toBe(false);
  });
  it('does not auto-start twice (StrictMode double-invoke guard)', () => {
    expect(shouldAutoStart({ ...base, alreadyStarted: true })).toBe(false);
  });
});
