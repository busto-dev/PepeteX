<script setup lang="ts">
const { refresh } = useSession()
await useAsyncData('session', refresh)
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
