<script setup lang="ts">
import type { DeckFontFace, DeckSlideDetail } from '~/lib/deck-content'
import { buildDeckSlidePreview, deckSlidePreviewValidation } from '~/lib/deck-content'

const props = defineProps<{
  slide: DeckSlideDetail | null
  deckTitle: string
  fontFaces?: DeckFontFace[]
  commentMode?: boolean
  interactionMode?: 'none' | 'comment' | 'edit'
  selectedElementId?: string | null
}>()

const emit = defineEmits<{
  (e: 'elementClick', payload: { elementId: string; elementType: string | undefined }): void
}>()

const preview = computed(() =>
  buildDeckSlidePreview(props.slide, props.deckTitle)
)

const previewKey = computed(() => {
  const slide = props.slide
  if (!slide) return 'empty'

  return [
    slide.id,
    slide.title,
    stablePreviewToken(`${slide.html}\n${slide.css}`)
  ].join(':')
})

function stablePreviewToken(value: string): string {
  let hash = 5381

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index)
  }

  return (hash >>> 0).toString(36)
}
</script>

<template>
  <div class="relative w-full overflow-hidden rounded-lg bg-black" style="aspect-ratio: 16/9;">
    <SlidePreviewFrame
      v-if="slide"
      :key="previewKey"
      :slide="preview"
      :validation="deckSlidePreviewValidation"
      :fontFaces="fontFaces ?? []"
      :commentMode="commentMode"
      :interactionMode="interactionMode"
      :selectedElementId="selectedElementId"
      class="h-full w-full"
      @element-click="emit('elementClick', $event)"
    />
    <div v-else class="flex h-full w-full items-center justify-center text-slate-400 text-sm">
      No slide selected
    </div>
  </div>
</template>
