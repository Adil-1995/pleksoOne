import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ponerBot } from '@/lib/envio'
import {
  leerEtiquetas, crearEtiqueta, editarEtiqueta, borrarEtiqueta,
  ponerEtiqueta, quitarEtiqueta, contarPorEtiqueta,
  ponerFavorita, ponerSilenciada, ponerFijada, resolverEscalado,
  marcarProducto, quitarProducto, crearCanal, editarCanal,
  leerMarcas, ponerMarca, quitarMarca,
} from '@/lib/conversaciones'
import {
  leerRespuestas, crearRespuesta, editarRespuesta, borrarRespuesta,
  type ImagenRespuesta,
} from '@/lib/respuestas'
import type {
  Canal, Conversacion, Mensaje, Adjunto, Etiqueta, EstadoProducto, MarcaRevision,
  RespuestaRapida,
} from '@/tipos'

export const claves = {
  canales: ['canales'] as const,
  conversaciones: ['conversaciones'] as const,
  etiquetas: ['etiquetas'] as const,
  cuentaEtiquetas: ['etiquetas', 'cuenta'] as const,
  mensajes: (clienteId: string) => ['mensajes', clienteId] as const,
  conversacionesCorruptas: ['conversaciones-corruptas'] as const,
  marcas: ['marcas-revision'] as const,
  respuestas: ['respuestas-rapidas'] as const,
}

// â”€â”€ Canales â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

/** Alta y ediciÃ³n de canales. Sin optimismo: son pocos y poco frecuentes,
 *  y aquÃ­ importa mÃ¡s ver el error exacto que la instantaneidad. */
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

// â”€â”€ Conversaciones â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Fijadas arriba, y dentro de cada grupo por fecha del Ãºltimo mensaje.
 *
 * Se ordena AQUÃ y no con un `.order('fijada')` en la consulta a propÃ³sito:
 * si `fijada` todavÃ­a no existe (06-fijar-y-marcar.sql sin ejecutar),
 * PostgREST devolverÃ­a 42703 y la lista entera se quedarÃ­a en blanco por una
 * columna opcional. En JavaScript, una columna que no existe es `undefined`,
 * cuenta como no fijada, y no pasa nada. Son 500 filas: ordenarlas aquÃ­ no
 * se nota.
 */
/**
 * Por quÃ© una fila NO se puede abrir, o `null` si estÃ¡ sana.
 *
 * El hilo se lee por `cliente_id`: sin Ã©l la conversaciÃ³n sale en la lista
 * y al pincharla no pasa nada. Un hilo que no abre es peor que no verlo,
 * porque parece un fallo del inbox y no un dato roto.
 * Sin `canal_id` tampoco se sabe por quÃ© nÃºmero habrÃ­a que contestar.
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
 * Las etiquetas vienen embebidas por PostgREST a travÃ©s de la tabla puente.
 * Igual que con `adjuntos`: si el esquema de etiquetas todavÃ­a no estÃ¡
 * ejecutado, la consulta entera fallarÃ­a y la lista se quedarÃ­a en blanco por
 * una tabla opcional. Se intenta con etiquetas y se reintenta sin ellas.
 */
/**
 * LAS COLUMNAS QUE PINTA LA LISTA, y ninguna mÃ¡s.
 *
 * Antes era `select('*')` con los embeds enteros. Medido el 8/9/2026 en gzip,
 * que es lo que cuenta el egress:
 *
 *     500 filas con select=* y embeds enteros ..... 153 KB
 *     500 filas con estas columnas ................  45 KB
 *    1000 filas con estas columnas ................  96 KB
 *    4016 filas (TODAS) con estas columnas ........ 325 KB, y 5 peticiones
 *
 * Lo caro nunca fueron las filas: era el `*`.
 *
 * Si aÃ±ades un campo a la fila de la lista, AÃ‘ÃDELO AQUÃ. Si no, llega
 * `undefined` y no da error: se pinta vacÃ­o y nadie se entera.
 *
 * Lo que NO se trae a propÃ³sito, porque no lo lee nadie (comprobado con grep
 * sobre `src/`): telefono, ctwa_clid, ad_id, creado, bloqueada_en,
 * bloqueo_nota y escalada_vista_por.
 */
