<script setup lang="ts">
import type { DeckSummary } from '~/types'

const props = defineProps<{
  decks: DeckSummary[]
  selectedDeckId: string | null
  loading: boolean
  workspaces?: Array<{ id: string; name: string }>
}>()

const emit = defineEmits<{
  (e: 'select', deckId: string): void
  (e: 'create'): void
  (e: 'rename', deckId: string, currentTitle: string): void
  (e: 'delete', deckId: string): void
  (e: 'fork', deckId: string, targetWorkspaceId: string): void
  (e: 'move', deckId: string, targetWorkspaceId: string): void
}>()

const contextDeckId = ref<string | null>(null)
const contextX = ref(0)
const contextY = ref(0)
const showContext = ref(false)
const showForkModal = ref(false)
const showMoveModal = ref(false)
const actionTargetDeckId = ref<string | null>(null)
const selectedTargetWorkspaceId = ref<string | null>(null)

function openContext(e: MouseEvent, deckId: string) {
  e.preventDefault()
  contextDeckId.value = deckId
  contextX.value = e.clientX
  contextY.value = e.clientY
  showContext.value = true
}

function closeContext() { showContext.value = false }

function startFork(deckId: string) {
  actionTargetDeckId.value = deckId
  selectedTargetWorkspaceId.value = props.workspaces?.[0]?.id ?? null
  showForkModal.value = true
  closeContext()
}

function startMove(deckId: string) {
  actionTargetDeckId.value = deckId
  selectedTargetWorkspaceId.value = props.workspaces?.[0]?.id ?? null
  showMoveModal.value = true
  closeContext()
}

function confirmFork() {
  if (actionTargetDeckId.value && selectedTargetWorkspaceId.value)
    emit('fork', actionTargetDeckId.value, selectedTargetWorkspaceId.value)
  showForkModal.value = false
}

function confirmMove() {
  if (actionTargetDeckId.value && selectedTargetWorkspaceId.value)
    emit('move', actionTargetDeckId.value, selectedTargetWorkspaceId.value)
  showMoveModal.value = false
}

function formatDate(v: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'short' }).format(new Date(v))
}
</script>

<template>
  <div class="space-y-2" @click="closeContext">
    <div class="flex items-center justify-between">
      <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Decks</p>
      <button
        type="button"
        class="rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800"
        @click="emit('create')"
      >+ New</button>
    </div>

    <div v-if="loading" class="text-sm text-slate-400">Loading…</div>
    <div v-else-if="decks.length === 0" class="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-400">
      No decks yet. Create one!
    </div>
    <ul v-else class="space-y-1">
      <li
        v-for="d in decks"
        :key="d.id"
        class="group flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors"
        :class="d.id === selectedDeckId ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-700'"
        @click="emit('select', d.id)"
        @contextmenu="openContext($event, d.id)"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium">{{ d.title }}</p>
          <p class="text-xs" :class="d.id === selectedDeckId ? 'text-slate-300' : 'text-slate-400'">
            {{ d.slideCount }} slides · {{ formatDate(d.updatedAt) }}
          </p>
        </div>
        <div class="hidden shrink-0 items-center gap-1 group-hover:flex" @click.stop>
          <button
            class="rounded p-1 text-xs hover:bg-slate-200/60"
            :class="d.id === selectedDeckId ? 'text-slate-200 hover:bg-slate-700' : 'text-slate-500'"
            @click="emit('rename', d.id, d.title)"
          >✎</button>
          <button
            class="rounded p-1 text-xs text-slate-500 hover:bg-slate-200/60"
            title="More actions"
            @click.stop="openContext($event, d.id)"
          >⋯</button>
          <button
            class="rounded p-1 text-xs hover:bg-rose-100 text-rose-500"
            @click="emit('delete', d.id)"
          >✕</button>
        </div>
      </li>
    </ul>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="showContext"
        class="fixed z-50 min-w-40 rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        :style="{ top: `${contextY}px`, left: `${contextX}px` }"
        @click.stop
      >
        <button type="button" class="w-full px-4 py-2 text-left text-sm hover:bg-slate-50" @click="startFork(contextDeckId!)">Fork to workspace…</button>
        <button type="button" class="w-full px-4 py-2 text-left text-sm hover:bg-slate-50" @click="startMove(contextDeckId!)">Move to workspace…</button>
        <hr class="my-1 border-slate-100" />
        <button type="button" class="w-full px-4 py-2 text-left text-sm text-slate-500 hover:bg-slate-50" @click="closeContext">Cancel</button>
      </div>
    </Teleport>

    <!-- Fork modal -->
    <Teleport to="body">
      <div v-if="showForkModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @click.self="showForkModal = false">
        <div class="w-96 rounded-2xl bg-white p-6 shadow-xl space-y-4">
          <h3 class="text-lg font-semibold">Fork deck to workspace</h3>
          <select v-model="selectedTargetWorkspaceId" class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
            <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">{{ ws.name }}</option>
          </select>
          <div class="flex justify-end gap-3">
            <button type="button" class="rounded-xl border border-slate-200 px-4 py-2 text-sm" @click="showForkModal = false">Cancel</button>
            <button type="button" class="rounded-xl bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700" @click="confirmFork">Fork</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Move modal -->
    <Teleport to="body">
      <div v-if="showMoveModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @click.self="showMoveModal = false">
        <div class="w-96 rounded-2xl bg-white p-6 shadow-xl space-y-4">
          <h3 class="text-lg font-semibold">Move deck to workspace</h3>
          <select v-model="selectedTargetWorkspaceId" class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
            <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">{{ ws.name }}</option>
          </select>
          <div class="flex justify-end gap-3">
            <button type="button" class="rounded-xl border border-slate-200 px-4 py-2 text-sm" @click="showMoveModal = false">Cancel</button>
            <button type="button" class="rounded-xl bg-amber-500 px-4 py-2 text-sm text-white hover:bg-amber-600" @click="confirmMove">Move</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
