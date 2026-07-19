import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AuthManager logging boundary', () => {
  it('never writes raw OAuth callback URLs that may contain access or refresh tokens', () => {
    const source = fs.readFileSync(path.join(__dirname, 'auth-manager.ts'), 'utf8');

    expect(source).not.toMatch(/console\.(?:log|warn|error)\([^\n]*OAuth[^\n]*URL[^\n]*,\s*url/i);
  });
});
