<script setup lang="ts">
withDefaults(defineProps<{
  src?: string | null
  name?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
}>(), { size: 'md' })

const sizeMap = {
  xs: 'h-5 w-5 text-[10px]',
  sm: 'h-6 w-6 text-[11px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
  xl: 'h-14 w-14 text-base'
}

function initials(name?: string | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}
</script>

<template>
  <span :class="['inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-bg-muted font-semibold text-fg-muted', sizeMap[size]]">
    <img v-if="src" :src="src" :alt="name ?? ''" class="h-full w-full object-cover" />
    <template v-else>{{ initials(name) }}</template>
  </span>
</template>
