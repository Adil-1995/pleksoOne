import { create } from 'zustand'
import type { MensajeOptimista, EstadoProducto } from '@/tipos'

/**
 * Estado de INTERFAZ. Los datos viven en TanStack Query, no aquí.
 * Nada de esto se persiste: en Capacitor no queremos localStorage para datos.
 */
/**
 * Bandejas. No son un filtro más: son excluyentes y definen QUÉ lista estás
 * mirando. Silenciadas y bloqueadas salen de la bandeja normal a propósito
 * — es justo para lo que sirven — pero necesitan su pestaña o desaparecerían
 * del todo y no habría forma de devolverlas.
 */
export type Bandeja = 'bandeja' | 'favoritas' | 'silenciadas' | 'bloqueadas'

interface EstadoUI {
  busqueda: string
  setBusqueda: (v: string) => void

  bandeja: Bandeja
  setBandeja: (b: Bandeja) => void

  /** Filtro por etiqueta, o null. Se combina con la bandeja. */
  etiquetaFiltro: number | null
  setEtiquetaFiltro: (id: number | null) => void

  /**
   * Si se ve la línea de pastillas de etiqueta. Es solo visual: plegarla no
   * quita el filtro que hubiera puesto, para que no se pierda un filtro sin
   * querer al ganar sitio.
   */
  etiquetasAbiertas: boolean
  alternarEtiquetas: () => void

  /**
   * Canal que se está mirando. null = "Todos", mezclados.
   *
   * Distinto del resto de filtros: NO se limpia con "Ver todas", porque no
   * es un filtro puntual sino en qué bandeja de país vives. Su valor por
   * defecto sale del perfil (ver useCanalPorDefecto).
   */
  canalFiltro: number | null
  setCanalFiltro: (id: number | null) => void

  /**
   * Filtro por producto, o null. null es el estado NORMAL: la bandeja por
   * defecto no cambia, el filtro se enciende cuando hace falta.
   */
  productoFiltro: string | null
  setProductoFiltro: (id: string | null) => void

  /**
   * Filtro por estado de pedido, para toda la lista. Independiente del
   * producto: "enséñame lo que falta por validar", sin importar de qué.
   */
  pedidoFiltro: EstadoProducto | null
  setPedidoFiltro: (e: EstadoProducto | null) => void

  /** Estado dentro del producto. Solo tiene sentido con productoFiltro puesto. */
  estadoProductoFiltro: EstadoProducto | null
  setEstadoProductoFiltro: (e: EstadoProducto | null) => void

  limpiarFiltros: () => void

  /**
   * Dónde estaba la lista al abrir una conversación.
   *
   * Se guarda el CLIENTE y su desplazamiento respecto al borde superior del
   * panel, no el scrollTop. El scrollTop en píxeles no sirve: la lista está
   * virtualizada y las filas se miden después de pintarse, así que el mismo
   * número de píxeles apunta a una fila distinta según cuánto se haya
   * medido ya. Anclando en la conversación, vuelve a su sitio aunque las
   * alturas cambien por el camino.
   *
   * En el store de Zustand y no en localStorage: esto va a Capacitor.
   */
  anclaLista: { clienteId: string; desplazamiento: number } | null
  setAnclaLista: (a: { clienteId: string; desplazamiento: number } | null) => void

  /** La última conversación abierta, para señalarla al volver. */
  ultimaAbierta: string | null
  setUltimaAbierta: (clienteId: string | null) => void

  /**
   * Fila con el panel de la marca destapado al deslizar, o null.
   *
   * Vive en el store y no dentro de la fila para que solo pueda haber UNA
   * abierta: al deslizar otra, la primera se cierra sola. Con un estado por
   * fila se quedarían todas las que hubieras tocado medio abiertas.
   *
   * NO se persiste, y aquí sí importa la diferencia con la marca: esto es
   * un gesto a medias, no una decisión. La marca va a Supabase; esto muere
   * al recargar, que es lo que tiene que pasar.
   */
  deslizada: string | null
  setDeslizada: (clienteId: string | null) => void

  /** Índice resaltado en la lista, para navegar con j/k. */
  resaltado: number
  setResaltado: (i: number) => void
  moverResaltado: (delta: number, maximo: number) => void