const COLUMNAS_LISTA = [
  'id', 'cliente_id', 'nombre',
  'ultimo_texto', 'ultimo_en', 'ultimo_del_cliente',
  'no_leidos', 'bot_activo',
  'canal', 'canal_id',
  'favorita', 'fijada', 'silenciada', 'bloqueada',
  'escalada_en', 'escalada_vista_en', 'escalada_motivo',
].join(',')

const SELECT_LISTA =
  COLUMNAS_LISTA + ',etiquetas(id,nombre,color,orden),conversacion_productos(producto,estado)'

/**
 * CuÃ¡ntas conversaciones recientes se traen de una vez.
 *
 * 1000 Y NO MÃS, porque no se puede: PostgREST corta en 1000 filas y da
 * igual lo que pidas â€” sin `limit`, con `limit=5000` o con `Range: 0-4999`
 * devuelve 1000 exactas. Traer las 4016 obliga a paginar de mil en mil, y
 * eso son 5 peticiones y 325 KB por recarga, mÃ¡s del doble que hoy.
 */
const VENTANA = 1000

/**
 * LO QUE NO PUEDE QUEDARSE FUERA POR VIEJO.
 *
 * La ventana ordena por fecha, y eso esconde justo lo que hay que atender:
 * el 8/9/2026 el corte de 1000 caÃ­a en el 5/9, y de los 7 pedidos PENDIENTES
 * solo entraba UNO. Los otros seis eran de agosto â€” el que mÃ¡s tiempo lleva
 * esperando es, por definiciÃ³n, el que mÃ¡s lejos estÃ¡ del corte.
 *
 * AsÃ­ que ademÃ¡s de la ventana se piden SIEMPRE, sin lÃ­mite de fecha, las
 * conversaciones que tienen trabajo pendiente: carrito (pendiente o
 * validado), incidencia abierta, estrella o chincheta. El 8/9 eran 161 + 8,
 * unos 15 KB. Con eso el carrito, el badge de incidencias, favoritos y
 * fijados dejan de mentir, cueste lo que cueste la antigÃ¼edad.
 *
 * Lo que sigue dependiendo de la ventana es encontrar una conversaciÃ³n
 * VIEJA sin nada pendiente. Para eso estÃ¡ el buscador, que pregunta al
 * servidor y no mira solo lo cargado.
 */
