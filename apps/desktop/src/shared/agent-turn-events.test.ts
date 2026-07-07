import { describe, it, expect } from 'vitest';
import {
  extractSseEvents,
  parseOpenAiSseEvent,
  createStreamCollector,
  type AgentTurnEvent,
} from './agent-turn-events';

describe('extractSseEvents', () => {
  it('splits complete blocks and keeps the trailing remainder', () => {
    const { events, rest } = extractSseEvents('data: a\n\ndata: b\n\ndata: c');
    expect(events).toEqual(['data: a', 'data: b']);
    expect(rest).toBe('data: c');
  });

  it('returns no events until a blank-line terminator arrives', () => {
    const { events, rest } = extractSseEvents('data: partial');
    expect(events).toEqual([]);
    expect(rest).toBe('data: partial');
  });

  it('drops empty blocks', () => {
    const { events } = extractSseEvents('\n\n\n\ndata: x\n\n');
    expect(events).toEqual(['data: x']);
  });
});

describe('parseOpenAiSseEvent', () => {
  it('parses a content delta', () => {
    expect(parseOpenAiSseEvent('data: {"choices":[{"delta":{"content":"Hi"}}]}')).toEqual({
      content: 'Hi',
      reasoning: undefined,
    });
  });

  it('parses both reasoning field names', () => {
    expect(parseOpenAiSseEvent('data: {"choices":[{"delta":{"reasoning_content":"think"}}]}')).toEqual({
      content: undefined,
      reasoning: 'think',
    });
    expect(parseOpenAiSseEvent('data: {"choices":[{"delta":{"reasoning":"muse"}}]}')).toEqual({
      content: undefined,
      reasoning: 'muse',
    });
  });

  it('flags the [DONE] sentinel', () => {
    expect(parseOpenAiSseEvent('data: [DONE]')).toEqual({ done: true });
  });

  it('returns null for role-only, malformed, or non-data blocks', () => {
    expect(parseOpenAiSseEvent('data: {"choices":[{"delta":{"role":"assistant"}}]}')).toBeNull();
    expect(parseOpenAiSseEvent('data: not json')).toBeNull();
    expect(parseOpenAiSseEvent(': keep-alive comment')).toBeNull();
  });
});

describe('createStreamCollector', () => {
  it('forwards every event and accumulates content/reasoning/steps', () => {
    const forwarded: AgentTurnEvent[] = [];
    const c = createStreamCollector((e) => forwarded.push(e));
    c.onEvent({ turnId: 't', kind: 'delta', text: 'Hel' });
    c.onEvent({ turnId: 't', kind: 'delta', text: 'lo' });
    c.onEvent({ turnId: 't', kind: 'reasoning', text: 'hmm' });
    c.onEvent({ turnId: 't', kind: 'step', step: { id: 's1', kind: 'tool', label: 'x', status: 'running' } });
    c.onEvent({ turnId: 't', kind: 'step', step: { id: 's1', kind: 'tool', label: 'x', status: 'done' } });

    expect(forwarded).toHaveLength(5);
    expect(c.content()).toBe('Hello');
    expect(c.reasoning()).toBe('hmm');
    expect(c.steps()).toHaveLength(1); // same id updated in place, not duplicated
    expect(c.steps()[0].status).toBe('done');
  });
});
