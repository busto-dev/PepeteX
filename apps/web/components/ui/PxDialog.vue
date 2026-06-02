<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean
  title?: string
  description?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'close'): void
}>()

const sizeClass = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl'
}

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.modelValue) close()
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 bg-[color:var(--px-neutral-1000)]/40 backdrop-blur-sm"
        @click="close"
      />
    </Transition>
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2 scale-[0.98]"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0 translate-y-1 scale-[0.98]"
    >
      <div v-if="modelValue" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center" @click.self="close">
        <div
          role="dialog"
          aria-modal="true"
          :class="['w-full rounded-2xl border border-border bg-surface shadow-xl', sizeClass[size ?? 'md']]"
        >
          <div v-if="title || $slots.header" class="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div class="min-w-0">
              <slot name="header">
                <h2 class="text-base font-semibold text-fg">{{ title }}</h2>
                <p v-if="description" class="mt-1 text-sm text-fg-muted">{{ description }}</p>
              </slot>
            </div>
            <button
              type="button"
              class="rounded-md p-1 text-fg-subtle transition-colors hover:bg-bg-subtle hover:text-fg"
              aria-label="Close"
              @click="close"
            >
              <UIcon name="i-heroicons-x-mark" class="h-4 w-4" />
            </button>
          </div>
          <div class="px-5 py-4">
            <slot />
          </div>
          <div v-if="$slots.footer" class="flex items-center justify-end gap-2 border-t border-border bg-bg-subtle px-5 py-3 rounded-b-2xl">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
