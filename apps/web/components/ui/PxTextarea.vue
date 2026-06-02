<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue?: string | null
  placeholder?: string
  rows?: number
  autoresize?: boolean
  disabled?: boolean
  invalid?: boolean
  maxRows?: number
  label?: string
  hint?: string
  error?: string
  required?: boolean
}>(), {
  rows: 3,
  autoresize: false,
  maxRows: 16
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'submit'): void
}>()

const el = ref<HTMLTextAreaElement | null>(null)

function resize() {
  if (!props.autoresize || !el.value) return
  el.value.style.height = 'auto'
  const lineH = parseFloat(getComputedStyle(el.value).lineHeight) || 20
  const max = lineH * props.maxRows
  el.value.style.height = Math.min(el.value.scrollHeight, max) + 'px'
}

watch(() => props.modelValue, () => nextTick(resize))
onMounted(resize)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    emit('submit')
  }
}
</script>

<template>
  <div class="flex w-full flex-col gap-1.5">
    <label v-if="label" class="text-xs font-medium text-fg">
      {{ label }}<span v-if="required" class="text-[color:var(--px-danger-500)]">&nbsp;*</span>
    </label>
    <textarea
      ref="el"
      :value="modelValue ?? ''"
      :placeholder="placeholder"
      :rows="rows"
      :disabled="disabled"
      :aria-invalid="invalid || undefined"
      :class="[
        'px-focus-ring w-full resize-none rounded-md border bg-surface-raised px-3 py-2 text-sm text-fg transition-colors',
        'placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:opacity-60',
        invalid ? 'border-[color:var(--px-danger-500)]' : 'border-border-strong hover:border-fg-subtle focus:border-accent'
      ]"
      @input="(e) => { $emit('update:modelValue', (e.target as HTMLTextAreaElement).value); resize() }"
      @keydown="onKeydown"
    />
    <p v-if="error" class="text-xs text-[color:var(--px-danger-600)]">{{ error }}</p>
    <p v-else-if="hint" class="text-xs text-fg-muted">{{ hint }}</p>
  </div>
</template>
