<script setup lang="ts">
defineProps<{
  dense?: boolean
}>()
</script>

<template>
  <div
    :class="[
      'flex min-w-0 flex-wrap items-center gap-2 border-b border-border bg-surface',
      dense ? 'px-3 py-2' : 'px-4 py-3'
    ]"
  >
    <slot />
  </div>
</template>
