/** Formats implemented by the modern editor, shared by Open and file drops. */
export const SONG_FILE_EXTENSIONS = ["tgx", "tg"];
export const SONG_FILE_FORMATS = SONG_FILE_EXTENSIONS.map(extension => `.${extension}`).join(", ");

export function isSupportedSongFile(name: string): boolean {
  return SONG_FILE_EXTENSIONS.some(extension => name.toLowerCase().endsWith(`.${extension}`));
}
