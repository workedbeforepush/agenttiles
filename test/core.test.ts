import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { firstJsonObject, isRegistryFileName, parseRegistryEntry } from '../src/core/registry';
import { applyTranscriptLine, emptyTranscriptInfo } from '../src/core/transcript';
import { LineSplitter, permissionOutput } from '../src/core/protocol';
import { projectName, projectSlug } from '../src/core/paths';
import { attachCommand, launchCommand } from '../src/main/launcher';
import { toolSummary } from '../src/core/tools';

const fixtures = join(__dirname, 'fixtures', '2.1.306');

describe('registry', () => {
  const text = readFileSync(join(fixtures, 'registry-busy.json'), 'utf8');

  it('parses a registry entry', () => {
    const entry = parseRegistryEntry(text);
    expect(entry).toMatchObject({
      pid: 4242,
      sessionId: '11111111-2222-3333-4444-555555555555',
      cwd: 'C:\\work\\demo-project',
      status: 'busy',
      waitingFor: null,
      procStart: '134370000000000000',
      kind: 'interactive',
      nameSource: 'derived',
      statusUpdatedAt: 1792560100000,
    });
  });

  it('tolerates a stray trailing brace', () => {
    expect(parseRegistryEntry(`${text}}`)?.pid).toBe(4242);
  });

  it('keeps braces inside strings intact', () => {
    expect(firstJsonObject('{"a":"x}y","b":{"c":1}}}')).toBe('{"a":"x}y","b":{"c":1}}');
  });

  it('reads waitingFor when present', () => {
    const waiting = text.replace('"status":"busy"', '"status":"waiting","waitingFor":"permission prompt"');
    expect(parseRegistryEntry(waiting)).toMatchObject({ status: 'waiting', waitingFor: 'permission prompt' });
  });

  it('reads the job id of a background session', () => {
    const bg = text.replace('"kind":"interactive"', '"kind":"bg","jobId":"4490bb57"');
    expect(parseRegistryEntry(bg)).toMatchObject({ kind: 'bg', jobId: '4490bb57' });
    expect(parseRegistryEntry(text)?.jobId).toBeNull();
  });

  it('rejects entries without pid, sessionId or cwd', () => {
    expect(parseRegistryEntry('{"pid":1,"cwd":"x"}')).toBeNull();
    expect(parseRegistryEntry('not json')).toBeNull();
  });

  it('only accepts <pid>.json file names, never key files', () => {
    expect(isRegistryFileName('4242.json')).toBe(true);
    expect(isRegistryFileName('4242.abc123.key')).toBe(false);
    expect(isRegistryFileName('daemon.json')).toBe(false);
  });
});

describe('transcript', () => {
  it('extracts title, model, prompt, reply and the active tool from the main chain', () => {
    const info = emptyTranscriptInfo();
    for (const line of readFileSync(join(fixtures, 'transcript.jsonl'), 'utf8').split('\n')) {
      if (line.trim()) applyTranscriptLine(info, line);
    }
    expect(info.aiTitle).toBe('Demo Feature Build');
    expect(info.model).toBe('Opus 5.5');
    expect(info.lastPrompt).toBe('Build the demo feature');
    expect(info.lastAssistant).toBe('I will look at the project first.');
    expect(info.activeTool).toBe('Bash: npm test');
    expect(info.lastAssistantAt).toBeGreaterThan(info.lastPromptAt);
  });

  it('sees from a stop hook summary that the session runs our hooks', () => {
    const info = emptyTranscriptInfo();
    const summary = (command: string): string =>
      JSON.stringify({ type: 'system', subtype: 'stop_hook_summary', hookCount: 1, hookInfos: [{ command }] });
    applyTranscriptLine(info, summary('node C:\\tools\\other-hook.js'));
    expect(info.ourHooks).toBe(false);
    applyTranscriptLine(info, summary('C:\\nodejs\\node.exe C:\\Users\\me\\AppData\\Roaming\\agenttiles\\agenttiles-hook.js hook'));
    expect(info.ourHooks).toBe(true);
  });

  it('clears the active tool on a tool result', () => {
    const info = emptyTranscriptInfo();
    info.activeTool = 'Bash: npm test';
    applyTranscriptLine(
      info,
      JSON.stringify({
        type: 'user',
        isSidechain: false,
        timestamp: '2026-10-21T08:00:04.000Z',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      }),
    );
    expect(info.activeTool).toBeNull();
  });

  it('ignores meta prompts and malformed lines', () => {
    const info = emptyTranscriptInfo();
    applyTranscriptLine(info, '{broken');
    applyTranscriptLine(info, JSON.stringify({ type: 'user', isMeta: true, message: { content: 'meta' } }));
    expect(info.lastPrompt).toBeNull();
  });
});

