import { describe, it, expect, vi } from 'vitest';
import {
  toToolName,
  buildExtensionTools,
  executeExtensionTool,
  type ExtensionToolHost,
} from './extension-tools';

function host(exts: any[], exec?: any): ExtensionToolHost {
  return {
    getAllExtensions: () => exts,
    executeCommand: exec ?? vi.fn(async () => ({ ok: true })),
  };
}

const runningExt = {
  id: 'ext-social-auto-poster',
  state: 'running',
  manifest: {
    displayName: 'Social Auto Poster',
    contributes: {
      commands: [
        { id: 'social-auto-poster.postNow', title: 'Đăng ngay' },
        { id: 'social-auto-poster.schedule', title: 'Lên lịch' },
      ],
    },
  },
};

describe('toToolName', () => {
  it('encodes dots (and other invalid chars) so it matches OpenAI tool-name rules', () => {
    expect(toToolName('social-auto-poster.postNow')).toBe('social-auto-poster__postNow');
    expect(/^[a-zA-Z0-9_-]+$/.test(toToolName('a.b.c'))).toBe(true);
  });
  it('truncates to 64 chars', () => {
    expect(toToolName('x'.repeat(100)).length).toBe(64);
  });
});

describe('buildExtensionTools', () => {
  it('builds tool defs only for RUNNING extensions and maps names back to commands', () => {
    const { tools, map } = buildExtensionTools(host([runningExt]));
    expect(tools).toHaveLength(2);
    expect(tools[0].type).toBe('function');
    expect(tools[0].function.name).toBe('social-auto-poster__postNow');
    expect(tools[0].function.parameters).toEqual({ type: 'object', properties: {}, additionalProperties: true });
    expect(map.get('social-auto-poster__postNow')).toEqual({
      extensionId: 'ext-social-auto-poster',
      commandId: 'social-auto-poster.postNow',
    });
  });

  it('skips non-running extensions', () => {
    const stopped = { ...runningExt, state: 'installed' };
    const { tools } = buildExtensionTools(host([stopped]));
    expect(tools).toHaveLength(0);
  });

  it('tolerates extensions without commands', () => {
    const bare = { id: 'ext-x', state: 'running', manifest: {} };
    const { tools } = buildExtensionTools(host([bare]));
    expect(tools).toHaveLength(0);
  });
});

describe('executeExtensionTool', () => {
  it('routes a tool call to the right extension command with params', async () => {
    const exec = vi.fn(async () => ({ ok: true, id: 'task_1' }));
    const h = host([runningExt], exec);
    const index = buildExtensionTools(h);
    const res = await executeExtensionTool(h, index, 'social-auto-poster__postNow', { content: 'hi' });
    expect(exec).toHaveBeenCalledWith('ext-social-auto-poster', 'social-auto-poster.postNow', { content: 'hi' });
    expect(res).toEqual({ ok: true, id: 'task_1' });
  });

  it('throws (fail-closed) on unknown tool name', async () => {
    const h = host([runningExt]);
    const index = buildExtensionTools(h);
    await expect(executeExtensionTool(h, index, 'nope__x', {})).rejects.toThrow(/Unknown extension tool/);
  });

  it('coerces non-object args to an empty params object', async () => {
    const exec = vi.fn(async () => 'ok');
    const h = host([runningExt], exec);
    const index = buildExtensionTools(h);
    await executeExtensionTool(h, index, 'social-auto-poster__schedule', null);
    expect(exec).toHaveBeenCalledWith('ext-social-auto-poster', 'social-auto-poster.schedule', {});
  });
});
