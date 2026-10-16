export const TAB_COMMANDS = [
  { id: "column.left", label: "Move columns left", shortcut: "Alt+←" },
  { id: "column.right", label: "Move columns right", shortcut: "Alt+→" },
  { id: "column.copyLeft", label: "Duplicate columns left", shortcut: "Alt+Shift+←" },
  { id: "column.copyRight", label: "Duplicate columns right", shortcut: "Alt+Shift+→" },
  { id: "note.delete", label: "Delete notes", shortcut: "Delete" },
  { id: "voice.rest", label: "Make rest", shortcut: "R" },
  { id: "duration.longer", label: "Longer duration", shortcut: "+" },
  { id: "duration.shorter", label: "Shorter duration", shortcut: "−" },
  { id: "duration.dot", label: "Toggle dot", shortcut: "." },
] as const;
export type TabCommandId = typeof TAB_COMMANDS[number]["id"];
export type TabKeyAction = { kind: "command"; id: TabCommandId } | { kind: "digit"; digit: string }
  | { kind: "navigate"; direction: string; extend: boolean } | { kind: "collapse" };
export function resolveTabKey(event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "isComposing">): TabKeyAction | null {
  if (event.isComposing || event.ctrlKey || event.metaKey) return null;
  if (event.altKey) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return null;
    const left = event.key === "ArrowLeft";
    return { kind: "command", id: event.shiftKey ? left ? "column.copyLeft" : "column.copyRight" : left ? "column.left" : "column.right" };
  }
  if (/^[0-9]$/.test(event.key)) return { kind: "digit", digit: event.key };
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
    return { kind: "navigate", direction: event.key, extend: event.shiftKey };
  }
  if (event.key === "Escape") return { kind: "collapse" };
  const command: Record<string, TabCommandId> = { Delete: "note.delete", Backspace: "note.delete", r: "voice.rest", R: "voice.rest",
    "+": "duration.longer", "=": "duration.longer", "-": "duration.shorter", ".": "duration.dot" };
  return command[event.key] ? { kind: "command", id: command[event.key] } : null;
}
