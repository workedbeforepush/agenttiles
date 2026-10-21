// Bundles the screenshot script (TypeScript, imports from src/) for Electron.
import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/screenshots/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  outfile: 'out/screenshots/main.cjs',
  logLevel: 'warning',
});
