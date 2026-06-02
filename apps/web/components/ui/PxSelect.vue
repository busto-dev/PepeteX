<script setup lang="ts">
defineProps<{
  modelValue?: string | number | null
  options: Array<{ value: string | number; label: string; disabled?: boolean }>
  placeholder?: string
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  label?: string
  hint?: string
  error?: string
  required?: boolean
}>()

defineEmits<{ (e: 'update:modelValue', v: string): void }>()
</script>

<template>
  <div class="flex w-full flex-col gap-1.5">
    <label v-if="label" class="text-xs font-medium text-fg">
      {{ label }}<span v-if="required" class="text-[color:var(--px-danger-500)]">&nbsp;*</span>
    </label>
    <div class="relative">
    <select
      :value="modelValue ?? ''"
      :disabled="disabled"
      :class="[
        'px-focus-ring w-full appearance-none rounded-md border border-border-strong bg-surface-raised pl-3 pr-8 text-fg transition-colors',
        'hover:border-fg-subtle focus:border-accent disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'h-8 text-[13px]' : size === 'lg' ? 'h-11 text-[15px]' : 'h-9 text-sm'
      ]"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
      <option v-for="opt in options" :key="opt.value" :value="opt.value" :disabled="opt.disabled">{{ opt.label }}</option>
    </select>
    <UIcon name="i-heroicons-chevron-up-down" class="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
    </div>
    <p v-if="error" class="text-xs text-[color:var(--px-danger-600)]">{{ error }}</p>
    <p v-else-if="hint" class="text-xs text-fg-muted">{{ hint }}</p>
  </div>
</template>
