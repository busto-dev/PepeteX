<script setup lang="ts">
import type { DeckRevisionSummary } from '~/types'

const props = defineProps<{
  revisions: DeckRevisionSummary[]
  currentRevisionNumber: number
  canManage: boolean
}>()

const emit = defineEmits<{ (e: 'restore', revisionId: string): void }>()

const toast = useToast()
const restoringId = ref<string | null>(null)

const sourceLabel: Record<string, string> = {
  INITIAL: 'Initial',
  MANUAL_TEXT_EDIT: 'Text edit',
  SLIDE_DUPLICATED: 'Slide duplicated',
  SLIDE_REORDERED: 'Reordered',
  SLIDE_DELETED: 'Slide deleted',
  REVISION_RESTORED: 'Restored',
  GENERATION_COMPLETED: 'Generated'
}

async function restore(rev: DeckRevisionSummary) {
  if (!props.canManage) return
  restoringId.value = rev.id
  try {
    emit('restore', rev.id)
  } finally {
    restoringId.value = null
  }
}

function formatDate(v: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v))
}
</script>

<template>
  <div class="space-y-2">
    <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Revision History</p>

    <ul class="space-y-2">
      <li
        v-for="rev in revisions"
        :key="rev.id"
        class="flex items-start justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
        :class="rev.revisionNumber === currentRevisionNumber ? 'border-slate-900 bg-white' : ''"
      >
        <div>
          <p class="font-medium text-slate-800">
            #{{ rev.revisionNumber }}
            <span class="ml-1 text-xs font-normal text-slate-500">{{ sourceLabel[rev.source] ?? rev.source }}</span>
            <span v-if="rev.revisionNumber === currentRevisionNumber" class="ml-1.5 rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">Current</span>
          </p>
          <p class="text-xs text-slate-400">{{ rev.slideCount }} slides · {{ formatDate(rev.createdAt) }}</p>
          <p v-if="rev.summary" class="text-xs text-slate-500 mt-0.5 max-w-xs truncate">{{ rev.summary }}</p>
        </div>
        <button
          v-if="canManage && rev.revisionNumber !== currentRevisionNumber"
          type="button"
          class="shrink-0 rounded-xl border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          :disabled="restoringId === rev.id"
          @click="restore(rev)"
        >{{ restoringId === rev.id ? '…' : 'Restore' }}</button>
      </li>
      <li v-if="revisions.length === 0" class="text-sm text-slate-400">No revisions yet.</li>
    </ul>
  </div>
</template>
