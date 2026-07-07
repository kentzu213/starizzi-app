import { describe, it, expect, vi, afterEach } from 'vitest';
import { IzziAgent } from './izzi-agent';
import type { ExtensionToolHost } from './extension-tools';

const auth = { getApiKey: () => 'izzi_key' } as any;

const toolHost: ExtensionToolHost = {
  getAllExtensions: () => [
    {
      id: 'ext-social-auto-poster',
      state: 'running',
      manifest: {
        displayName: 'Social Auto Poster',
        contributes: { commands: [{ id: 'social-auto-poster.postNow', title: 'Đăng ngay' }] },
      },
    },
  ],
  executeCommand: vi.fn(async () => ({ ok: true, result: { id: 'task_1' } })),
};

function mockFetchSequence(responses: any[]) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return { ok: true, json: async () => r } as any;
  });
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('IzziAgent tool-calling', () => {
  it('single-turn (tools disabled): no tools in request, returns content', async () => {
    const fetchMock = mockFetchSequence([{ choices: [{ message: { content: 'xin chào' } }] }]);
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent(auth, toolHost);
    const res = await agent.chat({ systemPrompt: 's', message: 'hi' });
    expect(res.reply).toBe('xin chào');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
  });

  it('enableTools: executes the tool_call, loops, returns final answer', async () => {
    const fetchMock = mockFetchSequence([
      // 1st turn: model asks to call the tool
      { choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'social-auto-poster__postNow', arguments: '{"content":"Bài mới"}' } }] } }] },
      // 2nd turn: model gives the final answer after seeing the tool result
      { choices: [{ message: { content: 'Đã đăng bài lên Facebook Page ✅' } }] },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent(auth, toolHost);
    const res = await agent.chat({ systemPrompt: 's', message: 'đăng giúp tôi', enableTools: true });

    expect(res.reply).toBe('Đã đăng bài lên Facebook Page ✅');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Tools were offered on the first turn
    const body0 = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Array.isArray(body0.tools)).toBe(true);
    expect(body0.tool_choice).toBe('auto');
    // The extension command was actually invoked with parsed args
    expect(toolHost.executeCommand).toHaveBeenCalledWith('ext-social-auto-poster', 'social-auto-poster.postNow', { content: 'Bài mới' });
    // The 2nd turn included the tool result message
    const body1 = JSON.parse(fetchMock.mock.calls[1][1].body);
    const toolMsg = body1.messages.find((m: any) => m.role === 'tool');
    expect(toolMsg).toBeTruthy();
    expect(toolMsg.content).toContain('task_1');
  });

  it('no-key → error, no fetch', async () => {
    vi.stubEnv('OPENAI_API_KEY', ''); // ensure the env key doesn't satisfy resolveKey
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent({ getApiKey: () => null } as any, toolHost);
    const res = await agent.chat({ systemPrompt: 's', message: 'hi', enableTools: true });
    expect(res.error).toBe('no-key');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
