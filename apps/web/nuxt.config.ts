export default defineNuxtConfig({
  compatibilityDate: '2026-04-24',
  modules: ['@nuxt/ui'],
  components: [
    {
      path: '~/components',
      pathPrefix: false
    }
  ],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  typescript: { strict: true },
  colorMode: { classSuffix: '' },
  app: {
    head: {
      title: 'PepeteX',
      meta: [
        { name: 'description', content: 'AI-powered presentation generator' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' }
      ]
    }
  },
  runtimeConfig: {
    public: {
      appName: 'PepeteX'
    }
  },
  // zod is imported transitively via @mastra/core inside the component-refinement
  // endpoint. Nitro's tracer copies it as a directory symlink which Docker's COPY
  // command does not dereference, leaving a broken reference at runtime. Inlining
  // it bundles zod directly into the Nitro chunks so no external file path is needed.
  nitro: {
    externals: {
      inline: ['zod']
    }
  }
});
