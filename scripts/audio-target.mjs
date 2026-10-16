export function audioTarget(runtime) {
  runtime ??= `${{ win32: 'win', darwin: 'osx', linux: 'linux' }[process.platform]}-${process.arch}`;
  if (!/^(win|osx|linux)-(x64|arm64)$/.test(runtime)) throw new Error(`Unsupported audio runtime: ${runtime}`);
  return {
    runtime,
    folder: runtime.replace(/^osx-/, 'mac-'),
    binary: runtime.startsWith('win-') ? 'tabbycat-audio.exe' : 'tabbycat-audio',
  };
}
