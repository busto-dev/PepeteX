<script setup lang="ts">
import type { CommentSummary, GenerationRunSummary } from '~/types'

const props = defineProps<{
  deckId: string | null
  slideId: string | null
  selectedElementId?: string | null
  commentMode: boolean
  canManage: boolean
}>()

const emit = defineEmits<{
  (e: 'update:commentMode', v: boolean): void
  (e: 'applied'): void
}>()

const toast = useToast()
const { trackRun } = useGeneration()
const comments = ref<CommentSummary[]>([])
const loading = ref(false)
const newText = ref('')
const submitting = ref(false)
const batchSubmitting = ref(false)
const editingId = ref<string | null>(null)
const editText = ref('')
const loadError = ref<string | null>(null)
const commentTextareaRef = ref<HTMLTextAreaElement | null>(null)

const openComments = computed(() => comments.value.filter(c => c.status === 'OPEN'))

watch([() => props.deckId, () => props.slideId], async () => {
  if (!props.deckId) { comments.value = []; return }
  await load()
}, { immediate: true })

watch(() => props.selectedElementId, () => {
  if (!props.commentMode) return
  void nextTick(() => commentTextareaRef.value?.focus())
})

async function load() {
  if (!props.deckId) return
  loading.value = true
  loadError.value = null
  try {
    const query: Record<string, string> = {}
    if (props.slideId) query.slideId = props.slideId
    const data = await $fetch<{ comments: CommentSummary[] }>(
      `/api/decks/${props.deckId}/comments`,
      { query }
    )
    comments.value = data.comments
  } catch (error) {
    const err = error as { data?: { statusMessage?: string }; message?: string }
    loadError.value = err?.data?.statusMessage ?? err?.message ?? 'Could not load comments.'
  } finally {
    loading.value = false
  }
}

async function addComment() {
  if (!props.deckId || !newText.value.trim()) return
  submitting.value = true
  try {
    await $fetch(`/api/decks/${props.deckId}/comments`, {
      method: 'POST',
      body: {
        text: newText.value.trim(),
        slideId: props.slideId ?? null,
        elementIds: props.selectedElementId ? [props.selectedElementId] : []
      }
    })
    newText.value = ''
    await load()
    toast.add({ title: 'Comment added', color: 'success' })
  } catch (error) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to add comment', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function resolveComment(id: string) {
  if (!props.deckId) return
  try {
    await $fetch(`/api/decks/${props.deckId}/comments/${id}`, {
      method: 'PATCH',
      body: { status: 'RESOLVED' }
    })
    await load()
  } catch {
    toast.add({ title: 'Failed to update comment', color: 'error' })
  }
}

async function deleteComment(id: string) {
  if (!props.deckId) return
  try {
    await $fetch(`/api/decks/${props.deckId}/comments/${id}`, { method: 'DELETE' })
    await load()
  } catch {
    toast.add({ title: 'Failed to delete comment', color: 'error' })
  }
}

async function batchSubmit() {
  if (!props.deckId || openComments.value.length === 0) return
  batchSubmitting.value = true
  const queuedCount = openComments.value.length
  try {
    const data = await $fetch<{ generationRun?: GenerationRunSummary | null }>(`/api/decks/${props.deckId}/comments/submit`, { method: 'POST' })
    if (data.generationRun) {
      trackRun(data.generationRun, (run) => {
        if (run.status === 'COMPLETED') {
          toast.add({ title: 'Comments applied', color: 'success' })
          emit('applied')
          void load()
        } else if (run.status === 'FAILED') {
          toast.add({
            title: 'Could not apply comments',
            description: run.errorMessage ?? 'The comments were returned to open status so you can retry.',
            color: 'error'
          })
          void load()
        }
      })
    }
    toast.add({ title: `${queuedCount} comment(s) queued for AI application`, color: 'success' })
    await load()
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to submit comments', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    batchSubmitting.value = false
  }
}

const statusColor: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-700',
  SUBMITTED: 'bg-blue-100 text-blue-700',
  APPLIED: 'bg-green-100 text-green-700',
  RESOLVED: 'bg-slate-100 text-slate-500',
  REJECTED: 'bg-rose-100 text-rose-600',
}

function formatDate(v: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'short' }).format(new Date(v))
}
</script>

<template>
  <div class="space-y-3">
    <!-- Toggle + batch submit -->
    <div class="flex items-center justify-between gap-2">
      <label class="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          :checked="commentMode"
          class="h-4 w-4 rounded"
          @change="emit('update:commentMode', ($event.target as HTMLInputElement).checked)"
        />
        Click-to-comment mode
      </label>
      <button
        v-if="openComments.length > 0 && canManage"
        type="button"
        class="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        :disabled="batchSubmitting"
        @click="batchSubmit"
      >{{ batchSubmitting ? 'Submitting…' : `Apply ${openComments.length} comment(s)` }}</button>
    </div>

    <!-- Add comment -->
    <div class="space-y-2">
      <p v-if="selectedElementId" class="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700">
        Targeting selected element: {{ selectedElementId }}
      </p>
      <p v-else-if="commentMode" class="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
        Click an element in the slide preview to target the comment, or add a slide-level note.
      </p>
      <textarea
        ref="commentTextareaRef"
        v-model="newText"
        rows="2"
        class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm resize-none"
        placeholder="Add a comment…"
      />
      <button
        type="button"
        class="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300"
        :disabled="submitting || !newText.trim()"
        @click="addComment"
      >{{ submitting ? 'Adding…' : 'Add comment' }}</button>
    </div>

    <!-- List -->
    <div v-if="loading" class="text-sm text-slate-400">Loading…</div>
    <div v-else-if="loadError" class="space-y-2 rounded-xl border border-rose-100 bg-rose-50 px-3 py-3 text-sm text-rose-700">
      <p>{{ loadError }}</p>
      <button type="button" class="text-xs font-black uppercase tracking-[0.14em] text-rose-700 underline" @click="load">Retry</button>
    </div>
    <ul v-else class="space-y-2">
      <li
        v-for="c in comments"
        :key="c.id"
        class="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm"
      >
        <div class="flex items-start justify-between gap-2">
          <p class="text-slate-800">{{ c.text }}</p>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" :class="statusColor[c.status] ?? 'bg-slate-100'">{{ c.status }}</span>
        </div>
          <p class="mt-1 text-xs text-slate-400">{{ c.author.name ?? c.author.email }} · {{ formatDate(c.createdAt) }}</p>
        <div v-if="c.status === 'OPEN' && canManage" class="mt-1.5 flex gap-2">
          <button
            type="button"
            class="text-xs font-medium text-slate-500 hover:text-slate-800"
            @click="resolveComment(c.id)"
          >Resolve</button>
          <button
            type="button"
            class="text-xs font-medium text-rose-500 hover:text-rose-700"
            @click="deleteComment(c.id)"
          >Delete</button>
        </div>
      </li>
      <li v-if="comments.length === 0" class="text-sm text-slate-400">No comments yet.</li>
    </ul>
  </div>
</template>
