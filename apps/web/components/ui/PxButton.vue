<script setup lang="ts">
type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'subtle'
type Size = 'xs' | 'sm' | 'md' | 'lg'

const props = withDefaults(defineProps<{
  variant?: Variant
  size?: Size
  loading?: boolean
  disabled?: boolean
  icon?: string
  trailingIcon?: string
  block?: boolean
  type?: 'button' | 'submit' | 'reset'
  to?: string
  href?: string
  square?: boolean
  ariaLabel?: string
}>(), {
  variant: 'secondary',
  size: 'md',
  type: 'button'
})

const emit = defineEmits<{ (e: 'click', ev: MouseEvent): void }>()

const variantClass: Record<Variant, string> = {
  primary: [
    'text-white',
    'bg-[image:var(--px-accent-grad)]',
    'shadow-[0_2px_8px_var(--px-accent-glow)]',
    'hover:brightness-110 hover:shadow-[0_4px_14px_var(--px-accent-glow-strong)]'
  ].join(' '),
  secondary: [
    'bg-surface text-fg',
    'border border-border-strong',
    'shadow-[0_1px_3px_rgba(0,0,0,0.07),0_1px_2px_rgba(0,0,0,0.04)]',
    'hover:bg-surface-raised hover:border-[color:var(--px-border-strong)]'
  ].join(' '),
  ghost: 'bg-transparent text-fg-muted hover:bg-surface-high hover:text-fg',
  outline: 'bg-transparent text-fg border border-border-strong hover:bg-bg-subtle',
  subtle: 'bg-bg-subtle text-fg-muted hover:bg-bg-muted',
  danger: [
    'border border-[color:var(--px-danger-border)]',
    'bg-[color:var(--px-danger-soft)] text-danger',
    'hover:bg-[color:rgba(225,29,72,0.14)]'
  ].join(' ')
}

const sizeClass: Record<Size, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1 rounded-sm',
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  lg: 'h-10 px-4 text-sm gap-2 rounded-lg'
}

const squareSize: Record<Size, string> = {
  xs: 'h-6 w-6 p-0',
  sm: 'h-7 w-7 p-0',
  md: 'h-8 w-8 p-0',
  lg: 'h-10 w-10 p-0'
}

const iconSize: Record<Size, string> = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-4 w-4'
}

const isDisabled = computed(() => props.disabled || props.loading)

const tag = computed(() => props.to ? resolveComponent('NuxtLink') : props.href ? 'a' : 'button')

function onClick(e: MouseEvent) {
  if (isDisabled.value) {
    e.preventDefault()
    return
  }
  emit('click', e)
}
</script>

<template>
  <component
    :is="tag"
    :to="to"
    :href="href"
    :type="!to && !href ? type : undefined"
    :disabled="!to && !href ? isDisabled : undefined"
    :aria-disabled="isDisabled || undefined"
    :aria-label="square ? ariaLabel : undefined"
    :class="[
      'px-focus-ring inline-flex cursor-pointer items-center justify-center font-medium transition-all duration-[120ms] select-none',
      'active:scale-[0.97]',
      'disabled:cursor-not-allowed disabled:opacity-50',
      square ? squareSize[size] : sizeClass[size],
      variantClass[variant],
      block && 'w-full'
    ]"
    @click="onClick"
  >
    <span v-if="loading" :class="['inline-block animate-spin rounded-full border-2 border-current border-t-transparent', iconSize[size]]" />
    <UIcon v-else-if="icon" :name="icon" :class="iconSize[size]" />
    <span v-if="$slots.default && !square" class="whitespace-nowrap"><slot /></span>
    <UIcon v-if="trailingIcon && !loading" :name="trailingIcon" :class="iconSize[size]" />
  </component>
</template>
