<template>
  <aside
    class="absolute left-4 top-4 z-20 flex max-h-[calc(100%-2rem)] w-[200px] flex-col overflow-hidden rounded-2xl bg-black/70 text-white/90 shadow-2xl ring-1 ring-white/10 backdrop-blur-2xl"
    style="-webkit-app-region: no-drag">
    <!-- Header -->
    <header
      class="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2.5">
      <PhSlidersHorizontal class="size-4 opacity-70" />
      <span class="text-xs font-medium tracking-wide">Edit Tools</span>
      <span class="grow" />
      <button
        class="rounded p-0.5 opacity-50 transition hover:bg-white/10 hover:opacity-100"
        :title="collapsed ? 'Expand' : 'Collapse'"
        @click="collapsed = !collapsed">
        <PhCaretUp class="size-3.5 transition-transform" :class="collapsed && 'rotate-180'" />
      </button>
    </header>

    <!-- Body -->
    <div v-show="!collapsed" class="flex flex-col gap-4 overflow-y-auto p-3">
      <!-- Duration -->
      <section>
        <h3 :class="labelClass">Duration</h3>
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="d in durations"
            :key="d.id"
            :class="[btnClass, selectedDuration === d.id && activeClass]"
            :title="d.label"
            @click="selectedDuration = d.id">
            <span class="relative text-xl leading-none">{{ d.glyph }}</span>
            <span class="absolute bottom-0.5 right-1 text-[9px] tabular-nums opacity-50">{{ d.id }}</span>
          </button>
          <button :class="btnClass" title="Dotted note">
            <PhDot class="size-5" weight="fill" />
          </button>
          <button :class="btnClass" title="Triplet / tuplet">
            <span class="text-sm font-semibold">3</span>
          </button>
        </div>
      </section>

      <!-- Effects -->
      <section>
        <h3 :class="labelClass">Effects</h3>
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="e in effects"
            :key="e.label"
            :class="btnClass"
            :title="e.label">
            <component :is="e.icon" v-if="e.icon" class="size-4" />
            <span v-else :class="(e.text?.length ?? 0) > 1 ? 'text-[10px] font-semibold' : 'text-base leading-none'">{{ e.text }}</span>
          </button>
        </div>
      </section>

      <!-- Dynamics -->
      <section>
        <h3 :class="labelClass">Dynamics</h3>
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="dy in dynamics"
            :key="dy"
            :class="[btnClass, selectedDynamic === dy && activeClass]"
            :title="`Dynamic: ${dy}`"
            @click="selectedDynamic = dy">
            <span class="font-serif text-xs italic">{{ dy }}</span>
          </button>
        </div>
      </section>

      <!-- Insert -->
      <section>
        <h3 :class="labelClass">Insert</h3>
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="i in inserts"
            :key="i.label"
            :class="btnClass"
            :title="i.label">
            <component :is="i.icon" v-if="i.icon" class="size-4" />
            <span v-else :class="(i.text?.length ?? 0) > 1 ? 'text-[10px] font-semibold' : 'text-lg leading-none'">{{ i.text ?? i.glyph }}</span>
          </button>
        </div>
      </section>

      <!-- Edit -->
      <section>
        <h3 :class="labelClass">Edit</h3>
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="ed in edits"
            :key="ed.label"
            :class="btnClass"
            :title="ed.label">
            <component :is="ed.icon" v-if="ed.icon" class="size-4" />
            <span v-else class="text-base leading-none">{{ ed.glyph }}</span>
          </button>
        </div>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import {
  PhArrowBendUpRight,
  PhArrowDown,
  PhArrowLineLeft,
  PhArrowLineRight,
  PhArrowUp,
  PhBell,
  PhCaretUp,
  PhDiamond,
  PhDot,
  PhGreaterThan,
  PhHandTap,
  PhKey,
  PhLineSegment,
  PhMetronome,
  PhMinus,
  PhMusicNotes,
  PhPlus,
  PhSlidersHorizontal,
  PhSpeakerSimpleHigh,
  PhTextT,
  PhTrash,
  PhVibrate,
  PhWaveSine,
  PhWaveTriangle,
} from "@phosphor-icons/vue";
import { ref } from "vue";

// Shared Tailwind class strings
const labelClass =
  "mb-1.5 text-[10px] font-medium uppercase tracking-wider text-white/40";
const btnClass =
  "relative flex size-9 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white active:bg-white/15";
const activeClass = "bg-white/15 text-white ring-1 ring-white/20";

// Purely visual local selection (not wired to the model yet)
const collapsed = ref(false);
const selectedDuration = ref("4");
const selectedDynamic = ref("mf");

const durations = [
  { id: "1", glyph: "𝅝", label: "Whole note" },
  { id: "2", glyph: "𝅗𝅥", label: "Half note" },
  { id: "4", glyph: "♩", label: "Quarter note" },
  { id: "8", glyph: "♪", label: "Eighth note" },
  { id: "16", glyph: "𝅘𝅥𝅯", label: "Sixteenth note" },
  { id: "32", glyph: "𝅘𝅥𝅰", label: "Thirty-second note" },
  { id: "64", glyph: "𝅘𝅥𝅱", label: "Sixty-fourth note" },
];

const effects = [
  { label: "Dead note", text: "✕" },
  { label: "Ghost note", text: "( )" },
  { label: "Accentuated", icon: PhGreaterThan },
  { label: "Heavy accentuated", text: "^" },
  { label: "Vibrato", icon: PhWaveSine },
  { label: "Bend", icon: PhArrowBendUpRight },
  { label: "Slide", icon: PhLineSegment },
  { label: "Hammer-on / Pull-off", text: "⌒" },
  { label: "Palm mute", text: "P.M." },
  { label: "Let ring", icon: PhBell },
  { label: "Harmonic", icon: PhDiamond },
  { label: "Tapping", icon: PhHandTap },
  { label: "Staccato", icon: PhDot },
  { label: "Trill", text: "tr" },
  { label: "Tremolo bar", icon: PhWaveTriangle },
  { label: "Tremolo picking", icon: PhVibrate },
  { label: "Fade in", icon: PhSpeakerSimpleHigh },
  { label: "Grace note", text: "gr" },
];

const dynamics = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"];

const inserts = [
  { label: "Chord", icon: PhMusicNotes },
  { label: "Text", icon: PhTextT },
  { label: "Tempo", icon: PhMetronome },
  { label: "Time signature", text: "4/4" },
  { label: "Key signature", icon: PhKey },
  { label: "Clef", glyph: "𝄞" },
  { label: "Repeat open", glyph: "𝄆" },
  { label: "Repeat close", glyph: "𝄇" },
];

const edits = [
  { label: "Move beat left", icon: PhArrowLineLeft },
  { label: "Move beat right", icon: PhArrowLineRight },
  { label: "Shift note up", icon: PhArrowUp },
  { label: "Shift note down", icon: PhArrowDown },
  { label: "Semitone up", icon: PhPlus },
  { label: "Semitone down", icon: PhMinus },
  { label: "Tied note", glyph: "⌒" },
  { label: "Insert rest", glyph: "𝄽" },
  { label: "Delete note", icon: PhTrash },
];
</script>
