// Diagnostics: compares the registry, `claude agents --json` and what AgentTiles shows.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DoctorReport, DoctorRow, IntegrationStatus } from '../core/types';
import { isRegistryFileName, parseRegistryEntry } from '../core/registry';
import { sessionsDir } from '../core/paths';
import { claudeProcesses, isAlive } from './platform';
import { runClaude } from './launcher';

interface AgentRow {
  sessionId?: string;
  status?: string;
  state?: string;
  waitingFor?: string;
}

export async function runDoctor(
  shownSessionIds: Set<string>,
  ipc: { listening: boolean; path: string },
  integration: IntegrationStatus,
): Promise<DoctorReport> {
  let agents: AgentRow[] = [];
  let agentsError: string | null = null;
  let claudeVersion: string | null = null;
  try {
    agents = JSON.parse(await runClaude(['agents', '--json'])) as AgentRow[];
  } catch (error) {
    agentsError = (error as Error).message;
  }
  try {
    claudeVersion = (await runClaude(['--version'])).trim();
  } catch {
    claudeVersion = null;
  }
  const bySession = new Map(agents.filter((a) => a.sessionId).map((a) => [a.sessionId as string, a]));

  const rows: DoctorRow[] = [];
  const dir = sessionsDir();
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (!isRegistryFileName(name)) continue;
      const entry = parseRegistryEntry(readFileSync(join(dir, name), 'utf8'));
      if (!entry) continue;
      const agent = bySession.get(entry.sessionId);
      rows.push({
        pid: entry.pid,
        sessionId: entry.sessionId,
        name: entry.name ?? '',
        registryStatus: entry.waitingFor ? `${entry.status} (${entry.waitingFor})` : entry.status,
        alive: isAlive(entry.pid, entry.procStart),
        agentsStatus: agent
          ? `${agent.status ?? agent.state ?? '?'}${agent.waitingFor ? ` (${agent.waitingFor})` : ''}`
          : null,
        shown: shownSessionIds.has(entry.sessionId),
      });
    }
  }
  const registered = new Set(rows.map((r) => r.pid));
  const processes = await claudeProcesses();
  const unregisteredPids = processes === null ? null : processes.filter((pid) => !registered.has(pid));
  return { rows, unregisteredPids, agentsError, ipcListening: ipc.listening, ipcPath: ipc.path, integration, claudeVersion };
}
