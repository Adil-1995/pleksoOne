import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useNavigate, useParams } from 'react-router-dom'
import { Star, Pin, BotOff } from 'lucide-react'
import { useConversaciones, useCanales, usePonerFavorita, usePonerFijada , useConversacionesCorruptas, motivoCorrupta } from '@/hooks/datos'
import { mariaAtiende, distintivo } from '@/lib/canales'
import { useUI } from '@/store/ui'
import { clasePunto } from '@/lib/colores'
import { productosDe, nombreProducto } from '@/lib/productos'
import { horaLista, iniciales, colorAvatar, resumen } from '@/lib/formato'
import { EsqueletoLista, Vacio } from './Esqueletos'
import { FiltrosLista, aplicarFiltros } from './FiltrosLista'
import { IconoEstado } from './EstadoConv'
import { CarritoPedido } from './CarritoPedido'
import type { Conversacion, Canal } from '@/tipos'

const TITULO_VACIO: Record<string, string> = {
  bandeja: 'Todavía no hay conversaciones',
  favoritas: 'Ninguna conversación marcada',
  silenciadas: 'Ninguna conversación silenciada',
  bloqueadas: 'Ningún cliente bloqueado',
}

export function ListaConversaciones() {
  const { data: conversaciones, isPending, error } = useConversaciones()
  const { data: canales } = useCanales()
  const { busqueda, resaltado, setResaltado, bandeja, etiquetaFiltro,
          productoFiltro, estadoProductoFiltro, pedidoFiltro, canalFiltro,
          anclaLista, setAnclaLista, ultimaAbierta, setUltimaAbierta } = useUI()
  const navegar = useNavigate()
  const { clienteId } = useParams()
  const contenedor = useRef<HTMLDivElement>(null)
  const saltarAjuste = useRef(false)
  const yaRestaurado = useRef(false)

  // Con "Todos" hay que poder distinguir de qué número es cada
  // conversación; con un canal elegido, esa etiqueta sería ruido idéntico
  // en las 183 filas.
  const mezclando = canalFiltro === null
  const porCanal = useMemo(() => {
    const m = new Map<number, Canal>()
    for (const c of canales ?? []) m.set(c.id, c)
    return m
  }, [canales])

  const filtradas = useMemo(
    () => aplicarFiltros(conversaciones ?? [],
      { bandeja, etiquetaFiltro, canalFiltro, productoFiltro, estadoProductoFiltro, pedidoFiltro, busqueda }),
    [conversaciones, bandeja, etiquetaFiltro, canalFiltro, productoFiltro, estadoProductoFiltro, pedidoFiltro, busqueda],
  )

  const virtual = useVirtualizer({
    count: filtradas.length,
    getScrollElement: () => contenedor.current,
    estimateSize: () => 76,
    overscan: 8,
    // Las filas NO miden todas lo mismo: una con producto y etiquetas ocupa
    // tres líneas y una sin nada, dos. Con la altura fija en 76 px, las de
    // tres se salían de su hueco y se comían la de abajo — eso era el
    // "se amontonan", y el separador solo lo disimulaba. Midiéndolas de
    // verdad, cada una ocupa lo suyo.
    measureElement: (el) => el.getBoundingClientRect().height,
  })

  // Que el resaltado del TECLADO quede a la vista.
  //
  // `saltarAjuste` existe porque pulsar una fila también mueve el resaltado,
  // y entonces esto llamaba a scrollToIndex sobre una lista aún a medio
  // medir: la lista se desplazaba 442 px en el momento de abrir, antes
  // siquiera de volver. Con j/k sí hace falta; con el ratón no.
  useEffect(() => {
    if (saltarAjuste.current) { saltarAjuste.current = false; return }
    if (filtradas.length) virtual.scrollToIndex(resaltado, { align: 'auto' })
  }, [resaltado, filtradas.length, virtual])

  /**
   * Vuelve a dejar la lista donde estaba, con la conversación que abriste en
   * el mismo punto de la pantalla.
   *
   * No fija un scrollTop: MIDE dónde ha quedado la fila y corrige la
   * diferencia, repitiendo unos fotogramas. Las filas se miden después de
   * pintarse (measureElement), así que un scrollTop puesto de golpe apunta a
   * una fila distinta un instante después — que es justo el salto que
   * había. Corrigiendo contra la posición real, da igual cuándo terminen de
   * medirse: converge solo.
   */
  const restaurarAncla = useCallback(() => {
    const el = contenedor.current
    const ancla = anclaLista
    if (!el || !ancla) return

    const idx = filtradas.findIndex((c) => c.cliente_id === ancla.clienteId)
    if (idx < 0) return          // ya no está en la lista (otro filtro): no se toca

    let intentos = 0
    const ajustar = () => {
      const c = contenedor.current
      if (!c) return
      const fila = c.querySelector<HTMLElement>(`[data-cliente="${CSS.escape(ancla.clienteId)}"]`)
      if (!fila) {
        // Todavía no está pintada: el virtualizador no la tiene en pantalla.
        // Se le pide que la traiga y se reintenta.
        virtual.scrollToIndex(idx, { align: 'start' })
        if (intentos++ < 30) requestAnimationFrame(ajustar)
        return
      }
      const actual = fila.getBoundingClientRect().top - c.getBoundingClientRect().top
      const delta = actual - ancla.desplazamiento
      if (Math.abs(delta) > 1) {
        c.scrollTop += delta
        if (intentos++ < 30) requestAnimationFrame(ajustar)
      }
    }
    requestAnimationFrame(ajustar)
  }, [anclaLista, filtradas, virtual])

  // Al volver a la lista (deja de haber conversación abierta), restaurar UNA
  // vez. El ref evita que un refetch posterior vuelva a moverla bajo el dedo.
  useEffect(() => {
    if (clienteId) { yaRestaurado.current = false; return }
    if (yaRestaurado.current || !filtradas.length) return
    yaRestaurado.current = true
    restaurarAncla()
  }, [clienteId, filtradas.length, restaurarAncla])

  if (isPending) return <EsqueletoLista />
  if (error) return <Vacio titulo="No se pudieron cargar las conversaciones" detalle={String(error)} />

  return (
    <div className="flex h-full flex-col">
      {/* El buscador vive dentro de la fila de filtros: se despliega al
          pulsar la lupa. Aquí tenía una fila propia de 52 px ocupados todo
          el día para algo que se usa a ratos. */}
      <FiltrosLista conversaciones={conversaciones ?? []} />

      <AvisoCorruptas />

      <div ref={contenedor} className="flex-1 overflow-y-auto">
        {filtradas.length === 0 ? (
          <Vacio
            titulo={busqueda ? 'Sin resultados' : TITULO_VACIO[bandeja]}
            detalle={!busqueda && bandeja === 'bandeja' ? undefined : 'Prueba a quitar los filtros.'}
          />
        ) : (
          <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
            {virtual.getVirtualItems().map((v) => {
              const c = filtradas[v.index]
              return (
                <div
                  key={c.cliente_id}
                  data-cliente={c.cliente_id}
                  data-index={v.index}
                  ref={virtual.measureElement}
                  // Sin `height`: la mide measureElement. Fijarla aquí sería
                  // volver al problema — el hueco diría 76 y el contenido 86.
                  style={{
                    position: 'absolute', top: 0, left: 0, width: '100%',
                    transform: `translateY(${v.start}px)`,
                  }}
                >
                  <Fila
                    conv={c}
                    canal={mezclando ? porCanal.get(c.canal_id ?? -1) : undefined}
                    // Esta SÍ va siempre, mezclando o no: que María esté
                    // callada en el número no depende de cómo filtres.
                    callada={!mariaAtiende(porCanal.get(c.canal_id ?? -1))}
                    activa={c.cliente_id === clienteId}
                    ultima={c.cliente_id === ultimaAbierta && c.cliente_id !== clienteId}
                    resaltada={v.index === resaltado}
                    onClick={(el) => {
                      // El ancla se toma AQUÍ, con la fila todavía en su
                      // sitio: después de navegar ya es tarde.
                      const caja = contenedor.current
                      const fila = (el.currentTarget as HTMLElement).closest('[data-cliente]')
                      if (caja && fila) {
                        setAnclaLista({
                          clienteId: c.cliente_id,
                          desplazamiento: fila.getBoundingClientRect().top - caja.getBoundingClientRect().top,
                        })
                      }
                      setUltimaAbierta(c.cliente_id)
                      saltarAjuste.current = true
                      setResaltado(v.index)
                      navegar(`/c/${c.cliente_id}`)
                    }}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Fila({
  conv, canal, callada, activa, ultima, resaltada, onClick,
}: {
  conv: Conversacion
  /** Solo llega si estás viendo todos los canales mezclados. */
  canal?: Canal
  /** María está pausada en el canal de esta conversación. */
  callada: boolean
  activa: boolean
  /** La última que abriste, para localizarla de un vistazo al volver. */
  ultima: boolean
  resaltada: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  const nombre = conv.nombre || conv.cliente_id
  const favorita = usePonerFavorita()
  const fijada = usePonerFijada()
  const etiquetas = conv.etiquetas ?? []
  const productos = productosDe(conv)

  return (
    // La fila entera ya no es un <button>: dentro va la estrella, que también
    // lo es, y un botón dentro de otro es HTML inválido — el navegador lo
    // desanida y el clic de la estrella acaba abriendo la conversación.
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      // El teclado también abre, y también tiene que dejar el ancla puesta:
      // `onClick` la calcula desde currentTarget, que aquí es la misma fila.
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e as unknown as React.MouseEvent) }
      }}
      className={[
        // `group` para que las acciones aparezcan al pasar por encima.
        // El separador va aquí, en el borde inferior de la fila: con las
        // filas pegadas y dos líneas de contenido cada una, la de Adil se
        // comía visualmente la de abajo.
        'group relative flex w-full cursor-pointer items-center gap-3 border-b border-borde/60 px-3 py-2.5 text-left transition-colors',
        activa ? 'bg-panel2' : resaltada ? 'bg-panel2/50' : 'hover:bg-panel2/30',
        // La última que abriste, para reencontrarla de un vistazo al volver.
        // Un tinte flojo y una barra al borde: se localiza sin competir con
        // la conversación activa ni con los no leídos.
        ultima ? 'bg-acento/[0.07]' : '',
      ].join(' ')}
    >
      {ultima && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] rounded-r bg-acento/70"
        />
      )}

      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-fondo"
        style={{ background: colorAvatar(conv.cliente_id) }}
      >
        {iniciales(conv.nombre, conv.cliente_id)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          {conv.fijada && (
            <Pin className="h-3 w-3 shrink-0 self-center text-acento" aria-label="Fijada" />
          )}
          {callada && (
            <BotOff
              className="h-3.5 w-3.5 shrink-0 self-center text-alerta"
              aria-label="María pausada en este canal"
            />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{nombre}</span>
          {canal && (
            <span
              title={canal.nombre}
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-texto2 ring-1 ring-borde"
            >
              {distintivo(canal)}
            </span>
          )}
          <span className="shrink-0 text-xs text-texto2">{horaLista(conv.ultimo_en)}</span>
        </div>

        <div className="mt-0.5 flex items-center gap-1.5">
          <IconoEstado conv={conv} />
          <span className="truncate text-sm text-texto2">
            {resumen(conv.ultimo_texto) || <span className="italic opacity-60">Sin mensajes</span>}
          </span>
          {conv.no_leidos > 0 && (
            <span className="ml-auto min-w-[20px] shrink-0 rounded-full bg-acento px-1.5 py-0.5 text-center text-[11px] font-semibold text-fondo">
              {conv.no_leidos > 99 ? '99+' : conv.no_leidos}
            </span>
          )}
        </div>

        {/*
          TERCERA LÍNEA, y solo una: producto + etiquetas juntos.

          Fuera el chip de canal (WA/EV/AD): hoy solo entra tráfico real por
          uno, ya se dice en la cabecera del hilo, y era una pastilla en cada
          fila que no cambiaba nunca.

          Las etiquetas pasan de pastilla con nombre a PUNTO de color. Son
          las que se comían la fila en la conversación de Adil; el nombre
          sigue en el title y entero en la cabecera del hilo.
        */}
        {(productos.length > 0 || etiquetas.length > 0) && (
          <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden text-[11px] text-texto2">
            {etiquetas.length > 0 && (
              <span className="flex shrink-0 items-center gap-1">
                {etiquetas.slice(0, 4).map((e) => (
                  <span
                    key={e.id}
                    title={e.nombre}
                    className={['h-2 w-2 rounded-full', clasePunto(e.color)].join(' ')}
                  />
                ))}
              </span>
            )}
            {productos.length > 0 && (
              <span className="truncate">
                {productos.slice(0, 2).map((p, i) => (
                  <span key={p.producto}>
                    {i > 0 && <span className="opacity-40"> · </span>}
                    {nombreProducto(p.producto)}
                    {p.estado === 'pendiente' && (
                      <span className="ml-0.5 text-amber-400" title="Pedido pendiente de validar">●</span>
                    )}
                    {p.estado === 'validado' && (
                      <span className="ml-0.5 text-acento" title="Pedido validado">✓</span>
                    )}
                  </span>
                ))}
                {productos.length > 2 && <span className="opacity-60"> +{productos.length - 2}</span>}
              </span>
            )}
          </div>
        )}
      </div>

      {/*
        ACCIONES. Calladas hasta que las buscas: en reposo solo se ve lo que
        está ENCENDIDO (fijada, favorita, comprado). El resto aparece al pasar
        por encima o al llegar con el teclado.

        `acciones-fila` las deja siempre visibles en pantallas sin hover, que
        es donde no hay forma de descubrirlas de otra manera. Ver index.css.
      */}
      <div className="flex shrink-0 items-center gap-0.5 self-start">
        <button
          onClick={(e) => { e.stopPropagation(); fijada.mutate({ clienteId: conv.cliente_id, valor: !conv.fijada }) }}
          className={[
            'rounded p-1 transition-colors',
            conv.fijada ? 'text-acento' : 'acciones-fila text-texto2/50 hover:text-texto2',
          ].join(' ')}
          aria-label={conv.fijada ? 'Dejar de fijar' : 'Fijar arriba'}
          aria-pressed={!!conv.fijada}
          title={conv.fijada ? 'Dejar de fijar' : 'Fijar arriba'}
        >
          <Pin className={['h-4 w-4', conv.fijada ? 'fill-current' : ''].join(' ')} />
        </button>

        <button
          onClick={(e) => { e.stopPropagation(); favorita.mutate({ clienteId: conv.cliente_id, valor: !conv.favorita }) }}
          className={[
            'rounded p-1 transition-colors',
            conv.favorita ? 'text-amber-400' : 'acciones-fila text-texto2/50 hover:text-texto2',
          ].join(' ')}
          aria-label={conv.favorita ? 'Quitar de favoritos' : 'Marcar como favorita'}
          aria-pressed={!!conv.favorita}
          title={conv.favorita ? 'Quitar de favoritos' : 'Marcar como favorita'}
        >
          <Star className={['h-4 w-4', conv.favorita ? 'fill-current' : ''].join(' ')} />
        </button>

        {/* El carrito se pinta solo si hay pedido; si no, se comporta como
            las otras acciones y asoma al pasar por encima. Esa lógica vive
            dentro del componente, que es quien sabe en qué estado está. */}
        <CarritoPedido conv={conv} compacto />
      </div>
    </div>
  )
}



/**
 * Filas que no se pueden abrir (sin cliente_id o sin canal). No se pintan
 * en la lista para que nadie pinche en un hilo muerto, pero SÍ se dice que
 * están: esconderlas del todo convierte un dato roto en un misterio.
 */
function AvisoCorruptas() {
  const corruptas = useConversacionesCorruptas()
  if (!corruptas.length) return null
  return (
    <div className="mx-2 mt-2 rounded-lg bg-alerta/10 px-3 py-2 text-[11px] text-alerta">
      <strong>
        {corruptas.length === 1
          ? '1 conversación corrupta oculta'
          : `${corruptas.length} conversaciones corruptas ocultas`}
      </strong>
      <span className="block opacity-80">
        No se pueden abrir y se han apartado de la lista. Filas:{' '}
        {corruptas.map((c) => `#${c.id} (${motivoCorrupta(c)})`).join(', ')}
      </span>
    </div>
  )
}
