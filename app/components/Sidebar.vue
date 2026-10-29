<template>
  <aside class="max-h-[45vh] shrink-0 overflow-y-auto border-t border-white/10 bg-zinc-900/40 p-4 text-white md:max-h-none md:w-64 md:border-l md:border-t-0">
    <h2 class="mb-4 text-sm font-medium">Edit tablature</h2>
    <template v-if="selection && track && selectedVoice">
      <p class="mb-1 truncate text-sm text-white/80">{{ track.name }}</p>
      <p class="mb-4 text-xs text-white/50" aria-live="polite">
        Measure {{ selection.measure + 1 }} · Beat {{ beatNumber }} · Voice {{ selection.voice + 1 }}
      </p>
      <p v-if="selectionRestriction" class="mb-4 text-xs leading-relaxed text-white/70" data-testid="selection-edit-reason" aria-live="polite">{{ selectionRestriction }}</p>
      <label for="note-string" class="mb-2 block text-xs text-white/70">String</label>
      <select id="note-string" :value="selection.string" :disabled="loading" class="editor-input mb-4" @change="chooseString">
        <option v-for="string in track.strings" :key="string.number" :value="string.number">{{ string.number }} · {{ pitchName(string.value) }}</option>
      </select>
      <label for="note-fret" class="mb-2 block text-xs text-white/70">Fret</label>
      <input
        id="note-fret"
        :value="fretInput"
        @input="fretInput = ($event.target as HTMLInputElement).value"
        type="number" inputmode="numeric" min="0" :max="track.maxFret"
        :placeholder="selectedVoice.notes.length ? 'Empty string' : 'Rest'"
        :disabled="loading || !!selectionRestriction" class="editor-input"
        @change="applyFret"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
        @keydown.esc="fretInput = selectedNote ? String(selectedNote.value) : ''" />
      <p class="mt-2 text-xs text-white/45">0–{{ track.maxFret }} · Type a fret to add a note</p>
      <p v-if="selectedNote?.tiedNote" class="mt-3 text-xs text-white/60">Fret edits apply to the whole tied note.</p>
      <div class="mt-3 flex gap-2">
        <button class="editor-button flex-1 text-xs" :disabled="loading || !hasSelectedNotes" @click="removeNote">Delete notes</button>
        <button class="editor-button flex-1 text-xs" :disabled="loading || !!selectionRestriction || !selectedColumnsHaveNotes" aria-label="Make beat a rest" @click="makeRest">Rest</button>
      </div>
      <div class="my-5 border-t border-white/10" />
      <TechniqueControls />
      <div class="my-5 border-t border-white/10" />
      <label for="note-duration" class="mb-2 block text-xs text-white/70">Duration</label>
      <select id="note-duration" :value="selectedVoice.duration.value" :disabled="loading || !!selectionRestriction" class="editor-input mb-4" @change="chooseDuration">
        <option v-for="duration in durations" :key="duration.value" :value="duration.value">{{ duration.label }}</option>
      </select>
      <label for="note-dots" class="mb-2 block text-xs text-white/70">Dots</label>
      <select id="note-dots" :value="dots" :disabled="loading || !!selectionRestriction" class="editor-input" @change="chooseDots">
        <option :value="0">None</option><option :value="1">Dotted</option><option :value="2">Double dotted</option>
      </select>
      <p v-if="selectedVoice.duration.division && selectedVoice.duration.division.enters !== selectedVoice.duration.division.times" class="mt-2 text-xs text-white/50">
        Tuplet {{ selectedVoice.duration.division.enters }}:{{ selectedVoice.duration.division.times }}
      </p>
      <div class="my-5 border-t border-white/10" />
      <RepeatControls />
      <div class="mt-5 flex gap-2">
        <button class="editor-button flex-1" :disabled="loading" aria-label="Previous beat" @click="navigate('ArrowLeft')"><PhArrowLeft class="size-4" /></button>
        <button class="editor-button flex-1" :disabled="loading" aria-label="Next beat" @click="navigate('ArrowRight')"><PhArrowRight class="size-4" /></button>
      </div>
      <div class="mt-5 border-t border-white/10 pt-4">
        <p class="mb-2 text-xs text-white/70">Columns</p>
        <div class="grid grid-cols-2 gap-2">
          <button v-for="command in columnCommands" :key="command.id" class="editor-button text-xs" :disabled="loading || !!selectionRestriction" :aria-label="command.label"
            :title="[command.label, shortcut(command.id)].filter(Boolean).join(' · ')" @click="runTabCommand(command.id)">{{ command.id.includes('copy') ? 'Duplicate' : 'Move' }} {{ command.id.endsWith('Left') || command.id.endsWith('left') ? '←' : '→' }}</button>
        </div>
      </div>
      <p class="mt-5 text-xs leading-relaxed text-white/50">← → columns · ↑ ↓ strings<br>Shift + arrows select</p>
      <p class="mt-2 text-xs leading-relaxed text-white/50">Drag to select strings · Across rows selects whole columns</p>
      <dl class="mt-2 space-y-1 text-xs text-white/50">
        <div v-for="command in shortcutHelp" :key="command.id" class="flex justify-between gap-2"><dt>{{ command.label }}</dt><dd>{{ shortcut(command.id) || 'Unbound' }}</dd></div>
      </dl>
    </template>
    <p v-else class="text-sm text-white/60">Select a note or rest in the score.</p>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { PhArrowLeft, PhArrowRight } from "@phosphor-icons/vue";
