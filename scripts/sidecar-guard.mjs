// Audio is optional for editing. A failed build must not block the dev server.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioTarget } from './audio-target.mjs';

if (process.env.DEV_SKIP_SIDECAR !== '1') {
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    const target = audioTarget();
    if (!existsSync(join(root, 'sidecar/bin', target.folder, target.binary)) ||
        !existsSync(join(root, 'sidecar/bin/GeneralUser.sf2'))) {
      console.log('[dev] building .NET audio (first run downloads the SoundFont and runtime)…');
      const build = spawnSync(process.execPath, [join(root, 'scripts/build-sidecar.mjs')], {
        cwd: root, stdio: 'inherit', windowsHide: true,
      });
      if (build.error || build.status !== 0) throw new Error('Install the .NET 10 SDK, then run pnpm sidecar:build.');
    }
  } catch (error) {
    console.warn(`[dev] continuing without audio: ${error.message}`);
  }
}
