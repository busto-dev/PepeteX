<script setup lang="ts">
defineProps<{ icon?: string; title?: string; description?: string }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-bg-subtle px-6 py-10 text-center">
    <div v-if="icon" class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-bg-muted text-fg-subtle">
      <UIcon :name="icon" class="h-5 w-5" />
    </div>
    <h3 v-if="title" class="text-sm font-semibold text-fg">{{ title }}</h3>
    <p v-if="description" class="mt-1 max-w-sm text-sm text-fg-muted">{{ description }}</p>
    <div v-if="$slots.default" class="mt-4"><slot /></div>
  </div>
</template>
