import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ponerBot } from '@/lib/envio'
import {
  leerEtiquetas, crearEtiqueta, editarEtiqueta, borrarEtiqueta,
  ponerEtiqueta, quitarEtiqueta, contarPorEtiqueta,
  ponerFavorita, ponerSilenciada, ponerFijada,
  marcarProducto, quitarProducto, crearCanal, editarCanal,
  leerMarcas, ponerMarca, quitarMarca,
} from '@/lib/conversaciones'
import type { Canal, Conversacion, Mensaje, Adjunto, Etiqueta, EstadoProducto, MarcaRevision } from '@/tipos'

export const claves = {
  canales: ['canales'] as const,
  conversaciones: ['conversaciones'] as const,
  etiquetas: ['etiquetas'] as const,
  cuentaEtiquetas: ['etiquetas', 'cuenta'] as const,
  mensajes: (clienteId: string) => ['mensajes', clienteId] as const,
  conversacionesCorruptas: ['conversaciones-corruptas'] as const,
  marcas: ['marcas-revision'] as const,
}

// ── Canales ──────────────────────────────────────────────────────────────
export function useCanales() {
  return useQuery({
    queryKey: claves.canales,
    queryFn: async (): Promise<Canal[]> => {
      const { data, error } = await supabase.from('canales').select('*').order('id')
      // La tabla es de la Fase 4 y puede no existir. Sin ella la app funciona
      // en modo degradado (ver el puente LEGADO en lib/canales.ts), asi que
      // NO se propaga el error: se devuelve vacio.
      if (error) {
        if (error.code === 'PGRST205' || /schema cache/i.test(error.message)) return []
        throw new Error(error.message)
      }
      return data ?? []
    },
    staleTime: 30 * 60_000, // los canales no cambian cada minuto
  })
}

/** Alta y edición de canales. Sin optimismo: son pocos y poco frecuentes,
 *  y aquí importa más ver el error exacto que la instantaneidad. */
export function useGestionCanales() {
  const qc = useQueryClient()
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: claves.canales })
    qc.invalidateQueries({ queryKey: claves.conversaciones })
  }
  return {
    crear: useMutation({ mutationFn: crearCanal, onSuccess: refrescar }),
    editar: useMutation({
      mutationFn: ({ id, ...cambios }: { id: number } & Partial<Canal>) => editarCanal(id, cambios),
      onSuccess: refrescar,
    }),
  }
}

// ── Conversaciones ───────────────────────────────────────────────────────
/**
 * Fijadas arriba, y dentro de cada grupo por fecha del último mensaje.
 *
 * Se ordena AQUÍ y no con un `.order('fijada')` en la consulta a propósito:
 * si `fijada` todavía no existe (06-fijar-y-marcar.sql sin ejecutar),
 * PostgREST devolvería 42703 y la lista entera se quedaría en blanco por una
 * columna opcional. En JavaScript, una columna que no existe es `undefined`,
 * cuenta como no fijada, y no pasa nada. Son 500 filas: ordenarlas aquí no
 * se nota.
 */
/**
 * Por qué una fila NO se puede abrir, o `null` si está sana.
 *
 * El hilo se lee por `cliente_id`: sin él la conversación sale en la lista
 * y al pincharla no pasa nada. Un hilo que no abre es peor que no verlo,
 * porque parece un fallo del inbox y no un dato roto.
 * Sin `canal_id` tampoco se sabe por qué número habría que contestar.
 */
export function motivoCorrupta(c: Conversacion): string | null {
  if (!String(c.cliente_id ?? '').trim()) return 'sin cliente_id'
  if (c.canal_id == null) return 'sin canal'
  return null
}

/**
 * Las corruptas se APARTAN, no se esconden: salen de la lista para que no
 * haya hilos muertos, y se cuentan aparte para que se vean. Un hueco se
 * investiga; una fila desaparecida en silencio, no.
 */
