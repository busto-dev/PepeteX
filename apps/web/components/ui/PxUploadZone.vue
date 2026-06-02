<script setup lang="ts">
const props = defineProps<{
  label: string
  description?: string
  accept?: string
  multiple?: boolean
  files?: File[]
}>()

const emit = defineEmits<{
  (e: 'select', event: Event): void
  (e: 'remove', index: number): void
}>()

const inputId = `px-upload-${Math.random().toString(36).slice(2, 9)}`
</script>

<template>
  <div class="rounded-lg border border-border bg-surface p-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs font-semibold text-fg">{{ label }}</p>
        <p v-if="description" class="mt-0.5 text-[11px] leading-4 text-fg-subtle">{{ description }}</p>
      </div>
      <label
        :for="inputId"
        class="px-focus-ring inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-fg transition hover:border-fg-subtle"
      >
        <UIcon name="i-heroicons-arrow-up-tray" class="h-3.5 w-3.5" />
        Add
      </label>
    </div>
    <input :id="inputId" type="file" :multiple="multiple" :accept="accept" class="sr-only" @change="emit('select', $event)" />
    <div v-if="files?.length" class="mt-3 flex flex-wrap gap-1.5">
      <button
        v-for="(file, index) in files"
        :key="`${file.name}-${index}`"
        type="button"
        class="px-focus-ring inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-bg-subtle px-2 py-1 text-[11px] font-medium text-fg-muted transition hover:border-border-strong hover:text-fg"
        @click="emit('remove', index)"
      >
        <span class="truncate">{{ file.name }}</span>
        <UIcon name="i-heroicons-x-mark" class="h-3 w-3 shrink-0" />
      </button>
    </div>
  </div>
</template>
