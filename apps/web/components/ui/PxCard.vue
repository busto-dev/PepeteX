<script setup lang="ts">
withDefaults(defineProps<{
  padding?: 'none' | 'sm' | 'md' | 'lg'
  bordered?: boolean
  hover?: boolean
  hoverable?: boolean
  raised?: boolean
  density?: 'compact' | 'comfortable'
}>(), {
  padding: 'md',
  bordered: true,
  hoverable: false,
  raised: false,
  density: 'compact'
})

const padMap = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5' }
</script>

<template>
  <div
    :class="[
      density === 'comfortable' ? 'rounded-xl' : 'rounded-lg',
      'bg-surface',
      'shadow-[0_1px_4px_rgba(0,0,0,0.05)]',
      raised && 'shadow-md',
      bordered && 'border border-border',
      hover && 'transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md',
      hoverable && 'cursor-pointer transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[0_6px_20px_rgba(0,0,0,0.10)]',
      padMap[padding]
    ]"
  >
    <slot />
  </div>
</template>
