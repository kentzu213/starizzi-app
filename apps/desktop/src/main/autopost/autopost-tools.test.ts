import { describe, expect, it } from 'vitest';
import {
  AUTOPOST_TOOLS,
  AUTOPOST_TOOL_NAMES,
  classifyAutopostRisk,
  executeAutopostTool,
  isAutopostTool,
} from './autopost-tools';
import type { AutopostClient } from './autopost-client';

describe('autopost-tools', () => {
  it('advertises the tools with valid function schemas', () => {
    expect(AUTOPOST_TOOLS.map((t) => t.function.name).sort()).toEqual([...AUTOPOST_TOOL_NAMES].sort());
    for (const t of AUTOPOST_TOOLS) {
      expect(t.type).toBe('function');
      expect(t.function.parameters).toHaveProperty('type', 'object');
    }
  });

  it('classifies scheduling as risky, listing/drafting as safe', () => {
    expect(classifyAutopostRisk('autopost_schedule_post')).toBe('risky');
    expect(classifyAutopostRisk('autopost_create_draft')).toBe('safe');
    expect(classifyAutopostRisk('autopost_list_accounts')).toBe('safe');
    expect(classifyAutopostRisk('autopost_list_posts')).toBe('safe');
  });

  it('isAutopostTool matches only autopost_ tools', () => {
    expect(isAutopostTool('autopost_create_draft')).toBe(true);
    expect(isAutopostTool('run_command')).toBe(false);
  });

  it('executeAutopostTool validates args + routes to the client, never throwing', async () => {
    const fake = {
      listAccounts: async () => ({ ok: true, data: [{ id: 'a1' }] }),
      listPosts: async () => ({ ok: true, data: [] }),
      createDraft: async (i: { content: string }) => ({ ok: true, data: { id: 'p1', status: 'draft', content: i.content } }),
      schedulePost: async () => ({ ok: true, data: { id: 'p1' } }),
    } as unknown as AutopostClient;

    expect(await executeAutopostTool(fake, 'autopost_create_draft', {})).toContain('error'); // missing content
    expect(await executeAutopostTool(fake, 'autopost_create_draft', { content: 'hi' })).toContain('draft');
    expect(await executeAutopostTool(fake, 'autopost_schedule_post', { postId: 'p1' })).toContain('error'); // missing scheduledAt
    expect(await executeAutopostTool(fake, 'autopost_list_accounts', {})).toContain('a1');
    expect(await executeAutopostTool(fake, 'unknown_x', {})).toContain('error');
  });
});
