<script setup lang="ts">
import type { DeckEditableTextField } from '~/lib/deck-content'

const props = defineProps<{
  fields: DeckEditableTextField[]
  selectedFieldId: string | null
  canManage: boolean
  saving: boolean
}>()

const emit = defineEmits<{
  (e: 'update:selectedFieldId', v: string | null): void
  (e: 'save', elementId: string, text: string): void
}>()

const draft = ref('')
const selectedField = computed(() => props.fields.find((field) => field.elementId === props.selectedFieldId) ?? null)
const canSave = computed(() => !!selectedField.value && props.canManage && !props.saving)

watch(
  () => selectedField.value ? `${selectedField.value.elementId}\n${selectedField.value.text}` : '',
  () => { draft.value = selectedField.value?.text ?? '' },
  { immediate: true }
)

function onSave() {
  if (!selectedField.value) return
  emit('save', selectedField.value.elementId, draft.value)
}

const typeLabel: Record<string, string> = { headline: '⬛ Headline', body: '☰ Body', cta: '▷ CTA' }
</script>

<template>
  <div class="space-y-3">
    <div>
      <label class="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Field</label>
      <select
        class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
        :value="selectedFieldId ?? ''"
        :disabled="fields.length === 0"
        @change="emit('update:selectedFieldId', ($event.target as HTMLSelectElement).value || null)"
      >
        <option value="">Select a field</option>
        <option v-for="f in fields" :key="f.elementId" :value="f.elementId">
          {{ typeLabel[f.elementType] ?? f.elementType }} — {{ f.label }}
        </option>
      </select>
    </div>

    <div v-if="selectedField">
      <label class="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Text</label>
      <textarea
        v-model="draft"
        rows="4"
        class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm resize-none"
        :disabled="!canManage"
      />
      <button
        type="button"
        class="mt-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
        :disabled="!canSave"
        @click="onSave"
      >{{ saving ? 'Saving…' : 'Save text' }}</button>
    </div>
    <div v-else-if="selectedFieldId" class="text-sm text-amber-600">
      This element is not editable text. Choose a headline, body, or CTA field.
    </div>
    <div v-else class="text-sm text-slate-400">
      Select a field to edit its text.
    </div>
  </div>
</template>