async function idsConTrabajo(): Promise<number[]> {
  const { data, error } = await supabase
    .from('conversacion_productos')
    .select('conversacion_id')
    .in('estado', ['pendiente', 'validado'])
  if (error) throw new Error(error.message)
  const ids = new Set<number>()
  for (const f of (data ?? []) as { conversacion_id: number }[]) ids.add(f.conversacion_id)
  return [...ids]
}

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
      const pedir = (select: string) => supabase
        .from('conversaciones')
        .select(select)
        .order('ultimo_en', { ascending: false, nullsFirst: false })
        .limit(VENTANA)

      let select = SELECT_LISTA
      let ventana = await pedir(select)

      if (ventana.error) {
        const esRelacionAusente =
          ventana.error.code === 'PGRST200' ||
          ventana.error.code === 'PGRST205' ||
          /relationship|schema cache/i.test(ventana.error.message)
        if (!esRelacionAusente) throw new Error(ventana.error.message)
        select = COLUMNAS_LISTA
        ventana = await pedir(select)
        if (ventana.error) throw new Error(ventana.error.message)
      }

      const filas = [...((ventana.data ?? []) as unknown as Record<string, unknown>[])]
      const dentro = new Set(filas.map((f) => f.id as number))

      // La cola: lo que tiene trabajo pendiente y se quedÃ³ fuera por viejo.
      // Si esto falla NO se rompe la lista â€”lo que ya hay es correcto, solo
      // que incompletoâ€”, pero se deja dicho en la consola: una lista que
      // miente en silencio es lo que este bloque viene a arreglar.
      try {
        const conCarrito = (await idsConTrabajo()).filter((id) => !dentro.has(id))
        const cola = await supabase
          .from('conversaciones')
          .select(select)
          .or([
            conCarrito.length ? `id.in.(${conCarrito.join(',')})` : null,
            'favorita.is.true', 'fijada.is.true', 'escalada_en.not.is.null',
          ].filter(Boolean).join(','))
        if (cola.error) throw new Error(cola.error.message)
        for (const f of (cola.data ?? []) as unknown as Record<string, unknown>[]) {
          if (!dentro.has(f.id as number)) { dentro.add(f.id as number); filas.push(f) }
        }
      } catch (e) {
        console.error('[lista] no se pudo traer la cola con trabajo pendiente:', e)
      }

      return entregar(filas)
    },

    staleTime: 10_000,
  })
}

/** Las filas apartadas por no poder abrirse. VacÃ­o es lo normal. */
export function useConversacionesCorruptas(): Conversacion[] {
  const { data } = useQuery<Conversacion[]>({
    queryKey: claves.conversacionesCorruptas,
    queryFn: async () => [],
    staleTime: Infinity,
  })
  return data ?? []
}

// â”€â”€ Marca de Â«revisado hasta aquÃ­Â» â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Las marcas puestas ahora mismo, indexadas por conversaciÃ³n.
 *
 * Un Map y no un array porque la lista pregunta Â«Â¿estÃ¡ marcada esta fila?Â»
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
 * conversaciÃ³n se quitan de la cachÃ© las marcas de ESE canal antes de meter
 * la nueva. Si solo se aÃ±adiera, durante el vuelo se verÃ­an dos rayas
 * amarillas y el usuario pensarÃ­a que la regla no funciona â€” cuando en la
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

// â”€â”€ Etiquetas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
 * Cambios optimistas sobre UNA conversaciÃ³n de la lista.
 *
 * Se comparte entre la estrella y el silenciar porque el patrÃ³n es idÃ©ntico:
 * pintar ya, revertir si el servidor dice que no. Con `cancelQueries` antes de
 * tocar la cachÃ© para que un refetch en vuelo no pise el cambio.
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
 * Dar por resuelto el escalado. Mismo patrÃ³n optimista que la estrella.
 *
 * El `valor` que se le pasa es la fecha con la que se PINTA mientras el
 * servidor contesta; la que se guarda de verdad la pone el trigger. Es una
 * diferencia sin consecuencias â€”solo se comparan entre ellas y las dos son
 * de hace un instanteâ€” y el refetch de `onSettled` deja la buena.
 */
