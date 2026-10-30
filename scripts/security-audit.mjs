import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// Explicit public registry avoids presenting an unreachable Artifactory scan as clean.
const child = spawn(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['audit', '--omit=dev', '--registry=https://registry.npmjs.org', '--json'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let output = '';
child.stdout.on('data', (chunk) => {
  if (output.length < 10000000) output += chunk;
});
child.stderr.resume();
const timer = setTimeout(() => child.kill('SIGTERM'), 45000);
const code = await new Promise((resolve) => {
  child.on('error', () => resolve(-1));
  child.on('close', resolve);
});
clearTimeout(timer);
let audit;
try {
  audit = JSON.parse(output);
} catch {
  audit = null;
}
const unavailable = !audit?.metadata || !!audit.error;
const report = {
  checked_at: new Date().toISOString(),
  scope: 'Production dependency advisories; excludes independent penetration testing',
  status: unavailable ? 'unavailable' : code === 0 ? 'passed' : 'findings',
  counts: audit?.metadata?.vulnerabilities || null,
  findings: audit?.vulnerabilities || {},
  ...(unavailable
    ? {
        reason:
          'Advisory service unavailable or returned an invalid audit response; this is not a clean scan.',
      }
    : {}),
};
if (process.env.PIXUP_SECURITY_REPORT)
  await writeFile(resolve(process.env.PIXUP_SECURITY_REPORT), JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
console.log(JSON.stringify(report, null, 2));
process.exitCode = unavailable ? 2 : code === 0 ? 0 : 1;
