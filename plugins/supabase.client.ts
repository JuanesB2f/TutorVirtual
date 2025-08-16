export default defineNuxtPlugin(() => {
  // Solo cargar Supabase en el cliente
  if (process.client) {
    // Aquí puedes inicializar Supabase si es necesario
    console.log('Supabase client plugin loaded')
  }
})
