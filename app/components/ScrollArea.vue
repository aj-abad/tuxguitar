<template>
  <ScrollAreaRoot :class="cn('h-full w-full', props.rootClass)">
    <ScrollAreaViewport :class="cn('h-full w-full outline-none', props.viewportClass)">
      <slot />
    </ScrollAreaViewport>
    <ScrollAreaScrollbar
      orientation="vertical"
      :class="
        cn(
          'flex select-none touch-none p-0.5 bg-transparent transition-all duration-150 ease-out data-[orientation=vertical]:w-2 data-[orientation=vertical]:hover:w-3',
          props.scrollbarClass,
        )
      ">
      <ScrollAreaThumb
        :class="
          cn(
            'flex-1 z-100 bg-black/20 rounded-full relative cursor-grab active:cursor-grabbing',
            props.thumbClass,
          )
        " />
    </ScrollAreaScrollbar>
    <ScrollAreaScrollbar
      orientation="horizontal"
      :class="
        cn(
          'flex flex-col select-none touch-none p-0.5 bg-transparent transition-all duration-150 ease-out data-[orientation=horizontal]:h-2 data-[orientation=horizontal]:hover:h-3',
          props.scrollbarClass,
        )
      ">
      <ScrollAreaThumb
        :class="
          cn(
            'flex-1 z-100 bg-black/20 rounded-full relative cursor-grab active:cursor-grabbing',
            props.thumbClass,
          )
        " />
    </ScrollAreaScrollbar>
    <ScrollAreaCorner class="bg-black/5" />
  </ScrollAreaRoot>
</template>

<script setup lang="ts">
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from "reka-ui";

interface Props {
  rootClass?: string;
  viewportClass?: string;
  scrollbarClass?: string;
  thumbClass?: string;
}

const props = defineProps<Props>();
</script>
