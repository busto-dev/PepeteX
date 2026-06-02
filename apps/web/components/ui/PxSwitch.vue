<script setup lang="ts">
defineProps<{
  modelValue: boolean
  size?: 'sm' | 'md'
  disabled?: boolean
}>()
defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    :class="[
      'px-focus-ring relative inline-flex shrink-0 items-center rounded-full transition-colors',
      'disabled:cursor-not-allowed disabled:opacity-50',
      size === 'sm' ? 'h-4 w-7' : 'h-5 w-9',
      modelValue ? 'bg-accent' : 'bg-bg-muted'
    ]"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <span
      :class="[
        'inline-block transform rounded-full bg-white shadow-sm transition-transform',
        size === 'sm' ? 'h-3 w-3' : 'h-4 w-4',
        modelValue ? (size === 'sm' ? 'translate-x-3.5' : 'translate-x-4') : 'translate-x-0.5'
      ]"
    />
  </button>
</template>