function separar(filas: unknown): { validas: Conversacion[]; corruptas: Conversacion[] } {
  const lista = (filas ?? []) as unknown as Conversacion[]
  const validas: Conversacion[] = []
  const corruptas: Conversacion[] = []
  for (const c of lista) (motivoCorrupta(c) ? corruptas : validas).push(c)
  validas.sort((a, b) => {
    if (!!a.fijada !== !!b.fijada) return a.fijada ? -1 : 1
    return (b.ultimo_en ?? '').localeCompare(a.ultimo_en ?? '')
  })
  return { validas, corruptas }
}

/**
 * Las etiquetas vienen embebidas por PostgREST a través de la tabla puente.
 * Igual que con `adjuntos`: si el esquema de etiquetas todavía no está
 * ejecutado, la consulta entera fallaría y la lista se quedaría en blanco por
 * una tabla opcional. Se intenta con etiquetas y se reintenta sin ellas.
 */
export function useConversaciones() {
  const qc = useQueryClient()
  const entregar = (filas: unknown): Conversacion[] => {
    const { validas, corruptas } = separar(filas)
    qc.setQueryData(claves.conversacionesCorruptas, corruptas)
    return validas
  }
  return useQuery({
    queryKey: claves.conversaciones,
    queryFn: async (): Promise<Conversacion[]> => {
      const conEtiquetas = await supabase
        .from('conversaciones')
        .select('*, etiquetas(*), conversacion_productos(*)')
        .order('ultimo_en', { ascending: false, nullsFirst: false })
        .limit(500)

      if (!conEtiquetas.error) return entregar(conEtiquetas.data)

      const esRelacionAusente =
        conEtiquetas.error.code === 'PGRST200' ||
        conEtiquetas.error.code === 'PGRST205' ||
        /relationship|schema cache/i.test(conEtiquetas.error.message)
      if (!esRelacionAusente) throw new Error(conEtiquetas.error.message)

      const sin = await supabase
        .from('conversaciones')
        .select('*')
        .order('ultimo_en', { ascending: false, nullsFirst: false })
        .limit(500)
      if (sin.error) throw new Error(sin.error.message)
      return entregar(sin.data)
    },

    staleTime: 10_000,
  })
}

/** Las filas apartadas por no poder abrirse. Vacío es lo normal. */
export function useConversacionesCorruptas(): Conversacion[] {
  const { data } = useQuery<Conversacion[]>({
    queryKey: claves.conversacionesCorruptas,
    queryFn: async () => [],
    staleTime: Infinity,
  })
  return data ?? []
}

// ── Marca de «revisado hasta aquí» ───────────────────────────────────────
/**
 * Las marcas puestas ahora mismo, indexadas por conversación.
 *
 * Un Map y no un array porque la lista pregunta «¿está marcada esta fila?»
 * 341 veces por pintado. Son como mucho dos entradas.
 */
export function useMarcas() {
  const { data } = useQuery({
    queryKey: claves.marcas,
    queryFn: leerMarcas,
    staleTime: 60_000,
  })
  return useMemo(() => {
    const m = new Map<number, MarcaRevision>()
    for (const x of data ?? []) m.set(x.conversacion_id, x)
    return m
  }, [data])
}

/**
 * Poner o quitar la marca. Optimista, como todo lo que se toca con el dedo.
 *
 * El optimismo tiene que reproducir la regla de la base: al marcar una
 * conversación se quitan de la caché las marcas de ESE canal antes de meter
 * la nueva. Si solo se añadiera, durante el vuelo se verían dos rayas
 * amarillas y el usuario pensaría que la regla no funciona — cuando en la
 * base nunca ha llegado a haber dos.
 */
export function usePonerMarca() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ canalId, conversacionId }:
      { canalId: number; conversacionId: number | null }) =>
      conversacionId === null ? quitarMarca(canalId) : ponerMarca(canalId, conversacionId),
    onMutate: async ({ canalId, conversacionId }) => {
      await qc.cancelQueries({ queryKey: claves.marcas })
      const antes = qc.getQueryData<MarcaRevision[]>(claves.marcas)
      qc.setQueryData<MarcaRevision[]>(claves.marcas, (v) => {
        const otros = (v ?? []).filter((m) => m.canal_id !== canalId)
        if (conversacionId === null) return otros
        return [...otros, {
          canal_id: canalId, conversacion_id: conversacionId,
          marcado_por: null, marcado_en: new Date().toISOString(),
        }]
      })
      return { antes }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.antes) qc.setQueryData(claves.marcas, ctx.antes)
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: claves.marcas }) },
  })
}

