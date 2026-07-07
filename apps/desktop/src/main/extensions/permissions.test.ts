import { describe, it, expect } from 'vitest';
import { resolveGrantedPermissions, hasPermission } from './permissions';

describe('resolveGrantedPermissions', () => {
  it('uses the stored grant when present (respects prior install/revocation)', () => {
    expect(resolveGrantedPermissions(['storage.local'], ['storage.local', 'net.http'])).toEqual([
      'storage.local',
    ]);
  });

  it('falls back to manifest permissions when nothing is stored', () => {
    expect(resolveGrantedPermissions([], ['storage.local', 'ui.panel', 'net.http'])).toEqual([
      'storage.local',
      'ui.panel',
      'net.http',
    ]);
  });

  it('returns [] when neither stored nor manifest permissions exist', () => {
    expect(resolveGrantedPermissions([], undefined)).toEqual([]);
    expect(resolveGrantedPermissions([], [])).toEqual([]);
  });
});

describe('hasPermission', () => {
  it('matches an exact permission', () => {
    expect(hasPermission(['ui.panel'], 'ui.panel')).toBe(true);
    expect(hasPermission(['ui.panel'], 'net.http')).toBe(false);
  });

  it('matches a category wildcard', () => {
    expect(hasPermission(['ui.*'], 'ui.panel')).toBe(true);
    expect(hasPermission(['fs.*'], 'ui.panel')).toBe(false);
  });

  it('denies against an empty grant (the bug this release fixes)', () => {
    expect(hasPermission([], 'ui.panel')).toBe(false);
    expect(hasPermission([], 'storage.local')).toBe(false);
  });
});
