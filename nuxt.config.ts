// @ts-ignore
export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  devtools: { enabled: false }, // Desactivar en producción
  features: {
    devLogs: false, // Reducir logs en producción
  },
  ssr: false,

  css: ["~/assets/css/main.css"],
  modules: [
    "@nuxt/ui",
    "@nuxtjs/tailwindcss",
  ],
  components: [
    {
      path: "~/components",
      pathPrefix: false, // Mejor organización según docs
      extensions: [".vue"], // Limitar a extensiones necesarias
    },
  ],
  postcss: {
    plugins: {
      tailwindcss: {},
      autoprefixer: {},
    },
  },
  runtimeConfig: {
    jwtSecret: process.env.JWT_SECRET,
    geminiApiKey: process.env.GEMINI_API_KEY,
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || "/api",
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_KEY,
    },
  },
  app: {
    head: {
      title: 'TutorVirtual',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' }
      ]
    },
  },
  colorMode: {
    preference: "system",
    fallback: "light",
  },
  vite: {
    optimizeDeps: {
      include: ["vue", "vue-router", "@google/generative-ai", "jwt-decode"],
    },
  },
  experimental: {
    asyncEntry: true, // Habilitar carga async
    componentIslands: true, // Islands architecture
    viewTransition: true,
    renderJsonPayloads: false,
    clientFallback: true,
  },
  nitro: {
    preset: 'vercel',
  },
  typescript: {
    strict: false,
    typeCheck: false,
  },
  build: {
    transpile: ["@google/generative-ai"],
  },
    tailwindcss: {
    configPath: "~/tailwind.config.js",
    exposeConfig: false, // Desactivar si no se necesita
    viewer: false, // Desactivar en producción
  },
});