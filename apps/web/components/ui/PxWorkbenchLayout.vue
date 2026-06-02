<script setup lang="ts">
defineProps<{
  leftOpen?: boolean
  rightOpen?: boolean
}>()
</script>

<template>
  <div class="flex h-screen min-w-0 overflow-hidden bg-bg text-fg">
    <slot name="left" />
    <main class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <slot />
    </main>
    <slot name="right" />
  </div>
</template>
