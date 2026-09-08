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
/**
 * El orden de la lista: fijadas arriba, y dentro de cada grupo por fecha.
 *
 * Está aquí suelto porque lo usan DOS caminos: la carga inicial y el parcheo
 * de Realtime. Si el parcheo no volviera a ordenar, una conversación que
 * recibe un mensaje se quedaría donde estaba en vez de subir al principio —
 * y eso es de las cosas que no se notan hasta que se te pasa un cliente.
 */
export function ordenarLista(lista: Conversacion[]): Conversacion[] {
  return lista.slice().sort((a, b) => {
    if (!!a.fijada !== !!b.fijada) return a.fijada ? -1 : 1
    return (b.ultimo_en ?? '').localeCompare(a.ultimo_en ?? '')
  })
}

/**
 * Mete en la lista la fila que acaba de llegar por Realtime.
 *
 * Devuelve la lista nueva, o `null` si NO se puede parchear con garantías —
 * y entonces quien llama recarga, que es el comportamiento de siempre.
 *
 * Está fuera del hook para poder probarla: es el sitio donde un fallo no se
 * vería hasta que a alguien se le pasa un cliente.
 */
export function parchearConversacion(
  lista: Conversacion[] | undefined,
  fila: Partial<Conversacion> | undefined,
): Conversacion[] | null {
  if (!lista || !fila || fila.id == null) return null
  const i = lista.findIndex((c) => c.id === fila.id)
  if (i < 0) return null                    // no está: que recargue y entre
  const copia = lista.slice()
  // MEZCLA, no sustitución: el evento trae las columnas de la tabla y no los
  // embeds. Sustituir borraría el carrito y las etiquetas de esa fila.
  copia[i] = { ...copia[i], ...fila }
  return ordenarLista(copia)
}

function separar(filas: unknown): { validas: Conversacion[]; corruptas: Conversacion[] } {
  const lista = (filas ?? []) as unknown as Conversacion[]
  const validas: Conversacion[] = []
  const corruptas: Conversacion[] = []
  for (const c of lista) (motivoCorrupta(c) ? corruptas : validas).push(c)
  return { validas: ordenarLista(validas), corruptas }
}

/**
 * Las etiquetas vienen embebidas por PostgREST a través de la tabla puente.
 * Igual que con `adjuntos`: si el esquema de etiquetas todavía no está
 * ejecutado, la consulta entera fallaría y la lista se quedaría en blanco por
 * una tabla opcional. Se intenta con etiquetas y se reintenta sin ellas.
 */
/**
 * LAS COLUMNAS QUE PINTA LA LISTA, y ninguna más.
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
 * Si añades un campo a la fila de la lista, AÑÁDELO AQUÍ. Si no, llega
 * `undefined` y no da error: se pinta vacío y nadie se entera.
 *
 * Lo que NO se trae a propósito, porque no lo lee nadie (comprobado con grep
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

/**
 * `actualizado` va aquí porque `productosDe` ordena por él. Se quedó fuera al
 * estrechar el select y tumbó la app en producción el 8/9/2026: llegaba
 * `undefined` y el sort reventaba, pero solo en las conversaciones con dos o
 * más productos —con una, el comparador ni se llama—, así que pasó las
 * pruebas y se cayó con datos reales.
 *
 * REGLA: antes de quitar un campo de aquí, búscalo en `src/`. Lo que falte
 * no da error de compilación ni de red: llega `undefined` y revienta donde
 * se use, o peor, se pinta vacío.
 */
const SELECT_LISTA =
  COLUMNAS_LISTA +
  ',etiquetas(id,nombre,color,orden),conversacion_productos(producto,estado,actualizado)'

/**
 * Cuántas conversaciones recientes se traen de una vez.
 *
 * 1000 Y NO MÁS, porque no se puede: PostgREST corta en 1000 filas y da
 * igual lo que pidas — sin `limit`, con `limit=5000` o con `Range: 0-4999`
 * devuelve 1000 exactas. Traer las 4016 obliga a paginar de mil en mil, y
 * eso son 5 peticiones y 325 KB por recarga, más del doble que hoy.
 */
const VENTANA = 1000

