import { describe, expect, it } from 'vitest';
import {
  agentNeedsApiServer,
  buildDockerRunArgs,
  buildHermesRunArgs,
  dockerContainerName,
  redactSecret,
  resolveHermesProviderSeed,
  summarizeDockerError,
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

describe('resolveHermesProviderSeed', () => {
  it('returns null when no api key is provided', () => {
    expect(resolveHermesProviderSeed('izzi', undefined)).toBeNull();
    expect(resolveHermesProviderSeed('izzi', '   ')).toBeNull();
  });

  it('maps izzi to the izzi base url + trimmed key', () => {
    const seed = resolveHermesProviderSeed('izzi', '  izzi-abc123  ');
    expect(seed).toEqual({
      apiKey: 'izzi-abc123',
      baseUrl: 'https://api.izziapi.com/v1',
      model: 'izzi/auto',
    });
  });

  it('maps openai to the openai base url', () => {
    const seed = resolveHermesProviderSeed('openai', 'sk-xyz');
    expect(seed?.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('falls back to izzi mapping for unknown providers', () => {
    const seed = resolveHermesProviderSeed('totally-unknown', 'k-123');
    expect(seed?.baseUrl).toBe('https://api.izziapi.com/v1');
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

  it('appends provider env vars when a provider seed is supplied', () => {
    const args = buildHermesRunArgs(payload, {
      hostPort: 8642,
      dataDir: '/data/hermes',
      apiServerKey: 'secretkey123456',
      provider: { apiKey: 'izzi-abc', baseUrl: 'https://api.izziapi.com/v1', model: 'izzi/auto' },
    });
    expect(args).toContain('OPENAI_API_KEY=izzi-abc');
    expect(args).toContain('OPENAI_BASE_URL=https://api.izziapi.com/v1');
    expect(args).toContain('LLM_MODEL=izzi/auto');
    // gateway run must still be the trailing command after the image
    expect(args.slice(-3)).toEqual(['nousresearch/hermes-agent:latest', 'gateway', 'run']);
  });

  it('omits provider env vars when no seed is supplied', () => {
    const args = buildHermesRunArgs(payload, {
      hostPort: 8642,
      dataDir: '/data/hermes',
      apiServerKey: 'secretkey123456',
    });
    expect(args.some((a) => a.startsWith('OPENAI_API_KEY='))).toBe(false);
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
