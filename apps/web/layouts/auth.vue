<template>
  <div class="grid min-h-screen grid-cols-1 bg-bg lg:grid-cols-2">
    <!-- Marketing pane -->
    <div class="relative hidden overflow-hidden border-r border-border bg-surface-sunken lg:block">
      <div class="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
      <div class="absolute -top-40 -right-20 h-80 w-80 rounded-full bg-accent/5 blur-3xl" />
      <div class="relative flex h-full flex-col p-12">
        <div class="flex items-center gap-2.5">
          <span class="flex h-8 w-8 items-center justify-center rounded-md bg-fg text-xs font-bold text-bg">P</span>
          <span class="text-sm font-semibold tracking-tight text-fg">PepeteX</span>
        </div>
        <div class="mt-auto space-y-6">
          <h2 class="max-w-md text-3xl font-semibold leading-tight tracking-tight text-fg">
            Beautiful, accurate decks. <br />Generated with care.
          </h2>
          <p class="max-w-md text-sm leading-relaxed text-fg-muted">
            Chat with PepeteX, attach references, pick a design system, and export production-ready PowerPoint. Built for teams that ship.
          </p>
          <div class="flex items-center gap-2 text-xs text-fg-subtle">
            <span class="inline-flex h-1.5 w-1.5 rounded-full bg-[color:var(--px-success-500)]" />
            Self-hosted · End-to-end encrypted credentials
          </div>
        </div>
      </div>
    </div>

    <!-- Form pane -->
    <div class="flex min-h-screen items-center justify-center px-6 py-12">
      <div class="w-full max-w-sm">
        <div class="mb-8 flex items-center gap-2.5 lg:hidden">
          <span class="flex h-8 w-8 items-center justify-center rounded-md bg-fg text-xs font-bold text-bg">P</span>
          <span class="text-sm font-semibold tracking-tight text-fg">PepeteX</span>
        </div>
        <slot />
      </div>
    </div>
  </div>
</template>

