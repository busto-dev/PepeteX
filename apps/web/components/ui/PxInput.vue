<script setup lang="ts">
type Size = 'sm' | 'md' | 'lg'

const props = withDefaults(defineProps<{
  modelValue?: string | number | null
  type?: string
  placeholder?: string
  size?: Size
  icon?: string
  trailingIcon?: string
  disabled?: boolean
  invalid?: boolean
  autocomplete?: string
  autofocus?: boolean
  required?: boolean
  id?: string
  name?: string
  label?: string
  hint?: string
  error?: string
}>(), {
  type: 'text',
  size: 'md'
})

const _uid = `px-input-${Math.random().toString(36).slice(2, 9)}`

defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'enter'): void
}>()

const sizeClass: Record<Size, string> = {
  sm: 'h-8 text-[13px]',
  md: 'h-9 text-sm',
  lg: 'h-11 text-[15px]'
}
const padX: Record<Size, string> = {
  sm: 'px-2.5',
  md: 'px-3',
  lg: 'px-3.5'
}
</script>

<template>
  <div class="flex w-full flex-col gap-1.5">
    <label v-if="label" :for="id ?? _uid" class="text-xs font-medium text-fg">
      {{ label }}<span v-if="required" class="text-[color:var(--px-danger-500)]">&nbsp;*</span>
    </label>
    <div class="relative w-full">
    <UIcon
      v-if="icon"
      :name="icon"
      class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
    />
    <input
      :id="id ?? _uid"
      :name="name"
      :type="type"
      :value="modelValue ?? ''"
      :placeholder="placeholder"
      :disabled="disabled"
      :autocomplete="autocomplete"
      :autofocus="autofocus"
      :required="required"
      :aria-invalid="invalid || undefined"
      :class="[
        'px-focus-ring w-full rounded-md border bg-surface-raised text-fg transition-colors',
        'placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:opacity-60',
        sizeClass[size],
        padX[size],
        icon && 'pl-9',
        trailingIcon && 'pr-9',
        invalid ? 'border-[color:var(--px-danger-500)]' : 'border-border-strong hover:border-fg-subtle focus:border-accent'
      ]"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @keydown.enter="$emit('enter')"
    />
    <UIcon
      v-if="trailingIcon"
      :name="trailingIcon"
      class="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
    />
    </div>
    <p v-if="error" class="text-xs text-[color:var(--px-danger-600)]">{{ error }}</p>
    <p v-else-if="hint" class="text-xs text-fg-muted">{{ hint }}</p>
  </div>
</template>
