<script setup lang="ts">
defineProps<{
  modelValue: string
  options: Array<{ value: string; label: string; icon?: string; count?: number }>
}>()
defineEmits<{ (e: 'update:modelValue', v: string): void }>()
</script>

<template>
  <div class="flex items-center gap-1 border-b border-border">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      :aria-pressed="modelValue === opt.value"
      :class="[
        'group relative flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors',
        modelValue === opt.value ? 'text-fg' : 'text-fg-muted hover:text-fg'
      ]"
      @click="$emit('update:modelValue', opt.value)"
    >
      <UIcon v-if="opt.icon" :name="opt.icon" class="h-4 w-4" />
      {{ opt.label }}
      <span v-if="typeof opt.count === 'number'" class="rounded-full bg-bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">{{ opt.count }}</span>
      <span
        :class="[
          'absolute inset-x-0 -bottom-px h-px transition-colors',
          modelValue === opt.value ? 'bg-fg' : 'bg-transparent'
        ]"
      />
    </button>
  </div>
</template>
