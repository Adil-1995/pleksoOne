import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anon) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. ' +
    'Copia .env.example a .env.local y rellénalas.',
  )
}

// Guardarraíl: la service_role se salta RLS. Si alguien la pega aquí por
// error, la app entera queda abierta al mundo. Mejor no arrancar.
if (anon.startsWith('sb_secret_') || anon.includes('service_role')) {
  throw new Error(
    'Eso parece la service_role, no la anon key. NUNCA la pongas en el frontend: ' +
    'se salta RLS y queda visible para cualquiera que abra el inspector.',
  )
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Sin detección por URL: usamos rutas hash y en Capacitor no hay redirect web.
    detectSessionInUrl: false,
  },
  realtime: { params: { eventsPerSecond: 10 } },
})

/** URL pública de un fichero del Storage a partir de su storage_path. */
export function urlPublica(bucket: string, ruta: string): string {
  return supabase.storage.from(bucket).getPublicUrl(ruta).data.publicUrl
}