/**
 * LO QUE NO PUEDE QUEDARSE FUERA POR VIEJO.
 *
 * La ventana ordena por fecha, y eso esconde justo lo que hay que atender:
 * el 8/9/2026 el corte de 1000 caía en el 5/9, y de los 7 pedidos PENDIENTES
 * solo entraba UNO. Los otros seis eran de agosto — el que más tiempo lleva
 * esperando es, por definición, el que más lejos está del corte.
 *
 * Así que además de la ventana se piden SIEMPRE, sin límite de fecha, las
 * conversaciones que tienen trabajo pendiente: carrito (pendiente o
 * validado), incidencia abierta, estrella o chincheta. El 8/9 eran 161 + 8,
 * unos 15 KB. Con eso el carrito, el badge de incidencias, favoritos y
 * fijados dejan de mentir, cueste lo que cueste la antigüedad.
 *
 * Lo que sigue dependiendo de la ventana es encontrar una conversación
 * VIEJA sin nada pendiente. Para eso está el buscador, que pregunta al
 * servidor y no mira solo lo cargado.
 */
/** El fallo de PostgREST cuando el embed no existe todavía en el esquema. */
function esRelacionAusente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST200' || error.code === 'PGRST205' ||
    /relationship|schema cache/i.test(error.message ?? '')
}

/**
 * LAS RESCATADAS: las que se abrieron desde el buscador y no estaban cargadas.
 *
 * El buscador pregunta al SERVIDOR y alcanza los 16 000 mensajes, pero la
 * lista solo tiene las 1000 más recientes más la cola con trabajo. Así que un
 * resultado podía apuntar a una conversación que no estaba en memoria, y al
 * pulsarlo la pantalla se quedaba en «Elige una conversación».
 *
 * Medido el 8/9/2026 contra la base. De 4118 conversaciones que hay, la lista
 * tenía 1122: las 2996 restantes NO se podían abrir desde un resultado.
 * Buscando «Chiapas» salían 16 conversaciones y SIETE eran de esas — otras
 * cuatro caían fuera de la ventana pero entraban igual por la cola, porque
 * tenían el carrito validado.
 *
 * Los términos comunes no fallaban NUNCA: sus 50 coincidencias más nuevas son
 * todas recientes, y lo reciente sí está cargado. Por eso no salió antes, y
 * por eso el fallo era peor de lo que parecía: falla justo con lo raro, que
 * es exactamente para lo que se usa un buscador.
 *
 * Se arregla METIENDO LA FILA EN LA LISTA DE VERDAD, no con un estado
 * paralelo. Todo lo que ya funciona —las mutaciones optimistas, el realtime,
 * el orden, la cabecera— trabaja sobre `claves.conversaciones` buscando por
 * `id` o `cliente_id`; una conversación que viviera fuera de ese array se
 * abriría pero no se actualizaría, y una pausa o una etiqueta se perderían en
 * silencio. Dentro del array no hay ningún camino nuevo que mantener.
 *
 * Y se apuntan aquí para que SOBREVIVAN A UNA RECARGA de la lista: si no, la
 * siguiente invalidación reconstruye el array desde el servidor sin ella y la
 * conversación desaparecería de debajo de quien la está leyendo.
 *
 * El tope de 25 evita que el filtro crezca sin fin en una sesión larga. Se va
 * la más antigua, que es la que menos probable es que sigas mirando.
 */
const RESCATADAS = new Set<string>()
const TOPE_RESCATADAS = 25

export function apuntarRescatada(clienteId: string) {
  RESCATADAS.delete(clienteId)
  RESCATADAS.add(clienteId)
  while (RESCATADAS.size > TOPE_RESCATADAS) {
    RESCATADAS.delete(RESCATADAS.values().next().value as string)
  }
}

