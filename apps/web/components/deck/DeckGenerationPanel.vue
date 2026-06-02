<script setup lang="ts">
import type { GenerationRunSummary } from '~/types'

const props = defineProps<{
  activeRun: GenerationRunSummary | null
  runHistory: GenerationRunSummary[]
  deckId: string | null
}>()

const emit = defineEmits<{
  (e: 'resumeAsk', runId: string, answer: string): void
  (e: 'cancelRun', runId: string): void
  (e: 'refresh'): void
}>()

const showHistory = ref(false)

const statusColor: Record<string, string> = {
  PENDING: 'bg-slate-200 text-slate-700',
  RUNNING: 'bg-indigo-100 text-indigo-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
  WAITING_ASK: 'bg-amber-100 text-amber-700'
}

function formatDate(v: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v))
}

function formatKind(kind: string) {
  if (kind === 'AGENT_COMMAND') return 'Studio command'
  return kind.replaceAll('_', ' ')
}

const isTerminal = (run: GenerationRunSummary) =>
  ['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)

const isCancellable = (run: GenerationRunSummary) =>
  ['PENDING', 'RUNNING', 'WAITING_ASK'].includes(run.status)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <div>
        <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Generation</p>
        <h3 class="text-base font-black text-slate-950">Run monitor</h3>
      </div>
      <button type="button" class="pepetex-btn-ghost px-3 py-1.5 text-xs" :disabled="!deckId" @click="emit('refresh')">
        Refresh
      </button>
    </div>

    <div v-if="activeRun" class="rounded-[22px] border border-indigo-100 bg-gradient-to-br from-indigo-50 to-cyan-50/60 p-4 shadow-sm">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-black text-slate-950">{{ formatKind(activeRun.kind) }}</p>
          <p class="mt-0.5 text-xs font-medium text-slate-500">Started {{ formatDate(activeRun.createdAt) }}</p>
        </div>
        <span class="rounded-full px-2.5 py-1 text-[11px] font-black" :class="statusColor[activeRun.status] ?? 'bg-slate-100 text-slate-600'">
          {{ activeRun.status.replaceAll('_', ' ') }}
        </span>
      </div>

      <div v-if="isCancellable(activeRun)" class="mt-3 flex justify-end">
        <button type="button" class="pepetex-btn-ghost px-3 py-1.5 text-xs text-red-600 hover:text-red-700" @click="emit('cancelRun', activeRun.id)">
          Stop generation
        </button>
      </div>

      <p v-if="activeRun.errorMessage || activeRun.aiSummary" class="mt-3 rounded-2xl bg-white/75 px-3 py-2 text-xs leading-5 text-slate-600">
        {{ activeRun.errorMessage ?? activeRun.aiSummary }}
      </p>

      <DeckAskModeCard
        v-if="activeRun.status === 'WAITING_ASK' && activeRun.askQuestion"
        class="mt-3"
        :run="activeRun"
        @submit="(answer) => emit('resumeAsk', activeRun!.id, answer)"
      />

      <div v-if="activeRun.status === 'RUNNING' || activeRun.status === 'PENDING'" class="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/80">
        <div class="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-indigo-500" />
      </div>

      <p v-if="isTerminal(activeRun)" class="mt-3 text-xs font-semibold text-slate-500">Open the slide stage to review the generated revision.</p>
    </div>

    <div v-else class="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-center">
      <div class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-indigo-500 shadow-sm">
        <UIcon name="i-heroicons-bolt" class="h-5 w-5" />
      </div>
      <p class="text-sm font-black text-slate-800">No active run</p>
      <p class="mt-1 text-xs leading-5 text-slate-500">Submit a brief below and generation status will appear here.</p>
    </div>

    <div>
      <button
        type="button"
        class="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:border-indigo-200 hover:text-slate-900"
        @click="showHistory = !showHistory"
      >
        <span>Generation history</span>
        <span class="flex items-center gap-1 text-slate-400">
          {{ runHistory.length }}
          <UIcon :name="showHistory ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'" class="h-4 w-4" />
        </span>
      </button>
      <ul v-if="showHistory" class="mt-2 space-y-2">
        <li
          v-for="run in runHistory"
          :key="run.id"
          class="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-xs shadow-sm"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="truncate font-black text-slate-800">{{ formatKind(run.kind) }}</p>
              <p class="text-slate-400">{{ formatDate(run.createdAt) }}</p>
            </div>
            <span class="shrink-0 rounded-full px-2 py-0.5 font-black" :class="statusColor[run.status] ?? 'bg-slate-100 text-slate-600'">
              {{ run.status.replaceAll('_', ' ') }}
            </span>
          </div>
          <p v-if="run.errorMessage || run.aiSummary" class="mt-1 truncate text-slate-500">
            {{ run.errorMessage ?? run.aiSummary }}
          </p>
        </li>
        <li v-if="runHistory.length === 0" class="rounded-2xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">No generation history yet.</li>
      </ul>
    </div>
  </div>
</template>
