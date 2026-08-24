import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Star, Inbox as IconoInbox, BellOff, Ban, X, Boxes, Search, Tag, ShoppingCart, Radio,
} from 'lucide-react'
import { useUI, type Bandeja } from '@/store/ui'
import { useEtiquetas, useCanales } from '@/hooks/datos'
import { distintivo } from '@/lib/canales'
import { useCanalPorDefecto } from '@/hooks/useCanalPorDefecto'
import { clasePastilla, clasePunto } from '@/lib/colores'
import {
  catalogoPresente, nombreProducto, estadoPedidoDe,
  ETIQUETA_ESTADO, CICLO_PEDIDO, PINTA_PEDIDO,
} from '@/lib/productos'
import type { Conversacion, EstadoProducto } from '@/tipos'

/**
 * Bandejas y filtros.
 *
 * Las BANDEJAS son excluyentes y definen qué lista miras. Los FILTROS
 * (etiqueta, producto) se combinan encima de la bandeja elegida. Se pintan
 * distinto a propósito para que se note que no son lo mismo.
 *
 *   [Todas] [Favoritos] [Etiquetas] [Productos] ·······scroll······· | [Buscar]
 *   [ Reclamación ] [ Cliente difícil ] ...        ← solo si la despliegas
 *
 * La lupa vive FUERA del contenedor con scroll: dentro se iría con él y
 * acabaría escondida a la derecha. Y la línea de etiquetas se pliega desde
 * su icono, así que solo ocupa alto cuando la quieres.
 */