import { TAB_COMMANDS } from "~~/shared/tab-commands";

const { song, selection, selectedNote, selectedVoice, hasSelectedNotes, selectedColumnsHaveNotes, selectionRestriction, loading, changeFret, navigate,
  selectCursor, changeDuration, removeNote, makeRest, runTabCommand } = useSong();
const columnCommands = TAB_COMMANDS.filter(command => command.id.startsWith('column.'));
const shortcutHelp = TAB_COMMANDS.filter(command => !command.id.startsWith('technique.') && !command.id.startsWith('repeat.'));
const { shortcut } = useTabKeymap();
const track = computed(() => song.value && selection.value ? song.value.tracks[selection.value.track] : null);
const beatNumber = computed(() => selection.value && track.value ? track.value.measures[selection.value.measure]!.beats
  .slice(0, selection.value.beat + 1).filter(beat => beat.voices[selection.value!.voice] && !beat.voices[selection.value!.voice]!.empty).length : 0);
const dots = computed(() => selectedVoice.value?.duration.doubleDotted ? 2 : selectedVoice.value?.duration.dotted ? 1 : 0);
const durations = [
  { value: 1, label: "Whole" }, { value: 2, label: "Half" }, { value: 4, label: "Quarter" },
  { value: 8, label: "Eighth" }, { value: 16, label: "16th" }, { value: 32, label: "32nd" }, { value: 64, label: "64th" },
];
const fretInput = ref("");
watch([selectedNote, selection], ([note]) => { fretInput.value = note ? String(note.value) : ""; }, { immediate: true });
function applyFret() {
  const value = fretInput.value.trim();
  if (value) changeFret(Number(value));
  fretInput.value = selectedNote.value ? String(selectedNote.value.value) : "";
}
function chooseString(event: Event) {
  if (selection.value) selectCursor({ ...selection.value, string: Number((event.target as HTMLSelectElement).value) });
}
function chooseDuration(event: Event) {
  const input = event.target as HTMLSelectElement;
  if (selectedVoice.value) changeDuration({ ...selectedVoice.value.duration, value: Number(input.value) });
  input.value = String(selectedVoice.value?.duration.value);
}
function chooseDots(event: Event) {
  const input = event.target as HTMLSelectElement;
  const count = Number(input.value);
  if (selectedVoice.value) changeDuration({ ...selectedVoice.value.duration, dotted: count === 1, doubleDotted: count === 2 });
  input.value = String(dots.value);
}
function pitchName(pitch: number) {
  return ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][pitch % 12] + String(Math.floor(pitch / 12) - 1);
}
</script>

<style scoped>
.editor-input {
  width: 100%; border: 1px solid rgb(255 255 255 / 0.15); border-radius: 0.5rem;
  background: #27272a; padding: 0.5rem 0.75rem; font-size: 0.875rem; outline: none;
}
.editor-input:focus { border-color: #38bdf8; box-shadow: 0 0 0 1px #38bdf8; }
.editor-input:disabled { opacity: 0.5; }
</style>
