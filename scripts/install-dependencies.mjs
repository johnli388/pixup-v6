import { spawnSync } from 'node:child_process';

// Uses npm itself for probes so proxy, CA and registry-scoped authentication
// settings remain effective. No dependencies are needed to bootstrap installation.
const [command = 'install', ...args] = process.argv.slice(2);
if (!['install', 'ci', 'check'].includes(command)) {
  console.error('Usage: node scripts/install-dependencies.mjs <install|ci|check> [npm options]');
  process.exit(1);
}
const npmCli = process.env.npm_execpath;
function npm(parameters, options = {}) {
  return spawnSync(
    npmCli ? process.execPath : 'npm',
    npmCli ? [npmCli, ...parameters] : parameters,
    {
      encoding: 'utf8',
      ...options,
    },
  );
}
const config = npm(['config', 'get', 'registry'], { timeout: 8000 });
if (config.error || config.status !== 0) {
  console.error('Unable to read npm registry configuration. Check that npm is installed.');
  process.exit(1);
}
const primary = config.stdout.trim();
const fallback = 'https://registry.npmjs.org/';
function reachable(registry) {
  const probe = npm(
    [
      'ping',
      `--registry=${registry}`,
      '--fetch-retries=0',
      '--fetch-timeout=5000',
      '--loglevel=error',
    ],
    { timeout: 8000, stdio: 'ignore' },
  );
  return !probe.error && probe.status === 0;
}
let registry = primary;
if (!reachable(primary)) {
  console.warn('Configured npm registry is unavailable. Checking the public npm registry…');
  if (primary.replace(/\/$/, '') === fallback.replace(/\/$/, '') || !reachable(fallback)) {
    console.error(
      'No reachable npm registry. Check network/VPN/proxy settings; installation was not started.',
    );
    process.exit(1);
  }
  registry = fallback;
  console.log('Using https://registry.npmjs.org/ for this command.');
} else {
  console.log('Configured npm registry is available.');
}
if (command !== 'check') {
  // Choose the registry before running ci (which removes node_modules). Do not
  // retry arbitrary install/build failures against another registry.
  const result = npm([command, ...args, `--registry=${registry}`], { stdio: 'inherit' });
  if (result.error) console.error('Could not start npm installation.');
  process.exitCode = result.status ?? 1;
}
