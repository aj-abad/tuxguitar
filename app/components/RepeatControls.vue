<template>
  <section aria-label="Measure repeats">
    <h3 class="mb-2 text-xs text-white/70">Repeats</h3>
    <p v-if="!selectionRestriction" class="mb-3 text-xs leading-relaxed text-white/45">{{ repeats.reason || `Measure ${repeats.measure! + 1} · All tracks` }}</p>
    <div class="grid grid-cols-2 gap-2">
      <button v-for="command in commands" :key="command.id" type="button" class="repeat-button"
        :class="{ 'col-span-2': command.id === 'repeat.ending' }" :disabled="loading || !!repeats.reason"
        :aria-label="command.label" :aria-pressed="command.active" :data-repeat-command="command.id"
        :title="repeats.reason || command.label" @click="runTabCommand(command.id)">
        <span>{{ command.label }}</span><kbd v-if="shortcut(command.id)">{{ shortcut(command.id) }}</kbd>
      </button>
    </div>
    <div v-if="repeats.end" class="mt-3">
      <label for="repeat-plays" class="text-xs text-white/60">Total plays</label>
      <input id="repeat-plays" v-model="playsInput" type="number" inputmode="numeric" min="2" :max="MAX_REPEAT_PLAYS"
        class="repeat-input" :disabled="loading || !!repeats.reason" @change="applyPlays"
        @keydown.enter="($event.target as HTMLInputElement).blur()" @keydown.esc="resetPlays" />
    </div>
    <fieldset v-if="repeats.numbers.length" class="mt-3" :disabled="loading || !!repeats.reason">
      <legend class="mb-2 text-xs text-white/60">Play on passes</legend>
      <div class="grid grid-cols-4 gap-2">
        <label v-for="number in 8" :key="number" class="ending-number" :class="{ active: repeats.numbers.includes(number) }">
          <input type="checkbox" :checked="repeats.numbers.includes(number)" :aria-label="`Ending ${number}`" @change="toggleNumber(number)" />
          <span>{{ number }}</span>
        </label>
      </div>
    </fieldset>
    <p v-else-if="repeats.inherited" class="mt-3 text-xs leading-relaxed text-white/50" data-testid="inherited-ending">
      Ending {{ repeats.inherited.label.replace(/\.$/, '') }} continues from measure {{ repeats.inherited.measure + 1 }}.
    </p>
    <button type="button" class="editor-button mt-3 w-full text-xs" :disabled="loading || !!repeats.reason || !commands.some(c => c.active)"
      :title="shortcut('repeat.clear') || undefined" @click="runTabCommand('repeat.clear')">Clear measure repeats</button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { REPEAT_COMMANDS } from '~~/shared/tab-commands';
import { MAX_REPEAT_PLAYS } from '~~/shared/repeat-edits';

const { repeats, selectionRestriction, loading, runTabCommand, changeRepeatPlays, changeEndingNumbers } = useSong();
const { shortcut } = useTabKeymap();
const commands = computed(() => REPEAT_COMMANDS.map(command => ({ ...command, active:
  command.id === 'repeat.start' ? repeats.value.start : command.id === 'repeat.end' ? repeats.value.end : !!repeats.value.numbers.length })));
const playsInput = ref('2');
const resetPlays = () => { playsInput.value = String(repeats.value.plays); };
watch([() => repeats.value.measure, () => repeats.value.plays, () => repeats.value.reason], resetPlays, { immediate: true });
function applyPlays() {
  changeRepeatPlays(Number(playsInput.value));
  resetPlays();
}
function toggleNumber(number: number) {
  const numbers = repeats.value.numbers;
  changeEndingNumbers(numbers.includes(number) ? numbers.filter(n => n !== number) : [...numbers, number]);
}
</script>

<style scoped>
.repeat-button { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; border: 1px solid #ffffff1a; border-radius: 6px; padding: 7px 9px; font-size: 12px; text-align: left; background: #ffffff05; color: #ffffffc4; }
.repeat-button:hover:enabled { background: #ffffff10; }
.repeat-button[aria-pressed=true] { background: #0ea5e91a; border-color: #38bdf880; color: #7dd3fc; }
.repeat-button:disabled, fieldset:disabled { opacity: .4; }
.repeat-button:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
kbd { font-family: inherit; font-size: 10px; opacity: .55; }
.repeat-input { display: block; width: 100%; margin-top: 6px; padding: 6px; border: 1px solid #ffffff26; border-radius: 6px; background: #27272a; color: white; color-scheme: dark; font-size: 12px; }
.repeat-input:disabled { opacity: .5; }
.ending-number { display: flex; align-items: center; justify-content: center; gap: 5px; padding: 6px 3px; border: 1px solid #ffffff1a; border-radius: 6px; font-size: 12px; color: #ffffff99; cursor: pointer; }
.ending-number.active { background: #0ea5e91a; border-color: #38bdf880; color: #7dd3fc; }
.ending-number input { accent-color: #38bdf8; }
</style>
