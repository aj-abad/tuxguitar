import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioTarget } from './audio-target.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = audioTarget(process.argv.includes('--runtime') ? process.argv[process.argv.indexOf('--runtime') + 1] : undefined);
const sdk = spawnSync('dotnet', ['--version'], { cwd: root, windowsHide: true, encoding: 'utf8' });
if (sdk.error || sdk.status !== 0 || !sdk.stdout.trim().startsWith('10.')) {
  console.error('.NET 10 SDK is required to build audio. Install it, then run pnpm sidecar:build.');
  process.exit(1);
}
const bin = join(root, 'sidecar', 'bin');
mkdirSync(bin, { recursive: true });
const sf = join(bin, 'GeneralUser.sf2');
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
const out = join(bin, target.folder);
const result = spawnSync('dotnet', ['publish', join(root, 'sidecar/Tabbycat.Audio.csproj'),
  '--configuration', 'Release', '--runtime', target.runtime, '--self-contained', 'true',
  '-p:RestoreLockedMode=true', '--output', out], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error || result.status !== 0) process.exit(result.status ?? 1);
if (!existsSync(join(out, target.binary))) throw new Error('Audio publish did not produce an executable.');
// Keep the notices from the actual restored/published dependency versions.
const assets = JSON.parse(readFileSync(join(root, 'sidecar/obj/project.assets.json'), 'utf8'));
const runtimeConfig = JSON.parse(readFileSync(join(out, 'tabbycat-audio.runtimeconfig.json'), 'utf8'));
const runtimeVersion = runtimeConfig.runtimeOptions.includedFrameworks.find(framework => framework.name === 'Microsoft.NETCore.App').version;
const licenses = join(out, 'licenses');
mkdirSync(licenses, { recursive: true });
for (const [source, destination] of [
  ['meltysynth/2.4.1/LICENSE.txt', 'MeltySynth.txt'],
  [`microsoft.netcore.app.runtime.${target.runtime}/${runtimeVersion}/LICENSE.TXT`, 'dotnet-LICENSE.txt'],
  [`microsoft.netcore.app.runtime.${target.runtime}/${runtimeVersion}/THIRD-PARTY-NOTICES.TXT`, 'dotnet-THIRD-PARTY-NOTICES.txt'],
]) {
  const path = Object.keys(assets.packageFolders).map(folder => join(folder, source)).find(existsSync);
  if (!path) throw new Error(`Missing dependency notice: ${source}`);
  copyFileSync(path, join(licenses, destination));
}
console.log(`Audio built: ${join(out, target.binary)} (self-contained .NET, ${target.runtime})`);
