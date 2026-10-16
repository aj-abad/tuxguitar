import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../sidecar', import.meta.url));
const out = join(root, 'bin');
const cargo = spawnSync('cargo', ['--version'], { windowsHide: true, stdio: 'ignore' });
if (cargo.error || cargo.status !== 0) {
  console.error('Rust cargo is required to build audio. Install Rust, then run pnpm sidecar:build.');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const sf = join(out, 'GeneralUser.sf2');
if (!existsSync(sf)) {
  const response = await fetch('https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2');
  if (!response.ok) throw new Error(`SoundFont download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'sfbk') {
    throw new Error('Downloaded file is not a SoundFont.');
  }
  writeFileSync(`${sf}.download`, bytes);
  renameSync(`${sf}.download`, sf);
}
const header = readFileSync(sf).subarray(0, 12);
if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'sfbk') {
  throw new Error('GeneralUser.sf2 is not a valid SoundFont.');
}
const result = spawnSync('cargo', ['build', '--release'], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error || result.status !== 0) process.exit(result.status ?? 1);
const binary = process.platform === 'win32' ? 'tuxguitar-sidecar.exe' : 'tuxguitar-sidecar';
copyFileSync(join(root, 'target/release', binary), join(out, binary));
console.log(`Audio built: ${join(out, binary)}`);
