import { build } from 'esbuild';

await build({
  entryPoints: ['src/hook/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'out/hook/ccdash-hook.js',
  logLevel: 'warning',
});
