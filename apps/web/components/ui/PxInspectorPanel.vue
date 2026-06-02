<script setup lang="ts">
defineProps<{
  title: string
  eyebrow?: string
}>()

defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <aside class="flex min-h-0 w-full flex-col border-l border-border bg-surface shadow-sm lg:w-[320px] xl:w-[340px]">
    <div class="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
      <div class="min-w-0">
        <p v-if="eyebrow" class="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">{{ eyebrow }}</p>
        <h3 class="truncate text-sm font-semibold capitalize text-fg">{{ title }}</h3>
      </div>
      <PxButton variant="ghost" size="sm" icon="i-heroicons-x-mark" square aria-label="Close inspector" @click="$emit('close')" />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-soft">
      <slot />
    </div>
  </aside>
</template>
