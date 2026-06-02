<script setup lang="ts">
import type { DeckFontFace, DeckSlideDetail } from '~/lib/deck-content'
import { buildDeckSlidePreview, deckSlidePreviewValidation } from '~/lib/deck-content'

const props = defineProps<{
  slides: DeckSlideDetail[]
  selectedSlideId: string | null
  deckTitle: string
  fontFaces?: DeckFontFace[]
}>()

const emit = defineEmits<{
  (e: 'select', slideId: string): void
}>()

function previewFor(slide: DeckSlideDetail) {
  return buildDeckSlidePreview(slide, props.deckTitle)
}
</script>

<template>
  <div class="scrollbar-soft flex gap-2 overflow-x-auto px-3 py-2">
    <button
      v-for="(slide, idx) in slides"
      :key="slide.id"
      type="button"
      class="w-32 shrink-0 rounded-lg border p-1 text-left transition-all"
      :class="slide.id === selectedSlideId ? 'border-accent bg-accent-soft shadow-[0_2px_8px_var(--px-accent-glow)]' : 'border-border bg-surface-raised hover:border-border-strong hover:bg-surface'"
      @click="emit('select', slide.id)"
    >
      <div class="relative aspect-video w-full overflow-hidden rounded-md border border-border bg-white">
        <div class="absolute left-1 top-1 z-10 rounded bg-black/65 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">{{ idx + 1 }}</div>
        <div class="h-full w-full origin-top-left scale-[0.125]" style="width: 800%; height: 800%;">
          <SlidePreviewFrame :slide="previewFor(slide)" :validation="deckSlidePreviewValidation" :fontFaces="fontFaces ?? []" class="h-full w-full" />
        </div>
      </div>
      <p :class="['mt-1 truncate px-1 text-xs font-bold', slide.id === selectedSlideId ? 'text-accent' : 'text-fg-muted']">{{ slide.title }}</p>
    </button>

    <div v-if="slides.length === 0" class="flex w-full items-center justify-center py-4 text-sm text-fg-subtle">
      No slides yet
    </div>
  </div>
</template>
