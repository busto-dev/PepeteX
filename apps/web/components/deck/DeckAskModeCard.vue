<script setup lang="ts">
import type { GenerationRunSummary, AskOption } from '~/types'

const props = defineProps<{ run: GenerationRunSummary }>()
const emit = defineEmits<{ (e: 'submit', answer: string): void }>()

const options = computed<AskOption[]>(() => {
  if (!props.run.askOptionsJson) return []
  // askOptionsJson may be a pre-parsed array or a JSON string depending on API version
  if (Array.isArray(props.run.askOptionsJson)) return props.run.askOptionsJson as AskOption[]
  try { return JSON.parse(String(props.run.askOptionsJson)) as AskOption[] } catch { return [] }
})

const normalizedOptions = computed(() =>
  options.value.map((option) => ({ ...option, valueAsString: optionAnswer(option) }))
)

const selectedOption = ref<string>('')
const freeText = ref('')
const submitting = ref(false)
const showCustomAnswer = computed(() => props.run.askAllowManualAnswer || normalizedOptions.value.length === 0)

const answer = computed(() =>
  freeText.value.trim() || selectedOption.value
)

watch(() => props.run.id, () => {
  selectedOption.value = ''
  freeText.value = ''
})

function optionAnswer(option: AskOption) {
  const value = option.value

  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value && typeof value === 'object') {
    try { return JSON.stringify(value) } catch {}
  }

  return option.description ? `${option.label}: ${option.description}` : option.label
}

async function submit() {
  if (!answer.value) return
  submitting.value = true
  try {
    emit('submit', answer.value)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-3">
    <p class="text-sm font-semibold text-amber-900">Question from AI</p>
    <p class="text-sm text-amber-800">{{ run.askQuestion }}</p>

    <!-- Options -->
    <div v-if="normalizedOptions.length > 0" class="space-y-1.5">
      <label
        v-for="opt in normalizedOptions"
        :key="opt.valueAsString"
        class="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"
        :class="selectedOption === opt.valueAsString ? 'border-amber-500 bg-amber-50' : ''"
      >
        <input
          type="radio"
          :value="opt.valueAsString"
          v-model="selectedOption"
          class="mt-0.5 h-4 w-4 shrink-0"
        />
        <div>
          <p class="font-medium text-slate-800">{{ opt.label }}</p>
          <p v-if="opt.description" class="text-xs text-slate-500">{{ opt.description }}</p>
        </div>
      </label>
    </div>

    <!-- Free text / custom answer -->
    <textarea
      v-if="showCustomAnswer"
      v-model="freeText"
      rows="2"
      class="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm resize-none"
      :placeholder="normalizedOptions.length > 0 ? 'Or type your own answer…' : 'Type your answer…'"
    />

    <button
      type="button"
      class="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:bg-slate-300"
      :disabled="!answer || submitting"
      @click="submit"
    >{{ submitting ? 'Submitting…' : 'Submit answer' }}</button>
  </div>
</template>
