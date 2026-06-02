<script setup lang="ts">
const props = defineProps<{
  slideId: string | null
  slideIndex: number
  totalSlides: number
  canManage: boolean
}>()

const emit = defineEmits<{
  (e: 'moveUp'): void
  (e: 'moveDown'): void
  (e: 'duplicate'): void
  (e: 'delete'): void
}>()
</script>

<template>
  <div class="flex items-center gap-2 flex-wrap">
    <button
      type="button"
      class="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
      :disabled="!canManage || slideIndex === 0"
      @click="emit('moveUp')"
      title="Move slide up"
    >↑ Up</button>
    <button
      type="button"
      class="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
      :disabled="!canManage || slideIndex >= totalSlides - 1"
      @click="emit('moveDown')"
      title="Move slide down"
    >↓ Down</button>
    <button
      type="button"
      class="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
      :disabled="!canManage || !slideId"
      @click="emit('duplicate')"
    >⊕ Duplicate</button>
    <button
      type="button"
      class="rounded-xl border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40"
      :disabled="!canManage || !slideId"
      @click="emit('delete')"
    >✕ Delete</button>
  </div>
</template>
