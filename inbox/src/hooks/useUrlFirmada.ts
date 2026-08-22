import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

const BUCKET = 'media-whatsapp'
const VALIDEZ = 60 * 60 // 1 hora

/**
 * El bucket de media entrante es PRIVADO: son audios y fotos de clientes y no
 * deben quedar accesibles por URL a cualquiera. Así que no hay URL pública,
 * hay que firmar cada una con la sesión del usuario.
 *
 * Requiere la policy de SELECT sobre storage.objects (03-storage-media.sql).
 * Sin ella Supabase responde "Object not found" aunque el fichero exista:
 * RLS oculta la fila en vez de dar un 403.
 */
export function useUrlFirmada(ruta: string | null | undefined) {
  // Lo que ya es una URL (blob: de un envío optimista, o http de Meta) no
  // se firma: se usa tal cual.
  const esUrl = !!ruta && /^(https?:|blob:|data:)/.test(ruta)

  const q = useQuery({
    enabled: !!ruta && !esUrl,
    queryKey: ['media-firmada', ruta],
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(ruta!, VALIDEZ)
      if (error) {
        throw new Error(
          error.message.includes('not found')
            ? 'No se puede leer el fichero. ¿Falta la policy de Storage? Ver 03-storage-media.sql'
            : error.message,
        )
      }
      return data.signedUrl
    },
    // Se refresca antes de que caduque la firma.
    staleTime: (VALIDEZ - 300) * 1000,
    retry: 1,
  })

  if (esUrl) return { url: ruta as string, cargando: false, error: null as string | null }
  return {
    url: q.data ?? null,
    cargando: q.isPending && !!ruta,
    error: q.error ? String((q.error as Error).message) : null,
  }
}
