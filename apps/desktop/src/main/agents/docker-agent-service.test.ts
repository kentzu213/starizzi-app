import { describe, expect, it } from 'vitest';
import {
  agentNeedsApiServer,
  buildDockerRunArgs,
  buildHermesConfigYaml,
  buildHermesRunArgs,
  dockerContainerName,
  redactSecret,
  summarizeDockerError,
  upsertReasoningEffort,
  type DockerAgentPayload,
} from './docker-agent-service';

describe('dockerContainerName', () => {
  it('prefixes the agent id with izzi-agent-', () => {
    expect(dockerContainerName('n8n')).toBe('izzi-agent-n8n');
  });

  it('sanitizes characters Docker does not allow in names', () => {
    expect(dockerContainerName('my agent/v2')).toBe('izzi-agent-my-agent-v2');
  });

  it('falls back to a safe name for empty ids', () => {
    expect(dockerContainerName('')).toBe('izzi-agent-unknown');
  });
});

describe('buildDockerRunArgs', () => {
  it('builds a detached run with name + port mapping for the image', () => {
    const payload: DockerAgentPayload = {
      id: 'n8n',
      dockerImage: 'n8nio/n8n:2.21',
      defaultPort: 5678,
    };
    expect(buildDockerRunArgs(payload)).toEqual([
      'run', '-d', '--name', 'izzi-agent-n8n', '-p', '5678:5678', 'n8nio/n8n:2.21',
    ]);
  });
});

describe('summarizeDockerError', () => {
  it('prefers the "Error response from daemon" line', () => {
    const stderr = [
      'Pulling from library/foo',
      'Error response from daemon: manifest for foo:latest not found',
      'extra noise',
    ].join('\n');
    expect(summarizeDockerError(stderr)).toContain('manifest for foo:latest not found');
  });

  it('returns a friendly message when stderr is empty', () => {
    expect(summarizeDockerError('')).toMatch(/thất bại/);
  });

  it('truncates very long messages', () => {
    const long = 'Error ' + 'x'.repeat(500);
    const result = summarizeDockerError(long);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith('...')).toBe(true);
  });
});

describe('agentNeedsApiServer', () => {
  it('is true for hermes', () => {
    expect(agentNeedsApiServer('hermes')).toBe(true);
  });

  it('is false for simple docker agents', () => {
    expect(agentNeedsApiServer('n8n')).toBe(false);
    expect(agentNeedsApiServer('')).toBe(false);
  });
});

describe('buildHermesConfigYaml', () => {
  it('emits a model section pointing at the proxy with provider=custom', () => {
    const yaml = buildHermesConfigYaml({
      baseUrl: 'http://host.docker.internal:8765/v1',
      apiKey: 'proxy-token-abc',
      model: 'izzi-smart',
    });
    expect(yaml).toContain('provider: custom');
    expect(yaml).toContain('base_url: "http://host.docker.internal:8765/v1"');
    expect(yaml).toContain('default: "izzi-smart"');
    expect(yaml).toContain('api_key: "proxy-token-abc"');
  });

  it('quotes values as JSON scalars so URLs/tokens cannot break the YAML', () => {
    const yaml = buildHermesConfigYaml({
      baseUrl: 'http://host.docker.internal:8765/v1',
      apiKey: 'weird"token\nwith:chars',
      model: 'izzi-smart',
    });
    // The api_key line must remain a single valid double-quoted scalar.
    expect(yaml).toContain(`api_key: ${JSON.stringify('weird"token\nwith:chars')}`);
  });
});

describe('buildHermesRunArgs', () => {
  const payload: DockerAgentPayload = {
    id: 'hermes',
    dockerImage: 'nousresearch/hermes-agent:latest',
    defaultPort: 8642,
  };

  it('enables the API server, mounts data dir, maps to container port 8642, runs gateway', () => {
    const args = buildHermesRunArgs(payload, {
      hostPort: 8642,
      dataDir: '/data/hermes',
      apiServerKey: 'secretkey123456',
    });
    expect(args).toEqual([
      'run', '-d', '--name', 'izzi-agent-hermes',
      '-v', '/data/hermes:/opt/data',
      '-p', '8642:8642',
      '-e', 'API_SERVER_ENABLED=true',
      '-e', 'API_SERVER_HOST=0.0.0.0',
      '-e', 'API_SERVER_KEY=secretkey123456',
      'nousresearch/hermes-agent:latest', 'gateway', 'run',
    ]);
  });

  it('never seeds a legacy provider env var (routing is via config.yaml)', () => {
    const args = buildHermesRunArgs(payload, {
      hostPort: 8642,
      dataDir: '/data/hermes',
      apiServerKey: 'secretkey123456',
    });
    expect(args.some((a) => a.startsWith('OPENAI_API_KEY='))).toBe(false);
    expect(args.some((a) => a.startsWith('OPENAI_BASE_URL='))).toBe(false);
    expect(args.some((a) => a.startsWith('LLM_MODEL='))).toBe(false);
    // gateway run must still be the trailing command after the image
    expect(args.slice(-3)).toEqual(['nousresearch/hermes-agent:latest', 'gateway', 'run']);
  });
});

describe('redactSecret', () => {
  it('replaces the secret with a mask', () => {
    expect(redactSecret('key=supersecretvalue failed', 'supersecretvalue')).toBe('key=*** failed');
  });

  it('returns the text unchanged when secret is too short or missing', () => {
    expect(redactSecret('hello world', undefined)).toBe('hello world');
    expect(redactSecret('hello world', 'ab')).toBe('hello world');
  });
});

describe('upsertReasoningEffort', () => {
  it('replaces an existing reasoning_effort value, preserving indent and the rest', () => {
    const yaml = [
      'model:',
      '  provider: custom',
      '  default: gpt-5.5',
      'agent:',
      '  verify_on_stop: false',
      '  reasoning_effort: medium',
      'plugins:',
      '  enabled: []',
      '',
    ].join('\n');
    const out = upsertReasoningEffort(yaml, 'xhigh');
    expect(out).toContain('  reasoning_effort: xhigh');
    expect(out).not.toContain('reasoning_effort: medium');
    // Untouched lines survive.
    expect(out).toContain('  default: gpt-5.5');
    expect(out).toContain('  verify_on_stop: false');
    expect(out).toContain('  enabled: []');
  });

  it('inserts under an existing agent block when no reasoning_effort is present', () => {
    const yaml = ['model:', '  default: gpt-5.5', 'agent:', '  verify_on_stop: false', ''].join('\n');
    const out = upsertReasoningEffort(yaml, 'high');
    expect(out).toMatch(/agent:\r?\n {2}reasoning_effort: high\r?\n {2}verify_on_stop: false/);
  });

  it('appends a new agent block when the config has none (proxy/model-only config)', () => {
    const yaml = ['model:', '  provider: custom', '  default: gpt-5.5', ''].join('\n');
    const out = upsertReasoningEffort(yaml, 'low');
    expect(out).toContain('  default: gpt-5.5');
    expect(out).toMatch(/agent:\n {2}reasoning_effort: low\n$/);
  });

  it('does not add a blank line before the appended block when input lacks a trailing newline', () => {
    const out = upsertReasoningEffort('model:\n  default: gpt-5.5', 'medium');
    expect(out).toBe('model:\n  default: gpt-5.5\nagent:\n  reasoning_effort: medium\n');
  });
});
