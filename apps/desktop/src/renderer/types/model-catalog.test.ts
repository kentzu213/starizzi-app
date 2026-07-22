import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  buildLocalModelGroup,
  connectionActionForProvider,
  deriveEndpointLabel,
  prettyModelName,
} from './model-catalog';
import type { AIProvider } from './agent-registry';

const KNOWN = ['izzi-smart', 'grok-4.5-high', 'gcli/grok-4.5-high', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'claude-opus-4.7', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'];

describe('model-catalog', () => {
  // Feature: model-selection-standard, Property 1: local group de-dupes, drops
  // blanks, preserves first-seen order, and tags every model provider 'custom'.
  it('buildLocalModelGroup de-dupes + drops blanks + preserves first-seen order', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (models) => {
        const group = buildLocalModelGroup(models);
        const cleaned = models.map((m) => m.trim()).filter((m) => m.length > 0);

        if (cleaned.length === 0) {
          expect(group).toBeNull();
          return;
        }

        const ids = group!.models.map((m) => m.id);
        // unique
        expect(new Set(ids).size).toBe(ids.length);
        // first-seen order preserved
        const expected: string[] = [];
        const seen = new Set<string>();
        for (const m of cleaned) if (!seen.has(m)) { seen.add(m); expected.push(m); }
        expect(ids).toEqual(expected);
        // every model tagged as the custom (local) connection
        for (const m of group!.models) expect(m.provider).toBe('custom');
        // group is addressable as the custom connection
        expect(group!.id).toBe('custom');
      }),
      { numRuns: 100 },
    );
  });

  // Feature: model-selection-standard, Property 2: connection action mapping is
  // total — custom enables, izzi disables, every other provider is a no-op.
  it('connectionActionForProvider maps custom->enable, izzi->disable, else none', () => {
    expect(connectionActionForProvider('custom')).toBe('enable-custom');
    expect(connectionActionForProvider('izzi')).toBe('disable-custom');
    fc.assert(
      fc.property(
        fc.constantFrom<AIProvider>('openai', 'anthropic', 'gemini', 'openrouter', 'ollama'),
        (p) => {
          expect(connectionActionForProvider(p)).toBe('none');
        },
      ),
      { numRuns: 20 },
    );
  });

  // Feature: model-selection-standard, Property 3: prettyModelName maps known ids
  // and is the identity for anything else (so unknown/new models still display).
  it('prettyModelName maps known ids and is identity for unknown ids', () => {
    expect(prettyModelName('izzi-smart')).toBe('Izzi Smart Router');
    expect(prettyModelName('grok-4.5-high')).toBe('Grok 4.5 High');
    expect(prettyModelName('gcli/grok-4.5-high')).toBe('Grok 4.5 High (9Router upstream)');
    expect(prettyModelName('gpt-5.6-sol')).toBe('GPT-5.6 Sol');
    expect(prettyModelName('claude-opus-4.7')).toBe('Claude Opus 4.7');
    fc.assert(
      fc.property(fc.string(), (s) => {
        if (!KNOWN.includes(s)) expect(prettyModelName(s)).toBe(s);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: model-selection-standard, Property 4: endpoint label reflects the
  // port (codex-lb :2455 / 9router :4000) and always returns a non-empty label.
  it('deriveEndpointLabel maps local ports, hosted Izzi endpoints, and always returns a label', () => {
    expect(deriveEndpointLabel('http://127.0.0.1:2455/v1')).toBe('codex-lb (local)');
    expect(deriveEndpointLabel('http://127.0.0.1:4000/v1')).toContain('9router');
    expect(deriveEndpointLabel('https://api.izziapi.com/v1')).toBe('Izzi API (direct)');
    expect(deriveEndpointLabel('https://codex.izziapi.com/v1')).toBe('codex-lb (hosted)');
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: undefined }), (url) => {
        const label = deriveEndpointLabel(url);
        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});
