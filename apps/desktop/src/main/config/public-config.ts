/**
 * Public runtime config for the Electron MAIN process.
 *
 * Two jobs, in order:
 *   1. Best-effort load a local `.env` into `process.env` (dev / self-hosted
 *      override). No new deps — same KEY=VALUE parser style as the repo scripts.
 *   2. Resolve the THREE public endpoints with build-time defaults so the app
 *      connects to izziapi.com for real even when packaged (no `.env` shipped).
 *
 * security-baseline A: every value here is PUBLIC — the same values izzi-web
 * commits as `NEXT_PUBLIC_*`. The Supabase ANON key is the public client role
 * (RLS-guarded); it is NOT the service_role key. NO secret (service_role,
 * JWT_SECRET, DATABASE_URL, izzi- key) is ever placed in this file.
 *
 * Importing this module FIRST (it is a side-effecting import) guarantees the
 * `.env` is loaded before AuthManager / SyncEngine / GraphClient read their
 * constants.
 */

import { readFileSync, existsSync } from 'fs';
import * as path from 'path';

/** Public production endpoints for izziapi.com (same Supabase project as izzi-web). */
const PUBLIC_DEFAULTS = {
  OPENCLAW_API_URL: 'https://api.izziapi.com',
  OPENCLAW_SUPABASE_URL: 'https://qdtfaebdgyyujygxnvqi.supabase.co',
  OPENCLAW_SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkdGZhZWJkZ3l5dWp5Z3hudnFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1Mjk2NjYsImV4cCI6MjA5MDEwNTY2Nn0.tVQKuDcX3WFSNTPxiZU4aenv4OVsJ9bMouxYPiYkUck',
  OPENCLAW_WEB_URL: 'https://izziapi.com',
} as const;

/** Parse a dotenv-style file into a flat map. Values are never logged. */
function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const text = readFileSync(filePath, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key) out[key] = value;
    }
  } catch {
    // best-effort: a missing/unreadable .env is normal in packaged builds
  }
  return out;
}

/**
 * Load `.env` (if present) into process.env WITHOUT overwriting variables already
 * set in the real environment (shell/CI wins over file). Candidate locations cover
 * both `pnpm dev` (cwd = apps/desktop) and the compiled layout (dist/main/config).
 */
function loadDotEnv(): void {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.resolve(__dirname, '../../../.env'), // dist/main/config -> apps/desktop
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const parsed = parseEnvFile(candidate);
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
    break; // first found wins
  }
}

loadDotEnv();

/** Resolve a config value: real env first, then public build-time default. */
function resolve(key: keyof typeof PUBLIC_DEFAULTS): string {
  const fromEnv = process.env[key];
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : PUBLIC_DEFAULTS[key];
}

export const IZZI_API_BASE = resolve('OPENCLAW_API_URL');
export const SUPABASE_URL = resolve('OPENCLAW_SUPABASE_URL');
export const SUPABASE_ANON_KEY = resolve('OPENCLAW_SUPABASE_ANON_KEY');
export const IZZI_WEB_BASE = resolve('OPENCLAW_WEB_URL');
