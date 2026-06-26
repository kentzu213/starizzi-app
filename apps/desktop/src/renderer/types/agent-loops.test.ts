import { describe, expect, it } from 'vitest';
import {
  AGENT_LOOPS,
  CATEGORY_ORDER,
  groupAgentsByCategory,
  loopStarterDraft,
  planLoopApplication,
  type AgentLoop,
} from './agent-loops';
import { TOP_AGENTS, type AgentChatSession } from './agent-registry';

/**
 * Feature: agent-workspace-redesign
 * Validates: Requirements 8.1 (agent grouping coverage) and 8.2 (loop apply plan).
 */

describe('groupAgentsByCategory (Req 8.1)', () => {
  it('covers every agent exactly once across groups', () => {
    const groups = groupAgentsByCategory(TOP_AGENTS);
    const total = groups.reduce((n, g) => n + g.agents.length, 0);
    expect(total).toBe(TOP_AGENTS.length);
  });

  it('places each agent in the group matching its category', () => {
    for (const group of groupAgentsByCategory(TOP_AGENTS)) {
      for (const agent of group.agents) {
        expect(agent.category).toBe(group.category);
      }
    }
  });

  it('returns groups in the stable CATEGORY_ORDER and omits empty categories', () => {
    const groups = groupAgentsByCategory(TOP_AGENTS);
    const order = groups.map((g) => g.category);
    // Each returned category is known and appears in CATEGORY_ORDER sequence.
    const expected = CATEGORY_ORDER.filter((c) => TOP_AGENTS.some((a) => a.category === c));
    expect(order).toEqual(expected);
    expect(groups.every((g) => g.agents.length > 0)).toBe(true);
  });
});

describe('planLoopApplication (Req 3.3, 3.4, 3.6, 8.2)', () => {
  const researchLoop = AGENT_LOOPS.find((l) => l.id === 'loop-research') as AgentLoop;

  function fakeSession(agentId: string): AgentChatSession {
    return {
      id: 'sess-1',
      agentId,
      agentName: agentId,
      agentIcon: '🤖',
      messages: [],
      model: 'izzi/auto',
      provider: 'izzi',
      createdAt: new Date().toISOString(),
      isActive: true,
    };
  }

  it('configures the existing session and keeps its agent when a session is active', () => {
    const plan = planLoopApplication(researchLoop, fakeSession('openclaw'), TOP_AGENTS);
    expect(plan.action).toBe('configure-existing');
    expect(plan.agentId).toBe('openclaw'); // keeps the active agent, only sets model
    expect(plan.model).toBe(researchLoop.suggestedModel);
    expect(plan.provider).toBe(researchLoop.suggestedProvider);
  });

  it('opens a new session with the suggested agent when none is active and the agent is known', () => {
    const plan = planLoopApplication(researchLoop, null, TOP_AGENTS);
    expect(plan.action).toBe('open-new');
    expect(plan.agentId).toBe(researchLoop.suggestedAgentId);
    expect(TOP_AGENTS.some((a) => a.id === plan.agentId)).toBe(true);
  });

  it('yields a null agentId (safe skip) when no session and the suggested agent is unknown', () => {
    const unknownLoop: AgentLoop = { ...researchLoop, suggestedAgentId: 'no-such-agent' };
    const plan = planLoopApplication(unknownLoop, null, TOP_AGENTS);
    expect(plan.action).toBe('open-new');
    expect(plan.agentId).toBeNull();
    expect(plan.model).toBe(unknownLoop.suggestedModel);
  });

  it('keeps every preset loop pointing at a real agent in TOP_AGENTS', () => {
    for (const loop of AGENT_LOOPS) {
      expect(TOP_AGENTS.some((a) => a.id === loop.suggestedAgentId)).toBe(true);
    }
  });
});


/**
 * Feature: agent-workspace-redesign (Phase 2)
 * Validates: Requirements 9.1, 9.4 (loopStarterDraft is pure, returns starterPrompt).
 */
describe('loopStarterDraft (Req 9.1, 9.4)', () => {
  it('returns the starterPrompt of the given loop', () => {
    for (const loop of AGENT_LOOPS) {
      expect(loopStarterDraft(loop)).toBe(loop.starterPrompt);
    }
  });

  it('every preset loop has a non-empty starterPrompt', () => {
    for (const loop of AGENT_LOOPS) {
      expect(loop.starterPrompt).toBeTruthy();
      expect(loop.starterPrompt.length).toBeGreaterThan(0);
    }
  });

  it('is pure — calling multiple times with the same input yields the same output', () => {
    for (const loop of AGENT_LOOPS) {
      const first = loopStarterDraft(loop);
      const second = loopStarterDraft(loop);
      const third = loopStarterDraft(loop);
      expect(first).toBe(second);
      expect(second).toBe(third);
    }
  });

  it('does not mutate the input loop object', () => {
    const loop: AgentLoop = { ...AGENT_LOOPS[0] };
    const before = JSON.stringify(loop);
    loopStarterDraft(loop);
    expect(JSON.stringify(loop)).toBe(before);
  });
});