describe('protocol', () => {
  it('splits chunks into complete lines', () => {
    const splitter = new LineSplitter();
    expect(splitter.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(splitter.push(':2}\n')).toEqual(['{"b":2}']);
  });

  it('renders permission decisions as hook output', () => {
    expect(JSON.parse(permissionOutput('allow'))).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
    expect(JSON.parse(permissionOutput('deny')).hookSpecificOutput.decision.behavior).toBe('deny');
    expect(permissionOutput('pass')).toBe('{}');
  });
});

describe('paths and tools', () => {
  it('builds the project slug Claude Code uses', () => {
    expect(projectSlug('C:\\_Git\\Personal\\agenttiles')).toBe('C---Git-Personal-agenttiles');
    expect(projectSlug('C:\\src\\acme\\Acme.Web.Api')).toBe('C--src-acme-Acme-Web-Api');
  });

  it('takes the last path segment as project name', () => {
    expect(projectName('C:\\work\\demo-project')).toBe('demo-project');
    expect(projectName('/home/me/app/')).toBe('app');
  });

  it('summarises tool calls', () => {
    expect(toolSummary('Edit', { file_path: 'C:\\src\\main.rs' })).toBe('Edit: main.rs');
    expect(toolSummary('Bash', { command: 'cargo   build\n--release' })).toBe('Bash: cargo build --release');
    expect(toolSummary('Unknown', {})).toBe('Unknown');
  });
});

describe('background sessions', () => {
  it('attaches by job id', () => {
    expect(attachCommand('4490bb57')).toEqual(['claude', 'attach', '4490bb57']);
  });

  it('rejects anything that is not a job id', () => {
    expect(() => attachCommand('4490bb57 & calc')).toThrow('Invalid background session id.');
  });
});

describe('launch command', () => {
  const id = '11111111-2222-3333-4444-555555555555';

  it('starts, resumes or starts in a new worktree', () => {
    expect(launchCommand(null, null, false)).toEqual(['claude']);
    expect(launchCommand(id, null, false)).toEqual(['claude', '--resume', id]);
    expect(launchCommand(null, '', false)).toEqual(['claude', '--worktree']);
    expect(launchCommand(null, 'fix/login-42', false)).toEqual(['claude', '--worktree', 'fix/login-42']);
  });

  it('resumes in place, never in a worktree', () => {
    expect(launchCommand(id, 'other', false)).toEqual(['claude', '--resume', id]);
  });

  it('forks a resumed session into a new session id', () => {
    expect(launchCommand(id, null, true)).toEqual(['claude', '--resume', id, '--fork-session']);
    expect(launchCommand(id, 'other', true)).toEqual(['claude', '--resume', id, '--fork-session']);
  });

  it('forks only a session it resumes, and only valid session ids', () => {
    expect(() => launchCommand(null, null, true)).toThrow('Invalid request');
    expect(() => launchCommand('--dangerously-skip-permissions', null, true)).toThrow('Invalid session id');
    expect(() => launchCommand(`${id} --print`, null, true)).toThrow('Invalid session id');
  });

  it('rejects worktree names that are not a plain name', () => {
    expect(() => launchCommand(null, '--dangerously-skip-permissions', false)).toThrow('Not a valid worktree name');
    expect(() => launchCommand(null, 'a b', false)).toThrow('Not a valid worktree name');
    expect(() => launchCommand(null, 'x;calc', false)).toThrow('Not a valid worktree name');
  });
});
