<script setup lang="ts">
import type { GenerationTodoItem } from '~/types'

const props = defineProps<{ todos: GenerationTodoItem[] }>()

const completedCount = computed(() => props.todos.filter((todo) => todo.status === 'completed').length)

function todoIcon(status: GenerationTodoItem['status']) {
  if (status === 'completed') return 'i-heroicons-check-circle-solid'
  if (status === 'in_progress') return 'i-heroicons-arrow-path'
  return 'i-heroicons-stop-circle'
}

function todoIconClass(status: GenerationTodoItem['status']) {
  if (status === 'completed') return 'text-emerald-500'
  if (status === 'in_progress') return 'text-primary animate-spin'
  return 'text-fg-subtle'
}

function todoLabel(todo: GenerationTodoItem) {
  return todo.status === 'in_progress' ? todo.activeForm : todo.content
}
</script>

<template>
  <div class="ml-11 rounded-2xl border border-border bg-bg-subtle px-3 py-2.5 text-xs">
    <div class="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-fg-subtle">
      <UIcon name="i-heroicons-list-bullet" class="h-3.5 w-3.5" />
      <span>Task list</span>
      <span class="h-1 w-1 rounded-full bg-current" />
      <span>{{ completedCount }}/{{ todos.length }} done</span>
    </div>
    <ul class="space-y-1.5">
      <li
        v-for="(todo, index) in todos"
        :key="index"
        class="flex items-start gap-2 leading-5"
        :class="todo.status === 'completed' ? 'text-fg-muted' : 'text-fg'"
      >
        <UIcon :name="todoIcon(todo.status)" class="mt-0.5 h-4 w-4 shrink-0" :class="todoIconClass(todo.status)" />
        <span :class="todo.status === 'completed' ? 'line-through opacity-70' : todo.status === 'in_progress' ? 'font-bold' : ''">
          {{ todoLabel(todo) }}
        </span>
      </li>
    </ul>
  </div>
</template>
