import { spawn } from 'node:child_process';
const production = process.argv.includes('--production');
const children = [
  spawn(
    process.execPath,
    ['--import', 'tsx', ...(production ? [] : ['--watch']), 'apps/api/src/main.ts'],
    { stdio: 'inherit' },
  ),
  spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      production ? 'start' : 'dev',
      'apps/web',
      '--hostname',
      '127.0.0.1',
    ],
    { stdio: 'inherit' },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1500).unref();
}
for (const child of children) {
  child.on('exit', (code) => stop(code || 0));
  child.on('error', (e) => {
    console.error(e);
    stop(1);
  });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