// ── Etiquetas ────────────────────────────────────────────────────────────
export function useEtiquetas() {
  return useQuery({
    queryKey: claves.etiquetas,
    queryFn: leerEtiquetas,
    staleTime: 5 * 60_000,   // cambian poco
  })
}

export function useContarEtiquetas() {
  return useQuery({
    queryKey: claves.cuentaEtiquetas,
    queryFn: contarPorEtiqueta,
    staleTime: 60_000,
  })
}

/**
 * Cambios optimistas sobre UNA conversación de la lista.
 *
 * Se comparte entre la estrella y el silenciar porque el patrón es idéntico:
 * pintar ya, revertir si el servidor dice que no. Con `cancelQueries` antes de
 * tocar la caché para que un refetch en vuelo no pise el cambio.
 */
function useCampoConversacion<T>(
  aplicar: (clienteId: string, valor: T) => Promise<void>,
  campo: keyof Conversacion,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ clienteId, valor }: { clienteId: string; valor: T }) =>
      aplicar(clienteId, valor),
    onMutate: async ({ clienteId, valor }) => {
      await qc.cancelQueries({ queryKey: claves.conversaciones })
      const antes = qc.getQueryData<Conversacion[]>(claves.conversaciones)
      qc.setQueryData<Conversacion[]>(claves.conversaciones, (v) =>
        (v ?? []).map((c) => (c.cliente_id === clienteId ? { ...c, [campo]: valor } : c)),
      )
      return { antes }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.antes) qc.setQueryData(claves.conversaciones, ctx.antes)
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: claves.conversaciones }) },
  })
}

export function usePonerFavorita() {
  return useCampoConversacion<boolean>(ponerFavorita, 'favorita')
}

export function usePonerSilenciada() {
  return useCampoConversacion<boolean>(ponerSilenciada, 'silenciada')
}

export function usePonerFijada() {
  return useCampoConversacion<boolean>(ponerFijada, 'fijada')
}

/**
 * Marcar o desmarcar un producto a mano. Optimista, como todo lo que se
 * toca con el dedo: pinta ya y revierte si el servidor dice que no.
 */
export function useMarcarProducto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ conversacionId, producto, estado }:
      { conversacionId: number; producto: string; estado: EstadoProducto | null }) =>
      estado === null
        ? quitarProducto(conversacionId, producto)
        : marcarProducto(conversacionId, producto, estado),
    onMutate: async ({ conversacionId, producto, estado }) => {
      await qc.cancelQueries({ queryKey: claves.conversaciones })
      const antes = qc.getQueryData<Conversacion[]>(claves.conversaciones)
      qc.setQueryData<Conversacion[]>(claves.conversaciones, (v) =>
        (v ?? []).map((c) => {
          if (c.id !== conversacionId) return c
          const actuales = c.conversacion_productos ?? []
          if (estado === null) {
            return { ...c, conversacion_productos: actuales.filter((p) => p.producto !== producto) }
          }
          const existe = actuales.some((p) => p.producto === producto)
          return {
            ...c,
            conversacion_productos: existe
              ? actuales.map((p) => (p.producto === producto ? { ...p, estado } : p))
              : [...actuales, {
                  id: -Date.now(), conversacion_id: conversacionId, producto, estado,
                  creado: new Date().toISOString(), actualizado: new Date().toISOString(),
                  marcado_por: null, marcado_en: new Date().toISOString(),
                  validado_por: null,
                  validado_en: estado === 'validado' ? new Date().toISOString() : null,
                }],
          }
        }),
      )
      return { antes }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.antes) qc.setQueryData(claves.conversaciones, ctx.antes)
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: claves.conversaciones }) },
  })
}

