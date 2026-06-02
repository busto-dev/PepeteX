<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  options: Array<{ value: string; label: string; icon?: string }>
  size?: 'sm' | 'md'
}>()

defineEmits<{ (e: 'update:modelValue', v: string): void }>()
</script>

<template>
  <div :class="['inline-flex items-center rounded-md border border-border bg-bg-subtle p-0.5', size === 'sm' ? 'text-xs' : 'text-[13px]']">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      :aria-pressed="modelValue === opt.value"
      :class="[
        'flex items-center gap-1.5 rounded-[5px] px-2.5 font-medium transition-colors',
        size === 'sm' ? 'h-6' : 'h-7',
        modelValue === opt.value
          ? 'bg-surface text-fg shadow-xs'
          : 'text-fg-muted hover:text-fg'
      ]"
      @click="$emit('update:modelValue', opt.value)"
    >
      <UIcon v-if="opt.icon" :name="opt.icon" class="h-3.5 w-3.5" />
      {{ opt.label }}
    </button>
  </div>
</template>