  buscadorAbierto: boolean
  abrirBuscador: () => void
  cerrarBuscador: () => void

  /** Imagen abierta a pantalla completa, o null. */
  visor: { url: string; nombre?: string } | null
  abrirVisor: (url: string, nombre?: string) => void
  cerrarVisor: () => void

  /** Mensajes enviados que aún no ha confirmado el servidor, por cliente. */
  optimistas: Record<string, MensajeOptimista[]>
  anadirOptimista: (clienteId: string, m: MensajeOptimista) => void
  marcarFallo: (clienteId: string, id: number, motivo: string) => void
  quitarOptimista: (clienteId: string, id: number) => void
  limpiarOptimistas: (clienteId: string) => void
}

export const useUI = create<EstadoUI>((set) => ({
  busqueda: '',
  setBusqueda: (v) => set({ busqueda: v, resaltado: 0 }),

  // Al cambiar de filtro, el resaltado del teclado vuelve arriba: si se
  // quedara en el índice 7 de una lista que ahora tiene 2, j/k apuntarían
  // a la nada.
  bandeja: 'bandeja',
  setBandeja: (b) => set({ bandeja: b, resaltado: 0 }),

  etiquetaFiltro: null,
  setEtiquetaFiltro: (id) => set({ etiquetaFiltro: id, resaltado: 0 }),

  etiquetasAbiertas: false,
  alternarEtiquetas: () => set((s) => ({ etiquetasAbiertas: !s.etiquetasAbiertas })),

  canalFiltro: null,
  setCanalFiltro: (id) => set({ canalFiltro: id, resaltado: 0 }),

  productoFiltro: null,
  // Al quitar el producto se quita tambien su estado: dejarlo puesto haria
  // que el proximo producto que elijas apareciera ya filtrado sin avisar.
  setProductoFiltro: (id) =>
    set({ productoFiltro: id, estadoProductoFiltro: null, resaltado: 0 }),

  pedidoFiltro: null,
  setPedidoFiltro: (e) => set({ pedidoFiltro: e, resaltado: 0 }),

  estadoProductoFiltro: null,
  setEstadoProductoFiltro: (e) => set({ estadoProductoFiltro: e, resaltado: 0 }),

  anclaLista: null,
  setAnclaLista: (a) => set({ anclaLista: a }),

  ultimaAbierta: null,
  setUltimaAbierta: (clienteId) => set({ ultimaAbierta: clienteId }),

  deslizada: null,
  setDeslizada: (clienteId) => set({ deslizada: clienteId }),

  limpiarFiltros: () =>
    set({
      bandeja: 'bandeja', etiquetaFiltro: null, pedidoFiltro: null,
      productoFiltro: null, estadoProductoFiltro: null,
      busqueda: '', buscadorAbierto: false, resaltado: 0,
    }),

  resaltado: 0,
  setResaltado: (i) => set({ resaltado: i }),
  moverResaltado: (delta, maximo) =>
    set((s) => ({ resaltado: Math.max(0, Math.min(maximo - 1, s.resaltado + delta)) })),

  buscadorAbierto: false,
  abrirBuscador: () => set({ buscadorAbierto: true }),
  cerrarBuscador: () => set({ buscadorAbierto: false, busqueda: '' }),

  visor: null,
  abrirVisor: (url, nombre) => set({ visor: { url, nombre } }),
  cerrarVisor: () => set({ visor: null }),

  optimistas: {},
  anadirOptimista: (clienteId, m) =>
    set((s) => ({
      optimistas: { ...s.optimistas, [clienteId]: [...(s.optimistas[clienteId] ?? []), m] },
    })),
  marcarFallo: (clienteId, id, motivo) =>
    set((s) => ({
      optimistas: {
        ...s.optimistas,
        [clienteId]: (s.optimistas[clienteId] ?? []).map((m) =>
          m.id === id ? { ...m, fallo: motivo, estado: 'error' as const } : m,
        ),
      },
    })),
  quitarOptimista: (clienteId, id) =>
    set((s) => ({
      optimistas: {
        ...s.optimistas,
        [clienteId]: (s.optimistas[clienteId] ?? []).filter((m) => m.id !== id),
      },
    })),
  limpiarOptimistas: (clienteId) =>
    set((s) => ({ optimistas: { ...s.optimistas, [clienteId]: [] } })),
}))
