import { computed, readonly } from 'vue';
import { createTabBindings, tabShortcut, type TabCommandId, type TabKeymapOverrides } from '~~/shared/tab-commands';

/** Shared seam for a future preferences UI/storage adapter. Updates are atomic. */
export function useTabKeymap() {
  const overrides = useState<TabKeymapOverrides>('tab:keymap-overrides', () => ({}));
  const bindings = computed(() => createTabBindings(overrides.value));
  function setOverrides(next: TabKeymapOverrides) {
    createTabBindings(next);
    overrides.value = JSON.parse(JSON.stringify(next));
  }
  return { bindings, overrides: readonly(overrides), setOverrides, reset: () => setOverrides({}),
    shortcut: (id: TabCommandId) => tabShortcut(id, bindings.value) };
}