export function useResolverEscalado() {
  return useCampoConversacion<string>(
    (clienteId) => resolverEscalado(clienteId),
    'escalada_vista_en',
  )
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

/** Poner o quitar una etiqueta de una conversaciÃ³n, tambiÃ©n optimista. */
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
 *  y aquÃ­ sÃ­ importa mÃ¡s ver el error exacto que la instantaneidad. */
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

// â”€â”€ Mensajes de un hilo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * La tabla `adjuntos` es de la Fase 4 y puede no existir todavÃ­a.
 * Si no estÃ¡, PostgREST devuelve PGRST200 ("no relationship found") y la
 * consulta entera falla â€” el hilo se queda en blanco por una tabla opcional.
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

      // Solo caemos al plan B si el fallo es exactamente ese: la tabla no estÃ¡.
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

// â”€â”€ Pausar / reactivar el bot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Realtime â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Una sola suscripciÃ³n para toda la app.
 *
 * Al llegar un mensaje nuevo se refresca la lista (el trigger de Postgres ya
 * ha puesto al dÃ­a ultimo_texto y no_leidos, asÃ­ que la conversaciÃ³n sube
 * sola al principio) y, si es del hilo abierto, se aÃ±ade sin recargar.
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
              if (lista.some((x) => x.id === m.id)) return lista   // Meta reenvÃ­a: no duplicar
              return [...lista, m]
            })
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mensajes' },
        (payload) => {
          // Cambios de estado: enviado -> entregado -> leÃ­do
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
      // Etiquetar desde otro mÃ³vil tiene que verse aquÃ­ sin recargar. Las dos
      // tablas estÃ¡n en la publicaciÃ³n de Realtime (ver el paso 4 del SQL).
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
      // Las respuestas rÃ¡pidas, por lo mismo que las etiquetas: si creas una
      // en el PC y el mÃ³vil no se entera hasta recargar, escribes Â«/envioÂ» en
      // el mÃ³vil y el desplegable sale vacÃ­o.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'respuestas_rapidas' },
        () => { qc.invalidateQueries({ queryKey: claves.respuestas }) },
      )
      // La marca de Â«revisado hasta aquÃ­Â» es de las que MÃS falta hacen
      // aquÃ­: se pidiÃ³ para verla igual desde el mÃ³vil y desde el PC, y sin
      // esto marcar en uno dejarÃ­a la raya vieja pintada en el otro. Dos
      // rayas amarillas a la vez y la marca deja de ser de fiar.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'marcas_revision' },
        () => { qc.invalidateQueries({ queryKey: claves.marcas }) },
      )
      // Los productos los escribe n8n, no esta app: sin Realtime, un pedido
      // reciÃ©n registrado no se verÃ­a aquÃ­ hasta recargar.
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

// â”€â”€ Respuestas rÃ¡pidas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * La lista entera, cargada de una vez. Son decenas de filas y el filtrado del
 * desplegable se hace en memoria mientras escribes: pedirle a Supabase una
 * consulta por cada tecla serÃ­a mÃ¡s lento y ademÃ¡s parpadearÃ­a.
 */
export function useRespuestas() {
  return useQuery({
    queryKey: claves.respuestas,
    queryFn: leerRespuestas,
    staleTime: 5 * 60_000,   // cambian poco, y Realtime avisa de lo que cambie
  })
}

/**
 * Alta, ediciÃ³n y borrado. Sin optimismo, igual que los canales: son pocas y
 * poco frecuentes, y aquÃ­ importa mÃ¡s ver el error exacto â€”un atajo repetido,
 * por ejemploâ€” que la instantaneidad.
 */
export function useGestionRespuestas() {
  const qc = useQueryClient()
  const refrescar = () => { qc.invalidateQueries({ queryKey: claves.respuestas }) }
  return {
    crear: useMutation({
      mutationFn: ({ atajo, texto, imagen }:
        { atajo: string; texto: string; imagen?: ImagenRespuesta | null }) =>
        crearRespuesta(atajo, texto, imagen),
      onSuccess: refrescar,
    }),
    editar: useMutation({
      mutationFn: ({ id, ...cambios }: { id: number } & Partial<RespuestaRapida>) =>
        editarRespuesta(id, cambios),
      onSuccess: refrescar,
    }),
    // El borrado se lleva por delante tambiÃ©n el fichero del Storage. Sin
    // esto, cada respuesta con imagen que se borrase dejarÃ­a el fichero ahÃ­
    // para siempre, sin fila que lo nombre y sin forma de saber cuÃ¡l era.
    borrar: useMutation({
      mutationFn: ({ id, imagenPath }: { id: number; imagenPath?: string | null }) =>
        borrarRespuesta(id, imagenPath),
      onSuccess: refrescar,
    }),
  }
}
