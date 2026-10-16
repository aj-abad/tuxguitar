import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import builder from 'electron-builder';

// electron-builder calls this before copying extraResources for each target.
export default function prepareSidecar(context) {
  const platform = { win32: 'win', darwin: 'osx', linux: 'linux' }[context.electronPlatformName];
  const runtime = `${platform}-${builder.Arch[context.arch]}`;
  const result = spawnSync(process.execPath, [join(context.packager.projectDir, 'scripts/build-sidecar.mjs'), '--runtime', runtime], {
    cwd: context.packager.projectDir, stdio: 'inherit', windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error(`Audio publish failed for ${runtime}.`);
}