/** Solo para las pruebas y para leerlo desde fuera sin poder tocarlo. */
export function rescatadas(): string[] { return [...RESCATADAS] }
export function _olvidarRescatadas() { RESCATADAS.clear() }

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
        if (!esRelacionAusente(ventana.error)) throw new Error(ventana.error.message)
        select = COLUMNAS_LISTA
        ventana = await pedir(select)
        if (ventana.error) throw new Error(ventana.error.message)
      }

      const filas = [...((ventana.data ?? []) as unknown as Record<string, unknown>[])]
      const dentro = new Set(filas.map((f) => f.id as number))

      // La cola: lo que tiene trabajo pendiente y se quedó fuera por viejo.
      // Si esto falla NO se rompe la lista —lo que ya hay es correcto, solo
      // que incompleto—, pero se deja dicho en la consola: una lista que
      // miente en silencio es lo que este bloque viene a arreglar.
      try {
        const conCarrito = (await idsConTrabajo()).filter((id) => !dentro.has(id))
        const cola = await supabase
          .from('conversaciones')
          .select(select)
          .or([
            conCarrito.length ? `id.in.(${conCarrito.join(',')})` : null,
            RESCATADAS.size ? `cliente_id.in.(${[...RESCATADAS].join(',')})` : null,
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

/**
 * ABRIR UNA CONVERSACIÓN QUE NO ESTÁ EN LA LISTA.
 *
 * Se dispara solo cuando hace falta: si la conversación de la URL ya está
 * cargada —el caso normal, y el de todas las que se abren pulsando en la
 * lista— esto no pide nada. Solo pregunta cuando has llegado por el buscador
 * o por un enlace directo a una conversación vieja.
 *
 * Cuesta UNA fila, no una página: ~1 KB frente a los 96 KB de la ventana. Y
 * se queda cacheada para siempre (`staleTime: Infinity`), porque en cuanto
 * entra en la lista es esa lista la que manda; volver a pedirla sería pagar
 * dos veces por el mismo dato.
 *
 * Devuelve en qué punto está para poder decirlo en pantalla. Un hueco mudo es
 * lo que teníamos, y es justo lo que hay que quitar: quien pulsa un resultado
 * tiene que ver que se está abriendo, o que no se pudo.
 */
export function useRescatarConversacion(
  clienteId: string | undefined,
  conversaciones: Conversacion[] | undefined,
) {
  const qc = useQueryClient()
  // `conversaciones` en `undefined` es «todavía no ha cargado la lista», no
  // «no está». Sin esta distinción se pediría en cada arranque, antes de
  // saber siquiera si hacía falta.
  const falta = !!clienteId && !!conversaciones &&
    !conversaciones.some((c) => c.cliente_id === clienteId)

  const q = useQuery({
    queryKey: ['conversacion-rescatada', clienteId],
    enabled: falta,
    staleTime: Infinity,
    queryFn: async (): Promise<Conversacion | null> => {
      const pedir = (select: string) => supabase
        .from('conversaciones').select(select).eq('cliente_id', clienteId!).limit(1)
      let r = await pedir(SELECT_LISTA)
      if (r.error && esRelacionAusente(r.error)) r = await pedir(COLUMNAS_LISTA)
      if (r.error) throw new Error(r.error.message)
      const filas = (r.data ?? []) as unknown as Record<string, unknown>[]
      if (!filas.length) return null
      // Por el MISMO filtro que la lista: una fila corrupta no puede colarse
      // por esta puerta de atrás y reventar el hilo.
      const { validas } = separar(filas)
      return validas[0] ?? null
    },
  })

  const fila = q.data ?? null
  useEffect(() => {
    if (!fila) return
    apuntarRescatada(fila.cliente_id)
    qc.setQueryData<Conversacion[]>(claves.conversaciones, (v) => {
      if (!v) return v
      if (v.some((c) => c.id === fila.id)) return v
      return ordenarLista([...v, fila])
    })
  }, [fila, qc])

  // Los dos estados TIENEN que excluirse. Mirando `fila === null` en los
  // dos, una conversación que no existe daba «Abriendo…» para siempre: la
  // consulta ya había terminado y el hueco seguía diciendo que iba a llegar.
  // Se distingue por la consulta, no por el dato: en vuelo, o terminada.
  return {
    rescatando: falta && q.isPending,
    noSePudo: falta && (q.isError || (q.isSuccess && fila === null)),
  }
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
 * Dar por resuelto el escalado. Mismo patrón optimista que la estrella.
 *
 * El `valor` que se le pasa es la fecha con la que se PINTA mientras el
 * servidor contesta; la que se guarda de verdad la pone el trigger. Es una
 * diferencia sin consecuencias —solo se comparan entre ellas y las dos son
 * de hace un instante— y el refetch de `onSettled` deja la buena.
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
          // AQUÍ YA NO SE RECARGA LA LISTA.
          //
          // El trigger `tocar_conversacion` (01-esquema-inbox.sql) actualiza
          // `conversaciones` con cada mensaje que entra —ultimo_texto,
          // ultimo_en y no_leidos—, y ese UPDATE llega por Realtime al
          // manejador de más abajo, que parchea la fila. Recargar aquí era
          // pedir otra vez las mil conversaciones por cada mensaje.
          //
          // Comprobado el 8/9/2026 contra la base: `conversaciones` está en
          // la publicación de Realtime y el evento llega — se cambió un
          // nombre desde el servidor y el inbox se enteró sin recargar.
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
      /**
       * LA FILA SE PARCHEA, NO SE RECARGA LA LISTA ENTERA.
       *
       * Era el mayor gasto de egress del inbox: cada mensaje dispara este
       * evento (por el trigger) y antes cada uno pedía otra vez las mil
       * conversaciones. El evento YA TRAE la fila nueva, así que no hace
       * falta preguntar nada.
       *
       * TRES COSAS QUE NO PUEDEN FALLAR, y cómo se sostienen:
       *
       *  · SE MEZCLA, no se sustituye. El evento trae las columnas de la
       *    TABLA y no los embeds: sustituir la fila borraría de ella el
       *    carrito y las etiquetas. Con `{...vieja, ...nueva}` se quedan.
       *
       *  · SE VUELVE A ORDENAR. Si no, la conversación que acaba de recibir
       *    un mensaje no sube al principio: se queda donde estaba con el
       *    texto nuevo, que es peor que no actualizarla.
       *
       *  · SI NO SE PUEDE PARCHEAR, SE RECARGA. Fila que no está en la
       *    lista (conversación nueva, o que entra ahora en la ventana),
       *    DELETE, evento sin `id`, o lista todavía sin cargar: se cae al
       *    invalidate de siempre. El repliegue es EXACTAMENTE el
       *    comportamiento de antes, así que lo peor que puede pasar es no
       *    ahorrar — nunca enseñar algo desfasado.
       */
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversaciones' },
        (payload) => {
          const fila = payload.new as Partial<Conversacion> | undefined
          const lista = qc.getQueryData<Conversacion[]>(claves.conversaciones)
          const parcheada = payload.eventType === 'DELETE'
            ? null
            : parchearConversacion(lista, fila)

          if (!parcheada) { qc.invalidateQueries({ queryKey: claves.conversaciones }); return }
          qc.setQueryData<Conversacion[]>(claves.conversaciones, parcheada)
        },
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
      // Las respuestas rápidas, por lo mismo que las etiquetas: si creas una
      // en el PC y el móvil no se entera hasta recargar, escribes «/envio» en
      // el móvil y el desplegable sale vacío.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'respuestas_rapidas' },
        () => { qc.invalidateQueries({ queryKey: claves.respuestas }) },
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

// ── Respuestas rápidas ───────────────────────────────────────────────────
/**
 * La lista entera, cargada de una vez. Son decenas de filas y el filtrado del
 * desplegable se hace en memoria mientras escribes: pedirle a Supabase una
 * consulta por cada tecla sería más lento y además parpadearía.
 */
export function useRespuestas() {
  return useQuery({
    queryKey: claves.respuestas,
    queryFn: leerRespuestas,
    staleTime: 5 * 60_000,   // cambian poco, y Realtime avisa de lo que cambie
  })
}

/**
 * Alta, edición y borrado. Sin optimismo, igual que los canales: son pocas y
 * poco frecuentes, y aquí importa más ver el error exacto —un atajo repetido,
 * por ejemplo— que la instantaneidad.
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
    // El borrado se lleva por delante también el fichero del Storage. Sin
    // esto, cada respuesta con imagen que se borrase dejaría el fichero ahí
    // para siempre, sin fila que lo nombre y sin forma de saber cuál era.
    borrar: useMutation({
      mutationFn: ({ id, imagenPath }: { id: number; imagenPath?: string | null }) =>
        borrarRespuesta(id, imagenPath),
      onSuccess: refrescar,
    }),
  }
}
