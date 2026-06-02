<script setup lang="ts">
type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'
type Variant = 'soft' | 'solid' | 'outline'

withDefaults(defineProps<{
  tone?: Tone
  variant?: Variant
  size?: 'xs' | 'sm'
  icon?: string
}>(), {
  tone: 'neutral',
  variant: 'soft',
  size: 'sm'
})

const toneSoft: Record<Tone, string> = {
  neutral: 'border border-border bg-surface-high text-fg-muted',
  accent: 'border border-[color:var(--px-accent-border)] bg-accent-soft text-accent',
  success: 'border border-[color:var(--px-success-border)] bg-[color:var(--px-success-soft)] text-[color:var(--px-success-500)]',
  warning: 'border border-[color:var(--px-warning-border)] bg-[color:var(--px-warning-soft)] text-[color:var(--px-warning-500)]',
  danger: 'border border-[color:var(--px-danger-border)] bg-[color:var(--px-danger-soft)] text-[color:var(--px-danger-500)]',
  info: 'border border-[color:var(--px-info-border)] bg-[color:var(--px-info-soft)] text-[color:var(--px-info-500)]'
}
const toneSolid: Record<Tone, string> = {
  neutral: 'bg-fg text-bg',
  accent: 'bg-accent text-white',
  success: 'bg-[color:var(--px-success-500)] text-white',
  warning: 'bg-[color:var(--px-warning-500)] text-white',
  danger: 'bg-[color:var(--px-danger-500)] text-white',
  info: 'bg-[color:var(--px-info-500)] text-white'
}
const toneOutline: Record<Tone, string> = {
  neutral: 'border border-border-strong text-fg',
  accent: 'border border-accent text-accent',
  success: 'border border-[color:var(--px-success-500)] text-[color:var(--px-success-500)]',
  warning: 'border border-[color:var(--px-warning-500)] text-[color:var(--px-warning-500)]',
  danger: 'border border-[color:var(--px-danger-500)] text-[color:var(--px-danger-500)]',
  info: 'border border-[color:var(--px-info-500)] text-[color:var(--px-info-500)]'
}

const sizeClass = { xs: 'text-[10px] px-1.5 py-0.5', sm: 'text-[11px] px-2 py-0.5' }
</script>

<template>
  <span
    :class="[
      'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap',
      sizeClass[size],
      variant === 'soft' && toneSoft[tone],
      variant === 'solid' && toneSolid[tone],
      variant === 'outline' && toneOutline[tone]
    ]"
  >
    <UIcon v-if="icon" :name="icon" class="h-3 w-3" />
    <slot />
  </span>
</template>
