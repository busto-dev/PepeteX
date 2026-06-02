<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

import {
  buildSlidePreviewDocument,
  isPreviewRuntimeMessage,
  type PreviewCommandMessage,
  type PreviewIssue,
  type PreviewSlideDocument,
  type PreviewSlideValidationState
} from '~/lib/slide-preview';

const props = withDefaults(
  defineProps<{
    slide: PreviewSlideDocument;
    validation?: PreviewSlideValidationState;
    allowedAssetHosts?: string[];
    assetUrls?: Record<string, string>;
    fontFaces?: Array<{ id?: string; fontFamily: string; fontAliases?: string[]; mimeType: string; dataUrl: string; fontWeight?: number | string | null; fontStyle?: string | null }>;
    title?: string;
    commentMode?: boolean;
    interactionMode?: 'none' | 'comment' | 'edit';
    selectedElementId?: string | null;
  }>(),
  {
    validation: () => ({
      severity: 'ok',
      errors: [],
      warnings: []
    }),
    allowedAssetHosts: () => [],
    assetUrls: () => ({}),
    fontFaces: () => [],
    commentMode: false,
    interactionMode: 'none',
    selectedElementId: null
  }
);

const emit = defineEmits<{
  elementClick: [{ elementId: string; elementType: string | undefined }];
}>();

const iframeRef = ref<HTMLIFrameElement | null>(null);
const runtimeState = ref<'booting' | 'ready' | 'error'>('booting');
const iframeLoaded = ref(false);
const runtimeReady = ref(false);
const pendingInteractionCommand = shallowRef<PreviewCommandMessage | null>(null);
const latestInteractionCommand = shallowRef<PreviewCommandMessage | null>(null);
const interactionRetryTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const interactionRetryCount = ref(0);
const runtimeWatchdogTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const runtimeWatchdogRetryCount = ref(0);
const frameResetCounter = ref(0);
const renderErrors = ref<PreviewIssue[]>([]);
const consoleErrors = ref<PreviewIssue[]>([]);
const consoleWarnings = ref<PreviewIssue[]>([]);
const renderedElementCount = ref(0);

const maxInteractionCommandRetries = 8;
const maxRuntimeWatchdogRetries = 1;
const runtimeWatchdogDelayMs = 1200;

const previewDocument = computed(() =>
  buildSlidePreviewDocument({
    slide: props.slide,
    validation: props.validation,
    allowedAssetHosts: props.allowedAssetHosts,
    assetUrls: props.assetUrls,
    fontFaces: props.fontFaces
  })
);

const previewFrameKey = computed(() => `${previewDocument.value.channel}:${frameResetCounter.value}`);

const effectiveInteractionMode = computed<'none' | 'comment' | 'edit'>(() =>
  props.commentMode ? 'comment' : props.interactionMode
);

const validationTone = computed(() => {
  switch (previewDocument.value.validation.severity) {
    case 'ok':
      return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';
    case 'warning':
      return 'border-amber-400/30 bg-amber-400/10 text-amber-100';
    case 'repair_required':
      return 'border-orange-400/30 bg-orange-400/10 text-orange-100';
    case 'blocked':
      return 'border-rose-400/30 bg-rose-400/10 text-rose-100';
  }
});

const validationLabel = computed(() => {
  switch (previewDocument.value.validation.severity) {
    case 'ok':
      return 'Contract clean';
    case 'warning':
      return 'Contract warnings';
    case 'repair_required':
      return 'Repair required';
    case 'blocked':
      return 'Blocked by contract';
  }
});

const runtimeTone = computed(() => {
  switch (runtimeState.value) {
    case 'booting':
      return 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100';
    case 'ready':
      return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';
    case 'error':
      return 'border-rose-400/30 bg-rose-400/10 text-rose-100';
  }
});

const runtimeLabel = computed(() => {
  switch (runtimeState.value) {
    case 'booting':
      return 'Preview booting';
    case 'ready':
      return 'Preview ready';
    case 'error':
      return 'Runtime issues';
  }
});

const validationIssues = computed(() => [
  ...previewDocument.value.validation.errors,
  ...previewDocument.value.validation.warnings
]);

watch(
  () => previewDocument.value.channel,
  () => {
    resetRuntimeState();
    scheduleRuntimeWatchdog();
    queueInteractionCommand();
  },
  {
    flush: 'post'
  }
);

watch(
  [effectiveInteractionMode, () => props.selectedElementId],
  () => {
    queueInteractionCommand();
  },
  {
    immediate: true,
    flush: 'post'
  }
);

onMounted(() => {
  window.addEventListener('message', handleMessage);
  scheduleRuntimeWatchdog();
});

onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage);
  clearInteractionCommandRetry();
  clearRuntimeWatchdog();
});

function buildInteractionCommand(): PreviewCommandMessage {
  return {
    source: 'pepetex-parent',
    channel: previewDocument.value.channel,
    command: 'setInteractionMode',
    mode: effectiveInteractionMode.value,
    selectedElementId: props.selectedElementId ?? null
  };
}

