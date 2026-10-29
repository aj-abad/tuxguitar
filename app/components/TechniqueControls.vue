<template>
  <section aria-label="Note techniques">
    <h3 class="mb-2 text-xs text-white/70">Techniques</h3>
    <div class="grid grid-cols-2 gap-2">
      <span v-for="command in commands" :key="command.id" :title="command.reason || command.label" :class="{ 'col-span-2': command.kind === 'tie' }">
        <button type="button" class="technique-button" :disabled="loading || !!command.reason" :aria-label="command.label"
          :aria-pressed="command.active" :data-technique-command="command.kind" @click="runTabCommand(command.id)">
          <span>{{ command.label }}</span><kbd v-if="shortcut(command.id)">{{ shortcut(command.id) }}</kbd>
        </button>
      </span>
    </div>
    <p v-if="!selectionRestriction" class="mt-2 text-xs leading-relaxed text-white/45">{{ selectionHint }}</p>
    <details class="mt-3" :open="!!selectedNote?.effect.bend">
      <summary class="cursor-pointer text-xs text-white/70">Bend settings</summary>
      <p v-if="customBend" class="mt-2 text-xs text-white/50">Custom curve. Applying a preset replaces its shape.</p>
      <div class="mt-3 grid grid-cols-2 gap-2">
        <label class="col-span-2 text-xs text-white/60">Shape
          <select v-model="shape" aria-label="Bend shape" class="technique-input" :disabled="loading || !!techniques.bend.reason">
            <option v-for="preset in BEND_SHAPES" :key="preset.id" :value="preset.id">{{ preset.label }}</option>
          </select>
        </label>
        <label class="text-xs text-white/60">Amount
          <select v-model.number="amount" aria-label="Bend amount" class="technique-input" :disabled="loading || !!techniques.bend.reason">
            <option v-for="value in 12" :key="value" :value="value">{{ bendAmount(value) }}</option>
          </select>
        </label>
        <button type="button" class="editor-button self-end text-xs" :disabled="loading || !!techniques.bend.reason || sameBend" @click="applyBend">Apply bend</button>
      </div>
    </details>
    <button type="button" class="editor-button mt-3 w-full text-xs" :disabled="loading || !commands.some(c => c.active)" @click="runTabCommand('technique.clear')">Clear techniques</button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { TECHNIQUE_COMMANDS } from '~~/shared/tab-commands';
import { BEND_SHAPES, DEFAULT_BEND, bendPreset, makeBend, type BendShape, type Technique } from '~~/shared/technique-edits';
import { bendAmount } from '~~/shared/tab-techniques';
import { modelSignature } from '~~/shared/model-signature';
import { cursorKey } from '~~/shared/score-edits';

const { selectedNote, selection, techniques, selectionRestriction, loading, runTabCommand, changeBend } = useSong();
const { shortcut } = useTabKeymap();
const shape = ref<BendShape>(DEFAULT_BEND.shape), amount = ref(DEFAULT_BEND.amount);
const commands = computed(() => TECHNIQUE_COMMANDS.map(command => {
  const kind = command.id.slice('technique.'.length) as Technique;
  return { ...command, kind, ...techniques.value[kind] };
}));
const selectionHint = computed(() => techniques.value.bend.reason ?? 'Slide and H/P connect to the next note on this string.');
const customBend = computed(() => selectedNote.value?.effect.bend && !bendPreset(selectedNote.value.effect.bend));
const sameBend = computed(() => modelSignature(selectedNote.value?.effect.bend) === modelSignature(makeBend(shape.value, amount.value)));
watch([() => selection.value && cursorKey(selection.value), () => selectedNote.value?.effect.bend], () => {
  const preset = selectedNote.value?.effect.bend && bendPreset(selectedNote.value.effect.bend);
  shape.value = preset ? preset.shape : DEFAULT_BEND.shape;
  amount.value = preset ? preset.amount : DEFAULT_BEND.amount;
}, { immediate: true });
function applyBend() { changeBend(makeBend(shape.value, amount.value)); }
</script>

<style scoped>
.technique-button { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; border: 1px solid #ffffff1a; border-radius: 6px; padding: 7px 9px; font-size: 12px; text-align: left; background: #ffffff05; color: #ffffffc4; }
.technique-button:hover:enabled { background: #ffffff10; }
.technique-button[aria-pressed=true] { background: #0ea5e91a; border-color: #38bdf880; color: #7dd3fc; }
.technique-button:disabled { opacity: .4; }
.technique-button:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
kbd { font-family: inherit; font-size: 10px; opacity: .55; }
.technique-input { display: block; width: 100%; margin-top: 6px; padding: 6px; border: 1px solid #ffffff26; border-radius: 6px; background: #27272a; color: white; color-scheme: dark; font-size: 12px; }
.technique-input:disabled { opacity: .5; }
</style>
