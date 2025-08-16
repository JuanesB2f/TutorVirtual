export const config = {
  // Database
  database: {
    url: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL,
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'fallback_secret',
    expiresIn: '1h',
  },

  // AI Services
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
  },

  // External APIs
  news: {
    apiKey: process.env.VITE_NEWS_API_KEY,
  },

  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY,
  },

  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY,
  },

  // App
  app: {
    apiBase: process.env.NUXT_PUBLIC_API_BASE || '/api',
    nodeEnv: process.env.NODE_ENV || 'development',
  },
}

// Validar configuración requerida
export const validateConfig = () => {
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'GEMINI_API_KEY',
  ]

  const missing = required.filter(key => !process.env[key])

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }
}