export function FiltrosLista({ conversaciones }: { conversaciones: Conversacion[] }) {
  const {
    bandeja, setBandeja, etiquetaFiltro, setEtiquetaFiltro, limpiarFiltros,
    productoFiltro, setProductoFiltro,
    estadoProductoFiltro, setEstadoProductoFiltro,
    busqueda, setBusqueda, buscadorAbierto, abrirBuscador, cerrarBuscador,
    etiquetasAbiertas, alternarEtiquetas, pedidoFiltro, setPedidoFiltro,
    canalFiltro, setCanalFiltro,
  } = useUI()
  const { data: etiquetas } = useEtiquetas()
  const { data: canales } = useCanales()
  const { canalId: canalGuardado, guardar: guardarCanal, cargado: canalCargado } = useCanalPorDefecto()

  // Solo se ofrecen canales que tengan conversaciones o estén activos: uno
  // dado de alta hace un minuto y todavía sin mensajes tiene que salir, pero
  // uno retirado hace meses y sin nada detrás no ensucia el desplegable.
  const canalesVisibles = (canales ?? []).filter(
    (c) => c.activo || conversaciones.some((v) => v.canal_id === c.id))
  const canalElegido = canalesVisibles.find((c) => c.id === canalFiltro) ?? null

  // Al arrancar, el canal del perfil. Una sola vez: después manda lo que
  // toques, y si no, cambiar de canal se desharía solo al siguiente refetch.
  const canalAplicado = useRef(false)
  useEffect(() => {
    if (!canalCargado || canalAplicado.current) return
    canalAplicado.current = true
    if (canalGuardado !== null) setCanalFiltro(canalGuardado)
  }, [canalCargado, canalGuardado, setCanalFiltro])
  const campoBusqueda = useRef<HTMLInputElement>(null)

  // Al desplegar la lupa, el foco va al campo: si hay que pulsar dos veces
  // (abrir y luego picar dentro) el atajo deja de ahorrar nada.
  useEffect(() => {
    if (buscadorAbierto) campoBusqueda.current?.focus()
  }, [buscadorAbierto])

  // El selector solo ofrece productos que existen de verdad en los datos.
  const productos = catalogoPresente(conversaciones)

  // Contadores de las pestañas de estado, sobre el producto elegido y con la
  // bandeja ya aplicada — si no, "Todos (45)" contaría también silenciadas y
  // bloqueadas, que no están en la lista que estás mirando.
  const enBandeja = conversaciones.filter((c) =>
    bandeja === 'bandeja' ? !c.silenciada && !c.bloqueada
    : bandeja === 'favoritas' ? c.favorita && !c.bloqueada
    : bandeja === 'silenciadas' ? c.silenciada && !c.bloqueada
    : c.bloqueada)

  const delProducto = productoFiltro
    ? enBandeja.filter((c) => (c.conversacion_productos ?? []).some((p) => p.producto === productoFiltro))
    : []
  const cuentaEstado = (e: EstadoProducto) =>
    delProducto.filter((c) => (c.conversacion_productos ?? [])
      .some((p) => p.producto === productoFiltro && p.estado === e)).length

  // Los contadores salen de lo que ya está cargado: ni una consulta más.
  const cuentas = {
    bandeja: conversaciones.filter((c) => !c.silenciada && !c.bloqueada).length,
    favoritas: conversaciones.filter((c) => c.favorita && !c.bloqueada).length,
    silenciadas: conversaciones.filter((c) => c.silenciada && !c.bloqueada).length,
    bloqueadas: conversaciones.filter((c) => c.bloqueada).length,
  }

  const BANDEJAS: { id: Bandeja; icono: typeof Star; texto: string; cuenta: number }[] = [
    { id: 'bandeja',     icono: IconoInbox, texto: 'Todas',       cuenta: cuentas.bandeja },
    { id: 'favoritas',   icono: Star,       texto: 'Favoritos',   cuenta: cuentas.favoritas },
    { id: 'silenciadas', icono: BellOff,    texto: 'Silenciadas', cuenta: cuentas.silenciadas },
    { id: 'bloqueadas',  icono: Ban,        texto: 'Bloqueadas',  cuenta: cuentas.bloqueadas },
  ]

  // Cuántas conversaciones tienen algo en cada estado de pedido. Sobre la
  // lista entera, no sobre la bandeja: son un filtro global.
  const conPendiente = conversaciones.filter(
    (c) => estadoPedidoDe(c.conversacion_productos ?? []) === 'pendiente').length
  const conValidado = conversaciones.filter(
    (c) => estadoPedidoDe(c.conversacion_productos ?? []) === 'validado').length

  const hayFiltro = etiquetaFiltro !== null || bandeja !== 'bandeja' ||
                    productoFiltro !== null || pedidoFiltro !== null ||
                    canalFiltro !== null

  return (
    <div className="border-b border-borde">
      {/*
        LÍNEA 1 — todas, favoritos, etiquetas, productos, y la lupa al final.

        El buscador ya no tiene fila propia. Ocupaba 52 px fijos todo el día
        para algo que se usa un rato; ahora se despliega sobre esta misma
        línea. Esa altura vuelve a la lista, que es lo que se mira.

        Silenciadas y bloqueadas solo asoman si hay algo dentro. Hoy no hay,
        así que se ven los cuatro y ya está — pero si un día bloqueas a
        alguien tiene que haber forma de llegar a él.
      */}
      {buscadorAbierto ? (
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Search className="pointer-events-none ml-1 h-4 w-4 shrink-0 text-texto2" />
          <input
            ref={campoBusqueda}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') cerrarBuscador() }}
            placeholder="Buscar por nombre, número o mensaje"
            className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-texto2"
          />
          <button
            onClick={cerrarBuscador}
            className="shrink-0 rounded-full p-1.5 text-texto2 hover:bg-panel2 hover:text-texto"
            aria-label="Cerrar la búsqueda"
            title="Cerrar la búsqueda"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        // La lupa va FUERA de la tira desplazable. Dentro se iría con el
        // scroll y acabaría escondida a la derecha, que es exactamente lo
        // que ya nos pasó con el selector de producto. Aquí es un hermano
        // del contenedor con scroll, así que se queda quieta pase lo que
        // pase con los demás.
        <div className="flex items-stretch">
          <div className="min-w-0 flex-1">
            <TiraDesplazable separador={false}>

              {BANDEJAS.map(({ id, icono: Icono, texto, cuenta }) => {
                if ((id === 'silenciadas' || id === 'bloqueadas') && cuenta === 0 && bandeja !== id) return null
                const puesta = bandeja === id
                // El contador va siempre en "Todas": es el número de
                // referencia, el que dice cuántas conversaciones tienes de
                // verdad. En el resto solo cuando está activo, para no
                // volver a la fila de cifras que nadie leía.
                const verCuenta = id === 'bandeja' || puesta
                return (
                  <button
                    key={id}
                    onClick={() => setBandeja(id)}
                    title={texto + ' (' + cuenta + ')'}
                    aria-label={texto}
                    aria-pressed={puesta}
                    className={[
                      'flex shrink-0 items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium transition-colors',
                      puesta ? 'bg-acento text-fondo' : 'bg-panel2 text-texto2 hover:text-texto',
                    ].join(' ')}
                  >
                    <Icono className={['h-4 w-4', id === 'favoritas' && puesta ? 'fill-current' : ''].join(' ')} />
                    {verCuenta && cuenta > 0 && <span className="tabular-nums">{cuenta}</span>}
                  </button>
                )
              })}

              {/* Abre y cierra la línea de pastillas. Así esa fila solo
                  ocupa alto cuando hace falta. Se queda encendido también
                  con la línea plegada si hay una etiqueta filtrando: si no,
                  el filtro seguiría puesto sin nada que lo delatara. */}
              {(etiquetas ?? []).length > 0 && (
                <button
                  onClick={alternarEtiquetas}
                  title={etiquetasAbiertas ? 'Ocultar las etiquetas' : 'Ver las etiquetas'}
                  aria-label="Etiquetas"
                  aria-expanded={etiquetasAbiertas}
                  className={[
                    'shrink-0 rounded-full p-1.5 transition-colors',
                    etiquetasAbiertas || etiquetaFiltro !== null
                      ? 'bg-acento text-fondo'
                      : 'bg-panel2 text-texto2 hover:text-texto',
                  ].join(' ')}
                >
                  <Tag className="h-4 w-4" />
                </button>
              )}

              {/* El producto es lo único que no puede ser un icono a secas:
                  hay cuatro y no se distinguen por dibujo. Desplegable, pero
                  colapsado al icono mientras no haya ninguno elegido. */}
              {productos.length > 0 && (
                <label className="relative flex shrink-0 items-center" title="Filtrar por producto">
                  <Boxes className={[
                    'pointer-events-none absolute left-2 h-4 w-4',
                    productoFiltro ? 'text-fondo' : 'text-texto2',
                  ].join(' ')} />
                  <select
                    value={productoFiltro ?? ''}
                    onChange={(e) => setProductoFiltro(e.target.value || null)}
                    aria-label="Filtrar por producto"
                    className={[
                      'cursor-pointer appearance-none rounded-full py-1.5 pl-7 text-xs font-medium outline-none transition-all',
                      productoFiltro ? 'bg-acento pr-3 text-fondo' : 'w-8 bg-panel2 pr-0 text-texto2 hover:text-texto',
                    ].join(' ')}
                  >
                    <option value="">Producto…</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>{p.nombre} ({p.conversaciones})</option>
                    ))}
                  </select>
                </label>
              )}

              {/*
                EL CANAL, un icono más y el último de la línea.

                Antes iba el primero y desplegado a lo ancho: "Todos los
                canales" son 17 caracteres ocupando sitio fijo para decir que
                NO hay filtro puesto, y eso empujaba al resto fuera de la
                vista. Ahora sigue el patrón de los demás — icono mientras no
                filtra, y solo se ensancha cuando hay algo que contar.

                El <select> va invisible ENCIMA del botón en vez de estilarse
                él: así el desplegable sigue siendo el nativo (la rueda de
                iOS, que es donde se usa esto) pero lo que se ve es un icono
                del mismo tamaño que los otros cuatro.
              */}
              {canalesVisibles.length > 1 && (
                <label className="relative flex shrink-0 items-center" title="Filtrar por canal">
                  <span
                    className={[
                      'pointer-events-none flex items-center gap-1 rounded-full py-1.5 text-xs font-medium transition-colors',
                      canalFiltro !== null
                        ? 'bg-acento px-2 text-fondo'
                        : 'w-8 justify-center bg-panel2 text-texto2',
                    ].join(' ')}
                  >
                    <Radio className="h-4 w-4 shrink-0" />
                    {/* El código del canal, no su nombre: es lo que hace que
                        no se te olvide que tienes un filtro puesto sin
                        volver a comerse la línea. */}
                    {canalElegido && <span>{distintivo(canalElegido)}</span>}
                  </span>
                  <select
                    value={canalFiltro ?? ''}
                    onChange={(e) => {
                      const v = e.target.value ? Number(e.target.value) : null
                      setCanalFiltro(v)
                      guardarCanal(v)          // queda como preferencia del perfil
                    }}
                    aria-label="Filtrar por canal"
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  >
                    <option value="">Todos los canales</option>
                    {canalesVisibles.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}{c.activo ? '' : ' (inactivo)'}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {/* Los dos carritos. El color ES el filtro: amarillo lo que la
                  máquina ha detectado y falta validar, verde lo confirmado.
                  Se ocultan si no hay ninguno de ese tipo — un filtro que
                  siempre daría cero no merece sitio en la tira. */}
              {([['pendiente', conPendiente], ['validado', conValidado]] as const).map(
                ([est, cuenta]) => cuenta === 0 && pedidoFiltro !== est ? null : (
                  <button
                    key={est}
                    onClick={() => setPedidoFiltro(pedidoFiltro === est ? null : est)}
                    title={PINTA_PEDIDO[est].texto + ' (' + cuenta + ')\n' + PINTA_PEDIDO[est].detalle}
                    aria-label={PINTA_PEDIDO[est].texto}
                    aria-pressed={pedidoFiltro === est}
                    className={[
                      'flex shrink-0 items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium transition-colors',
                      pedidoFiltro === est
                        ? 'bg-acento text-fondo'
                        : 'bg-panel2 hover:brightness-125 ' + PINTA_PEDIDO[est].color,
                    ].join(' ')}
                  >
                    <ShoppingCart className="h-4 w-4" />
                    {pedidoFiltro === est && <span className="tabular-nums">{cuenta}</span>}
                  </button>
                ),
              )}
            </TiraDesplazable>
          </div>

          <button
            onClick={abrirBuscador}
            title="Buscar   ( / )"
            aria-label="Buscar"
            className={[
              'flex shrink-0 items-center border-l border-borde px-2.5 transition-colors',
              busqueda ? 'text-acento' : 'text-texto2 hover:text-texto',
            ].join(' ')}
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
      )}

      {/*
        LÍNEA 2 — etiquetas, con su NOMBRE al lado del color.

        Estuvieron un rato como puntos sueltos para ahorrar sitio y no había
        forma de saber cuál era cuál: un color sin nombre no identifica nada
        si tienes cinco. El sitio sale de poder plegar la línea entera desde
        el icono de la línea 1, no de quitarles el texto.

        Plegada mientras se busca: la barra de búsqueda ocupa la línea 1 y
        dejar estas pastillas sueltas debajo, sin nada a lo que pertenecer,
        no ayuda a nadie.
      */}
      {etiquetasAbiertas && !buscadorAbierto && (etiquetas ?? []).length > 0 && (
        <TiraDesplazable>
          {(etiquetas ?? []).map((e) => {
            const puesta = etiquetaFiltro === e.id
            return (
              <button
                key={e.id}
                onClick={() => setEtiquetaFiltro(puesta ? null : e.id)}
                title={e.nombre}
                aria-pressed={puesta}
                className={[
                  'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors',
                  puesta
                    ? clasePastilla(e.color) + ' ring-2'
                    : 'bg-panel2 text-texto2 ring-transparent hover:text-texto',
                ].join(' ')}
              >
                <span className={['h-2.5 w-2.5 shrink-0 rounded-full', clasePunto(e.color)].join(' ')} />
                {e.nombre}
              </button>
            )
          })}
        </TiraDesplazable>
      )}

      {/*
        AVISO DE FILTRO ACTIVO, con las pestañas de estado DENTRO.
        Antes eran dos filas. Van juntas porque dicen lo mismo: qué estás
        mirando. Y sigue en color, porque lo que no puede pasar es que creas
        que tienes menos conversaciones de las que hay.
      */}
      {hayFiltro && (
        <div className="border-t border-borde bg-acento/10 text-acento">
          <div className="flex items-center gap-2 px-3 py-1">
            <span className="min-w-0 flex-1 truncate text-xs">
              <strong className="font-semibold">{descripcionFiltro({
                bandeja, productoFiltro, estadoProductoFiltro, pedidoFiltro,
                canal: canalesVisibles.find((c) => c.id === canalFiltro)?.nombre ?? null,
                etiqueta: (etiquetas ?? []).find((e) => e.id === etiquetaFiltro)?.nombre ?? null,
              })}</strong>
              <span className="opacity-70">, no la bandeja completa</span>
            </span>
            <button
              onClick={() => { limpiarFiltros(); setCanalFiltro(null); guardarCanal(null) }}
              title="Quitar los filtros y ver todas, de todos los canales"
              aria-label="Quitar los filtros"
              className="shrink-0 rounded-full p-1 hover:bg-acento/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {productoFiltro && (
            <div className="flex items-center gap-1 px-2 pb-1">
              {([null, ...CICLO_PEDIDO] as const).map((e) => {
                const puesta = estadoProductoFiltro === e
                const cuenta = e === null ? delProducto.length : cuentaEstado(e)
                return (
                  <button
                    key={e ?? 'todos'}
                    onClick={() => setEstadoProductoFiltro(e)}
                    className={[
                      'rounded px-2 py-0.5 text-xs transition-colors',
                      puesta ? 'bg-acento font-semibold text-fondo' : 'hover:bg-acento/20',
                    ].join(' ')}
                  >
                    {e === null ? 'Todos' : ETIQUETA_ESTADO[e]}
                    {puesta && <span className="ml-1 tabular-nums opacity-80">{cuenta}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Tira con scroll horizontal que AVISA de que hay más.
 *
 * La barra de scroll va oculta (en el móvil ocupa y queda fea), y sin ella
 * una tira desbordada es indistinguible de una tira completa. El degradado
 * del borde es la única pista, así que solo se pinta cuando de verdad hay
 * contenido fuera y desaparece al llegar al final.
 */
function TiraDesplazable({
  children, separador = true,
}: {
  children: React.ReactNode
  /** La primera tira no lleva línea arriba: ya la pone el buscador. */
  separador?: boolean
}) {
  const caja = useRef<HTMLDivElement>(null)
  const [hayMas, setHayMas] = useState(false)

  const medir = useCallback(() => {
    const el = caja.current
    if (!el) return
    setHayMas(el.scrollWidth - el.clientWidth - el.scrollLeft > 8)
  }, [])

  useEffect(() => {
    medir()
    const el = caja.current
    if (!el) return
    // ResizeObserver y no solo `resize` de window: el panel cambia de ancho
    // al abrir una conversación en móvil, sin que la ventana se mueva.
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [medir, children])

  return (
    <div className={['relative', separador ? 'border-t border-borde' : ''].join(' ')}>
      <div
        ref={caja}
        onScroll={medir}
        className="flex gap-1.5 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      {hayMas && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-panel to-transparent"
        />
      )}
    </div>
  )
}

/** Lo que estás viendo, en una frase. Sin adivinanzas. */
function descripcionFiltro({
  bandeja, productoFiltro, estadoProductoFiltro, pedidoFiltro, canal, etiqueta,
}: {
  bandeja: Bandeja
  productoFiltro: string | null
  estadoProductoFiltro: EstadoProducto | null
  pedidoFiltro: EstadoProducto | null
  canal: string | null
  etiqueta: string | null
}): string {
  const trozos: string[] = []
  if (canal) trozos.push(canal)          // el canal primero: es el marco

  if (productoFiltro) {
    trozos.push(estadoProductoFiltro
      ? `${ETIQUETA_ESTADO[estadoProductoFiltro].toLowerCase()} en ${nombreProducto(productoFiltro)}`
      : nombreProducto(productoFiltro))
  }
  if (bandeja === 'favoritas') trozos.push('favoritos')
  if (bandeja === 'silenciadas') trozos.push('silenciadas')
  if (bandeja === 'bloqueadas') trozos.push('bloqueadas')
  if (pedidoFiltro) trozos.push(PINTA_PEDIDO[pedidoFiltro].texto.toLowerCase())
  if (etiqueta) trozos.push(`etiqueta «${etiqueta}»`)

  return trozos.length ? trozos.join(' · ') : 'una lista filtrada'
}

/** El filtrado en sí, fuera del componente para poder probarlo aparte. */
export function aplicarFiltros(
  lista: Conversacion[],
  { bandeja, etiquetaFiltro, canalFiltro, productoFiltro, estadoProductoFiltro, pedidoFiltro, busqueda }: {
    bandeja: Bandeja
    etiquetaFiltro: number | null
    canalFiltro: number | null
    productoFiltro: string | null
    estadoProductoFiltro: EstadoProducto | null
    pedidoFiltro: EstadoProducto | null
    busqueda: string
  },
): Conversacion[] {
  let out = lista

  // 1. Bandeja. Las bloqueadas NUNCA aparecen fuera de su pestaña: si
  //    salieran en "Todas", alguien les escribiría sin entender por qué falla.
  if (bandeja === 'bandeja')          out = out.filter((c) => !c.silenciada && !c.bloqueada)
  else if (bandeja === 'favoritas')   out = out.filter((c) => c.favorita && !c.bloqueada)
  else if (bandeja === 'silenciadas') out = out.filter((c) => c.silenciada && !c.bloqueada)
  else if (bandeja === 'bloqueadas')  out = out.filter((c) => c.bloqueada)

  if (etiquetaFiltro !== null) {
    out = out.filter((c) => (c.etiquetas ?? []).some((e) => e.id === etiquetaFiltro))
  }
  // 2. Canal. Va lo PRIMERO de los filtros combinables: es en qué bandeja
  //    de país estás, y todo lo demás se cuenta dentro de ella.
  if (canalFiltro !== null) out = out.filter((c) => c.canal_id === canalFiltro)

  // 3. Estado de pedido, para toda la lista. Se mira el estado de la
  //    CONVERSACIÓN (el más avanzado de sus productos), igual que el icono
  //    del carrito: si el icono está verde, tiene que salir en el filtro verde.
  if (pedidoFiltro !== null) {
    out = out.filter((c) => estadoPedidoDe(c.conversacion_productos ?? []) === pedidoFiltro)
  }

  // 3. Producto. El estado solo se aplica DENTRO de un producto: filtrar por
  //    "comprados" sin decir de qué mezclaría clientes de productos distintos
  //    y el contador de la pestaña no cuadraría con nada.
  if (productoFiltro !== null) {
    out = out.filter((c) =>
      (c.conversacion_productos ?? []).some((p) =>
        p.producto === productoFiltro &&
        (estadoProductoFiltro === null || p.estado === estadoProductoFiltro)))
  }

  const q = busqueda.trim().toLowerCase()
  if (q) {
    // Los DÍGITOS de lo que se ha escrito, aparte. Ahora que el número es lo
    // que se ve en la lista, se busca copiándolo de ahí —o del aviso de
    // Telegram, o del móvil— y viene con `+`, espacios o guiones. Sin esto,
    // pegar «+52 1 559 193 7975» no encontraba nada mientras el número
    // estaba delante en pantalla, y parecía que el buscador no funcionaba.
    //
    // Solo se usa si quedan 3 dígitos o más: con uno o dos, cualquier número
    // los contiene y el resultado sería la lista entera.
    const digitos = q.replace(/\D/g, '')
    const porNumero = digitos.length >= 3
    out = out.filter(
      (c) =>
        (c.nombre ?? '').toLowerCase().includes(q) ||
        c.cliente_id.includes(q) ||
        (porNumero && c.cliente_id.includes(digitos)) ||
        (c.ultimo_texto ?? '').toLowerCase().includes(q),
    )
  }
  return out
}