function queueInteractionCommand() {
  const command = buildInteractionCommand();
  latestInteractionCommand.value = command;
  pendingInteractionCommand.value = command;
  interactionRetryCount.value = 0;
  flushPendingInteractionCommand();
  scheduleInteractionCommandRetry();
}

function flushPendingInteractionCommand() {
  if (!pendingInteractionCommand.value) return;

  if (postInteractionCommand(pendingInteractionCommand.value)) {
    pendingInteractionCommand.value = null;
  }
}

function postInteractionCommand(command: PreviewCommandMessage) {
  if (!iframeLoaded.value) return false;

  const frameWindow = iframeRef.value?.contentWindow;
  if (!frameWindow) return false;

  frameWindow.postMessage(
    {
      source: command.source,
      channel: command.channel,
      command: command.command,
      mode: command.mode,
      selectedElementId: command.selectedElementId ?? null
    },
    '*'
  );
  return true;
}

function scheduleInteractionCommandRetry() {
  clearInteractionCommandRetry();

  if (!iframeLoaded.value || runtimeReady.value || !latestInteractionCommand.value) return;

  interactionRetryTimer.value = setTimeout(() => {
    if (runtimeReady.value || !latestInteractionCommand.value) return;

    interactionRetryCount.value += 1;
    postInteractionCommand(latestInteractionCommand.value);

    if (interactionRetryCount.value < maxInteractionCommandRetries) {
      scheduleInteractionCommandRetry();
    }
  }, 80);
}

function clearInteractionCommandRetry() {
  if (!interactionRetryTimer.value) return;
  clearTimeout(interactionRetryTimer.value);
  interactionRetryTimer.value = null;
}

function scheduleRuntimeWatchdog() {
  clearRuntimeWatchdog();

  runtimeWatchdogTimer.value = setTimeout(() => {
    if (runtimeReady.value) return;

    if (runtimeWatchdogRetryCount.value < maxRuntimeWatchdogRetries) {
      runtimeWatchdogRetryCount.value += 1;
      iframeLoaded.value = false;
      frameResetCounter.value += 1;
      scheduleRuntimeWatchdog();
      return;
    }

    runtimeState.value = 'error';
    renderErrors.value = [
      ...renderErrors.value,
      {
        code: 'PREVIEW_TIMEOUT',
        message: 'Preview runtime did not report ready.'
      }
    ];
  }, runtimeWatchdogDelayMs);
}

function clearRuntimeWatchdog() {
  if (!runtimeWatchdogTimer.value) return;
  clearTimeout(runtimeWatchdogTimer.value);
  runtimeWatchdogTimer.value = null;
}

function handleIframeLoad() {
  iframeLoaded.value = true;
  queueInteractionCommand();
}

function handleMessage(event: MessageEvent) {
  const frameWindow = iframeRef.value?.contentWindow;

  if (!frameWindow || event.source !== frameWindow) {
    return;
  }

  if (!isPreviewRuntimeMessage(event.data)) {
    return;
  }

  if (event.data.channel !== previewDocument.value.channel) {
    return;
  }

  switch (event.data.type) {
    case 'ready':
      runtimeState.value = renderErrors.value.length > 0 ? 'error' : 'ready';
      iframeLoaded.value = true;
      runtimeReady.value = true;
      clearRuntimeWatchdog();
      clearInteractionCommandRetry();
      renderedElementCount.value = event.data.elementCount ?? 0;
      queueInteractionCommand();
      return;
    case 'element-click':
      if (event.data.elementId) {
        emit('elementClick', {
          elementId: event.data.elementId,
          elementType: event.data.elementType
        });
      }
      return;
    case 'render-error':
      runtimeState.value = 'error';
      clearRuntimeWatchdog();
      renderErrors.value = [
        ...renderErrors.value,
        {
          code: 'RENDER_ERROR',
          message: event.data.message ?? 'Preview rendering failed.',
          detail: event.data.detail
        }
      ];
      return;
    case 'console-error':
      runtimeState.value = 'error';
      consoleErrors.value = [
        ...consoleErrors.value,
        {
          code: 'CONSOLE_ERROR',
          message: event.data.message ?? 'Preview console.error call captured.'
        }
      ];
      return;
    case 'console-warn':
      consoleWarnings.value = [
        ...consoleWarnings.value,
        {
          code: 'CONSOLE_WARN',
          message: event.data.message ?? 'Preview console.warn call captured.'
        }
      ];
  }
}

function resetRuntimeState() {
  runtimeState.value = 'booting';
  iframeLoaded.value = false;
  runtimeReady.value = false;
  runtimeWatchdogRetryCount.value = 0;
  clearInteractionCommandRetry();
  clearRuntimeWatchdog();
  latestInteractionCommand.value = null;
  pendingInteractionCommand.value = null;
  interactionRetryCount.value = 0;
  renderErrors.value = [];
  consoleErrors.value = [];
  consoleWarnings.value = [];
  renderedElementCount.value = 0;
}
</script>

<template>
  <iframe
    :key="previewFrameKey"
    ref="iframeRef"
    :srcdoc="previewDocument.srcdoc"
    :sandbox="previewDocument.sandbox"
    :title="`${slide.title} preview`"
    class="block h-full w-full border-0 bg-white"
    @load="handleIframeLoad"
  />
</template>
