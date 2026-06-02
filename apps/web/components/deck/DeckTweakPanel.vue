<script setup lang="ts">
import type { GenerationRunSummary } from '~/types'
import { TWEAK_CATEGORY_DEFINITIONS } from '~/lib/tweak-definitions'

const props = defineProps<{
  deckId: string | null
  canManage: boolean
}>()

const emit = defineEmits<{ (e: 'applied'): void }>()

const toast = useToast()
const { trackRun } = useGeneration()
const tweaks = ref<Record<string, string>>({})
const saving = ref(false)

function onSelect(key: string, value: string) {
  tweaks.value = { ...tweaks.value, [key]: value }
}

function clearKey(key: string) {
  const next = { ...tweaks.value }
  delete next[key]
  tweaks.value = next
}

const selectedCount = computed(() => Object.keys(tweaks.value).length)

async function applyTweaks() {
  if (!props.deckId || selectedCount.value === 0) return
  saving.value = true
  try {
    for (const [category, value] of Object.entries(tweaks.value)) {
      await $fetch(`/api/decks/${props.deckId}/tweaks`, {
        method: 'POST',
        body: { scope: 'DECK', category, value }
      })
    }
    const data = await $fetch<{ generationRun?: GenerationRunSummary | null }>(`/api/decks/${props.deckId}/tweaks/submit`, { method: 'POST' })
    tweaks.value = {}
    if (data.generationRun) {
      trackRun(data.generationRun, (run) => {
        if (run.status === 'COMPLETED') {
          emit('applied')
          toast.add({ title: 'Tweaks applied', description: 'The deck design has been updated.', color: 'success' })
        }
      })
    }
    toast.add({ title: 'Tweaks queued', description: 'AI is applying the selected tweaks.', color: 'success' })
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to apply tweaks', description: err?.data?.statusMessage ?? 'Unknown error', color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Visual Tweaks</p>

    <div class="space-y-2">
      <div v-for="cat in TWEAK_CATEGORY_DEFINITIONS" :key="cat.key">
        <label class="mb-1 block text-xs font-medium text-slate-600">{{ cat.label }}</label>
        <div class="flex gap-1 flex-wrap">
          <button
            v-for="opt in cat.options"
            :key="opt"
            type="button"
            class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
            :class="tweaks[cat.key] === opt
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'"
            @click="tweaks[cat.key] === opt ? clearKey(cat.key) : onSelect(cat.key, opt)"
          >{{ opt }}</button>
        </div>
      </div>
    </div>

    <button
      type="button"
      class="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-300"
      :disabled="!canManage || saving || selectedCount === 0 || !deckId"
      @click="applyTweaks"
    >
      {{ saving ? 'Applying…' : `Apply ${selectedCount > 0 ? selectedCount + ' ' : ''}tweak${selectedCount !== 1 ? 's' : ''}` }}
    </button>
  </div>
</template>
