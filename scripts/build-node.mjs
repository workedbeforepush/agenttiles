// Bundles the plain Node parts: the hook script Claude Code runs, and the `agenttiles --uninstall` CLI.
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', target: 'node20', format: 'cjs', logLevel: 'warning' };

await build({ ...common, entryPoints: ['src/hook/index.ts'], outfile: 'out/hook/agenttiles-hook.js' });
await build({ ...common, entryPoints: ['src/cli/uninstall.ts'], outfile: 'out/cli/uninstall.js' });
