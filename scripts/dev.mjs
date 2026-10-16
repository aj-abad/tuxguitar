import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('..', import.meta.url));
// Check the port without terminating another development session.
const probe = createServer();
try {
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(4399, '127.0.0.1', resolve);
  });
  await new Promise(resolve => probe.close(resolve));
} catch {
  console.error('Port 4399 is already in use. Stop the existing dev session first.');
  process.exit(1);
}
for (const script of ['sidecar-guard.mjs', 'gen-icons.mjs']) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', script)], {
    cwd: root, stdio: 'inherit', windowsHide: true,
  });
  if (result.error || result.status !== 0) process.exit(result.status ?? 1);
}
const child = spawn(process.execPath, [join(root, 'node_modules/nuxt/bin/nuxt.mjs'), 'dev', ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, ...(process.platform === 'darwin' ? { TMPDIR: '/tmp' } : {}) },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
