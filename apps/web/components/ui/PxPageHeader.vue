<script setup lang="ts">
defineProps<{
  title?: string
  description?: string
  back?: { to: string; label?: string }
  sticky?: boolean
  compact?: boolean
}>()
</script>

<template>
  <header
    :class="[
      'flex flex-col gap-3 border-b border-border',
      compact ? 'pb-3' : 'pb-5',
      sticky && 'sticky top-0 z-20 bg-bg/95 pt-1 backdrop-blur'
    ]"
  >
    <NuxtLink
      v-if="back"
      :to="back.to"
      class="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
    >
      <UIcon name="i-heroicons-arrow-left" class="h-3.5 w-3.5" />
      {{ back.label ?? 'Back' }}
    </NuxtLink>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <slot name="title">
          <h1 :class="[compact ? 'text-lg' : 'text-xl', 'font-semibold tracking-tight text-fg']">{{ title }}</h1>
        </slot>
        <p v-if="description" class="mt-1 text-sm text-fg-muted">{{ description }}</p>
        <slot name="meta" />
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>