/** Poner o quitar una etiqueta de una conversación, también optimista. */
export function useEtiquetarConversacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ conversacionId, etiqueta, poner }:
      { conversacionId: number; etiqueta: Etiqueta; poner: boolean }) =>
      poner ? ponerEtiqueta(conversacionId, etiqueta.id)
            : quitarEtiqueta(conversacionId, etiqueta.id),
    onMutate: async ({ conversacionId, etiqueta, poner }) => {
      await qc.cancelQueries({ queryKey: claves.conversaciones })
      const antes = qc.getQueryData<Conversacion[]>(claves.conversaciones)
      qc.setQueryData<Conversacion[]>(claves.conversaciones, (v) =>
        (v ?? []).map((c) => {
          if (c.id !== conversacionId) return c
          const actuales = c.etiquetas ?? []
          return {
            ...c,
            etiquetas: poner
              ? (actuales.some((e) => e.id === etiqueta.id) ? actuales : [...actuales, etiqueta])
              : actuales.filter((e) => e.id !== etiqueta.id),
          }
        }),
      )
      return { antes }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.antes) qc.setQueryData(claves.conversaciones, ctx.antes)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: claves.conversaciones })
      qc.invalidateQueries({ queryKey: claves.cuentaEtiquetas })
    },
  })
}

/** Crear, renombrar, recolorear y borrar. Sin optimismo: son poco frecuentes
 *  y aquí sí importa más ver el error exacto que la instantaneidad. */
export function useGestionEtiquetas() {
  const qc = useQueryClient()
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: claves.etiquetas })
    qc.invalidateQueries({ queryKey: claves.conversaciones })
    qc.invalidateQueries({ queryKey: claves.cuentaEtiquetas })
  }
  return {
    crear: useMutation({
      mutationFn: ({ nombre, color }: { nombre: string; color: string }) => crearEtiqueta(nombre, color),
      onSuccess: refrescar,
    }),
    editar: useMutation({
      mutationFn: ({ id, ...cambios }: { id: number; nombre?: string; color?: string; orden?: number }) =>
        editarEtiqueta(id, cambios),
      onSuccess: refrescar,
    }),
    borrar: useMutation({
      mutationFn: (id: number) => borrarEtiqueta(id),
      onSuccess: refrescar,
    }),
  }
}

// ── Mensajes de un hilo ──────────────────────────────────────────────────
/**
 * La tabla `adjuntos` es de la Fase 4 y puede no existir todavía.
 * Si no está, PostgREST devuelve PGRST200 ("no relationship found") y la
 * consulta entera falla — el hilo se queda en blanco por una tabla opcional.
 * Se intenta con adjuntos y se reintenta sin ellos.
 */
export function useMensajes(clienteId: string | undefined) {
  return useQuery({
    enabled: !!clienteId,
    queryKey: claves.mensajes(clienteId ?? ''),
    queryFn: async (): Promise<Mensaje[]> => {
      const conAdjuntos = await supabase
        .from('mensajes')
        .select('*, adjuntos(*)')
        .eq('cliente_id', clienteId!)
        .order('creado', { ascending: true })
        .limit(500)

      if (!conAdjuntos.error) return (conAdjuntos.data ?? []) as unknown as Mensaje[]

      // Solo caemos al plan B si el fallo es exactamente ese: la tabla no está.
      const esRelacionAusente =
        conAdjuntos.error.code === 'PGRST200' ||
        conAdjuntos.error.code === 'PGRST205' ||
        /relationship|schema cache/i.test(conAdjuntos.error.message)

      if (!esRelacionAusente) throw new Error(conAdjuntos.error.message)

      const sinAdjuntos = await supabase
        .from('mensajes')
        .select('*')
        .eq('cliente_id', clienteId!)
        .order('creado', { ascending: true })
        .limit(500)

      if (sinAdjuntos.error) throw new Error(sinAdjuntos.error.message)
      return (sinAdjuntos.data ?? []) as unknown as Mensaje[]
    },
    staleTime: 5_000,
  })
}

