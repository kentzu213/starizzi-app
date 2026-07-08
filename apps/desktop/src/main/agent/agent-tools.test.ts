import { describe, expect, it } from 'vitest';
import path from 'path';
import os from 'os';
import { HOST_TOOLS, HOST_TOOL_NAMES, classifyToolRisk, resolveToolPath, summarizeToolCall } from './agent-tools';

describe('agent-tools', () => {
  it('advertises the four host tools with valid function schemas', () => {
    expect(HOST_TOOLS.map((t) => t.function.name).sort()).toEqual([...HOST_TOOL_NAMES].sort());
    for (const t of HOST_TOOLS) {
      expect(t.type).toBe('function');
      expect(typeof t.function.description).toBe('string');
      expect(t.function.parameters).toHaveProperty('type', 'object');
    }
  });

  it('classifies read-only tools as safe and mutating/exec tools as risky (fail-closed)', () => {
    expect(classifyToolRisk('read_file')).toBe('safe');
    expect(classifyToolRisk('list_dir')).toBe('safe');
    expect(classifyToolRisk('run_command')).toBe('risky');
    expect(classifyToolRisk('write_file')).toBe('risky');
    expect(classifyToolRisk('something_unknown')).toBe('risky');
  });

  it('summarizes tool calls for approval prompts and never throws on bad args', () => {
    expect(summarizeToolCall('run_command', { command: 'ls -la' })).toContain('ls -la');
    expect(summarizeToolCall('run_command', { command: 'x', cwd: '/tmp' })).toContain('/tmp');
    expect(summarizeToolCall('read_file', { path: '/a/b.txt' })).toContain('/a/b.txt');
    expect(summarizeToolCall('write_file', { path: '/a.txt', content: 'abc' })).toContain('3');
    expect(summarizeToolCall('list_dir', { path: '/d' })).toContain('/d');
    expect(summarizeToolCall('unknown_tool', {})).toBe('unknown_tool');
    expect(() => summarizeToolCall('run_command', null)).not.toThrow();
    expect(() => summarizeToolCall('write_file', undefined)).not.toThrow();
  });

  it('resolveToolPath keeps absolute paths and resolves relative against workingDir/home', () => {
    const abs = path.resolve(os.tmpdir(), 'x.txt');
    expect(resolveToolPath(abs, path.resolve('/work'))).toBe(abs);
    const work = path.resolve('/work');
    expect(resolveToolPath('a/b.txt', work)).toBe(path.resolve(work, 'a/b.txt'));
    expect(resolveToolPath('rel.txt', '')).toBe(path.resolve(os.homedir(), 'rel.txt'));
    expect(resolveToolPath('', work)).toBe('');
  });
});
