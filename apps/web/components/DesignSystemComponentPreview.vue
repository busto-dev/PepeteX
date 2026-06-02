<script setup lang="ts">
import { computed } from 'vue';

import type { PreviewSlideDocument } from '~/lib/slide-preview';

const props = defineProps<{
  componentId: string;
  componentHtml: string;
  componentCss: string;
  componentName?: string;
  scale?: number;
}>();

const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;

const wrappedHtml = computed(() => {
  return `<section class="pepetex-slide" data-pepetex-slide-id="ds-component-preview" style="position:relative;width:1920px;height:1080px;overflow:hidden;background:#f8f9fa;display:flex;align-items:center;justify-content:center;">${props.componentHtml}</section>`;
});

const previewSlide = computed<PreviewSlideDocument>(() => ({
  id: `ds-component-${props.componentId}`,
  title: props.componentName ?? 'Component Preview',
  html: wrappedHtml.value,
  css: props.componentCss
}));

const displayScale = computed(() => props.scale ?? 0.5);
</script>

<template>
  <div class="ds-component-preview">
    <div
      v-if="componentName"
      class="ds-component-preview__label"
    >
      {{ componentName }}
    </div>
    <div
      class="ds-component-preview__frame-wrapper"
      :style="{
        width: `${CANVAS_WIDTH * displayScale}px`,
        height: `${CANVAS_HEIGHT * displayScale}px`,
        overflow: 'hidden',
        position: 'relative'
      }"
    >
      <SlidePreviewFrame
        :slide="previewSlide"
        :style="{
          transform: `scale(${displayScale})`,
          transformOrigin: 'top left',
          width: `${CANVAS_WIDTH}px`,
          height: `${CANVAS_HEIGHT}px`,
          position: 'absolute',
          top: 0,
          left: 0
        }"
      />
    </div>
  </div>
</template>

<style scoped>
.ds-component-preview {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.ds-component-preview__label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-text-secondary, #6b7280);
}

.ds-component-preview__frame-wrapper {
  border-radius: 0.375rem;
  overflow: hidden;
  border: 1px solid var(--color-border, #e5e7eb);
}
</style>