// ── Pausar / reactivar el bot ────────────────────────────────────────────
export function usePonerBot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ clienteId, activo }: { clienteId: string; activo: boolean }) =>
      ponerBot(clienteId, activo),

    // Optimista: el interruptor tiene que responder al instante.
    onMutate: async ({ clienteId, activo }) => {
      await qc.cancelQueries({ queryKey: claves.conversaciones })
      const antes = qc.getQueryData<Conversacion[]>(claves.conversaciones)
      qc.setQueryData<Conversacion[]>(claves.conversaciones, (v) =>
        (v ?? []).map((c) => (c.cliente_id === clienteId ? { ...c, bot_activo: activo } : c)),
      )
      return { antes }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.antes) qc.setQueryData(claves.conversaciones, ctx.antes)
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: claves.conversaciones }) },
  })
}

// ── Realtime ─────────────────────────────────────────────────────────────
/**
 * Una sola suscripción para toda la app.
 *
 * Al llegar un mensaje nuevo se refresca la lista (el trigger de Postgres ya
 * ha puesto al día ultimo_texto y no_leidos, así que la conversación sube
 * sola al principio) y, si es del hilo abierto, se añade sin recargar.
 */
export function useRealtime(clienteAbierto?: string) {
  const qc = useQueryClient()

  useEffect(() => {
    const canal = supabase
      .channel('inbox')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mensajes' },
        (payload) => {
          const m = payload.new as Mensaje
          qc.invalidateQueries({ queryKey: claves.conversaciones })
          if (m.cliente_id === clienteAbierto) {
            qc.setQueryData<Mensaje[]>(claves.mensajes(m.cliente_id), (v) => {
              const lista = v ?? []
              if (lista.some((x) => x.id === m.id)) return lista   // Meta reenvía: no duplicar
              return [...lista, m]
            })
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mensajes' },
        (payload) => {
          // Cambios de estado: enviado -> entregado -> leído
          const m = payload.new as Mensaje
          qc.setQueryData<Mensaje[]>(claves.mensajes(m.cliente_id), (v) =>
            (v ?? []).map((x) => (x.id === m.id ? { ...x, ...m } : x)),
          )
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversaciones' },
        () => { qc.invalidateQueries({ queryKey: claves.conversaciones }) },
      )
      // Etiquetar desde otro móvil tiene que verse aquí sin recargar. Las dos
      // tablas están en la publicación de Realtime (ver el paso 4 del SQL).
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'etiquetas' },
        () => {
          qc.invalidateQueries({ queryKey: claves.etiquetas })
          qc.invalidateQueries({ queryKey: claves.conversaciones })
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'canales' },
        () => { qc.invalidateQueries({ queryKey: claves.canales }) },
      )
      // La marca de «revisado hasta aquí» es de las que MÁS falta hacen
      // aquí: se pidió para verla igual desde el móvil y desde el PC, y sin
      // esto marcar en uno dejaría la raya vieja pintada en el otro. Dos
      // rayas amarillas a la vez y la marca deja de ser de fiar.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'marcas_revision' },
        () => { qc.invalidateQueries({ queryKey: claves.marcas }) },
      )
      // Los productos los escribe n8n, no esta app: sin Realtime, un pedido
      // recién registrado no se vería aquí hasta recargar.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversacion_productos' },
        () => { qc.invalidateQueries({ queryKey: claves.conversaciones }) },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversacion_etiquetas' },
        () => {
          qc.invalidateQueries({ queryKey: claves.conversaciones })
          qc.invalidateQueries({ queryKey: claves.cuentaEtiquetas })
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'adjuntos' },
        (payload) => {
          const a = payload.new as Adjunto
          if (!clienteAbierto) return
          qc.setQueryData<Mensaje[]>(claves.mensajes(clienteAbierto), (v) =>
            (v ?? []).map((m) =>
              m.id === a.mensaje_id ? { ...m, adjuntos: [...(m.adjuntos ?? []), a] } : m,
            ),
          )
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(canal) }
  }, [qc, clienteAbierto])
}
