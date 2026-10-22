// Settings, stats and launch data for the README screenshots; the sessions come from src/core/demo.ts.
import type { DaySummary, LaunchView, ModelUsage, SettingsView, StatsView } from '../../src/core/types';
import { DEFAULT_SETTINGS } from '../../src/main/config';
import { MIN } from '../../src/core/demo';

export { snapshot, type DemoProgress } from '../../src/core/demo';

export function settingsView(): SettingsView {
  return {
    version: '0.1.0',
    settings: { ...DEFAULT_SETTINGS, theme: 'dark' },
    hiddenProjects: [],
    hiddenSessions: [],
    integration: { hooksInstalled: true, statuslineInstalled: true, nodePath: 'C:\\Program Files\\nodejs\\node.exe', error: null },
    askHooks: false,
    showTour: false,
    locale: 'en',
    platform: 'win32',
  };
}

/** 30 days of activity with a weekly rhythm; deterministic so screenshots do not change between runs. */
export function stats(now: number, days: number): StatsView {
  const projects = ['api-gateway', 'web-shop', 'design-system', 'data-pipeline', 'mobile-app', 'infra'];
  let seed = 7;
  const random = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const result: DaySummary[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now - i * 24 * 60 * MIN);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const day: DaySummary = {
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      projects: {},
    };
    for (const [index, name] of projects.entries()) {
      if (random() < (weekend ? 0.75 : 0.25)) continue;
      const weight = 1 / (index + 1);
      const working = Math.round((40 + random() * 120) * weight * MIN);
      day.projects[name] = {
        costUsd: Math.round(working / MIN * (0.04 + random() * 0.05) * 100) / 100,
        turns: Math.round(working / MIN / 6) + 1,
        workingMs: working,
        waitingMs: Math.round(working * (0.05 + random() * 0.1)),
      };
    }
    result.push(day);
  }
  const total = result.reduce((sum, d) => sum + Object.values(d.projects).reduce((s, p) => s + p.costUsd, 0), 0);
  // Split like a typical mix: mostly Opus, some Sonnet subagents, a little Haiku. Tokens follow the list prices.
  const model = (share: number, input: number, output: number, read: number): ModelUsage => {
    const cost = total * share;
    return {
      inputTokens: Math.round((cost * 0.05) / input * 1e6),
      outputTokens: Math.round((cost * 0.45) / output * 1e6),
      cacheWriteTokens: Math.round((cost * 0.2) / (input * 1.25) * 1e6),
      cacheReadTokens: Math.round((cost * 0.3) / (input * read) * 1e6),
      costUsd: cost,
    };
  };
  return {
    days: result,
    models: {
      'claude-opus-5-5': model(0.78, 4, 20, 0.05),
      'claude-sonnet-5-5': model(0.19, 2, 10, 0.05),
      'claude-haiku-5-5': model(0.03, 0.1, 0.5, 0.1),
    },
    recordedSince: result[0]!.date,
  };
}

export function launchView(now: number): LaunchView {
  const projects = ['api-gateway', 'web-shop', 'design-system', 'data-pipeline', 'mobile-app', 'infra', 'docs', 'platform'];
  const sessions = [
    ['Add rate limiting to public endpoints', 'api-gateway', 35],
    ['Product page performance', 'web-shop', 180],
    ['Storybook for the new tokens', 'design-system', 420],
    ['Retry failed webhook deliveries', 'api-gateway', 1500],
    ['Push notification opt-in', 'mobile-app', 2900],
    ['Terraform module for queues', 'infra', 4300],
  ] as const;
  return {
    projects: projects.map((p, i) => ({ cwd: `C:\\dev\\${p}`, project: p, lastAt: now - i * 40 * MIN })),
    sessions: sessions.map(([title, project, ago], i) => ({
      sessionId: `00000000-0000-4000-8000-00000000000${i}`,
      cwd: `C:\\dev\\${project}`,
      project,
      title,
      lastAt: now - ago * MIN,
    })),
  };
}
