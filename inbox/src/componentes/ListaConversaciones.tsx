import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useNavigate, useParams } from 'react-router-dom'
import { Star, Pin, BotOff, Bookmark, BookmarkX, AlertTriangle } from 'lucide-react'
import { useConversaciones, useCanales, usePonerFavorita, usePonerFijada , useConversacionesCorruptas, motivoCorrupta, useMarcas, usePonerMarca } from '@/hooks/datos'
import { mariaAtiende, distintivo } from '@/lib/canales'
import { useUI } from '@/store/ui'
import { clasePunto } from '@/lib/colores'
import { productosDe, nombreProducto } from '@/lib/productos'
import { horaLista, iniciales, colorAvatar, resumen, telefonoLegible } from '@/lib/formato'
import { EsqueletoLista, Vacio } from './Esqueletos'
import { FiltrosLista, aplicarFiltros } from './FiltrosLista'
import { ResultadosMensajes } from './ResultadosMensajes'
import { MINIMO_BUSQUEDA } from '@/hooks/useBuscarMensajes'
import { IconoEstado } from './EstadoConv'
import { CarritoPedido } from './CarritoPedido'
import { escaladaAbierta, type Conversacion, type Canal } from '@/tipos'

const TITULO_VACIO: Record<string, string> = {
  bandeja: 'TodavÃ­a no hay conversaciones',
  favoritas: 'Ninguna conversaciÃ³n marcada',
  silenciadas: 'Ninguna conversaciÃ³n silenciada',
  bloqueadas: 'NingÃºn cliente bloqueado',
}

export function ListaConversaciones() {
  const { data: conversaciones, isPending, error } = useConversaciones()
  const { data: canales } = useCanales()
  const { busqueda, resaltado, setResaltado, bandeja, etiquetaFiltro,
          productoFiltro, estadoProductoFiltro, pedidoFiltro, canalFiltro, soloNoLeidas,
          soloEscaladas,
          anclaLista, setAnclaLista, ultimaAbierta, setUltimaAbierta,
          deslizada, setDeslizada } = useUI()
  const marcas = useMarcas()
  const marcar = usePonerMarca()
  const navegar = useNavigate()
  const { clienteId } = useParams()
  const contenedor = useRef<HTMLDivElement>(null)
  const saltarAjuste = useRef(false)
  const yaRestaurado = useRef(false)

  // Con "Todos" hay que poder distinguir de quÃ© nÃºmero es cada
  // conversaciÃ³n; con un canal elegido, esa etiqueta serÃ­a ruido idÃ©ntico
  // en las 183 filas.
  const mezclando = canalFiltro === null
  const porCanal = useMemo(() => {
    const m = new Map<number, Canal>()
    for (const c of canales ?? []) m.set(c.id, c)
    return m
  }, [canales])

  const filtradas = useMemo(
    () => aplicarFiltros(conversaciones ?? [],
      { bandeja, etiquetaFiltro, canalFiltro, productoFiltro, estadoProductoFiltro, pedidoFiltro, soloNoLeidas, soloEscaladas, busqueda }),
    [conversaciones, bandeja, etiquetaFiltro, canalFiltro, productoFiltro, estadoProductoFiltro, pedidoFiltro, soloNoLeidas, soloEscaladas, busqueda],
  )

  const virtual = useVirtualizer({
    count: filtradas.length,
    getScrollElement: () => contenedor.current,
    estimateSize: () => 76,
    overscan: 8,
    // Las filas NO miden todas lo mismo: una con producto y etiquetas ocupa
    // tres lÃ­neas y una sin nada, dos. Con la altura fija en 76 px, las de
    // tres se salÃ­an de su hueco y se comÃ­an la de abajo â€” eso era el
    // "se amontonan", y el separador solo lo disimulaba. MidiÃ©ndolas de
    // verdad, cada una ocupa lo suyo.
    measureElement: (el) => el.getBoundingClientRect().height,
  })

  // Que el resaltado del TECLADO quede a la vista.
  //
  // `saltarAjuste` existe porque pulsar una fila tambiÃ©n mueve el resaltado,
  // y entonces esto llamaba a scrollToIndex sobre una lista aÃºn a medio
  // medir: la lista se desplazaba 442 px en el momento de abrir, antes
  // siquiera de volver. Con A/D sÃ­ hace falta; con el ratÃ³n no.
  useEffect(() => {
    if (saltarAjuste.current) { saltarAjuste.current = false; return }
    if (filtradas.length) virtual.scrollToIndex(resaltado, { align: 'auto' })
  }, [resaltado, filtradas.length, virtual])

  /**
   * Vuelve a dejar la lista donde estaba, con la conversaciÃ³n que abriste en
   * el mismo punto de la pantalla.
   *
   * No fija un scrollTop: MIDE dÃ³nde ha quedado la fila y corrige la
   * diferencia, repitiendo unos fotogramas. Las filas se miden despuÃ©s de
   * pintarse (measureElement), asÃ­ que un scrollTop puesto de golpe apunta a
   * una fila distinta un instante despuÃ©s â€” que es justo el salto que
   * habÃ­a. Corrigiendo contra la posiciÃ³n real, da igual cuÃ¡ndo terminen de
   * medirse: converge solo.
   */
  const restaurarAncla = useCallback(() => {
    const el = contenedor.current
    const ancla = anclaLista
    if (!el || !ancla) return

    const idx = filtradas.findIndex((c) => c.cliente_id === ancla.clienteId)
    if (idx < 0) return          // ya no estÃ¡ en la lista (otro filtro): no se toca

    let intentos = 0
    const ajustar = () => {
      const c = contenedor.current
      if (!c) return
      const fila = c.querySelector<HTMLElement>(`[data-cliente="${CSS.escape(ancla.clienteId)}"]`)
      if (!fila) {
        // TodavÃ­a no estÃ¡ pintada: el virtualizador no la tiene en pantalla.
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

  // Al volver a la lista (deja de haber conversaciÃ³n abierta), restaurar UNA
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
          pulsar la lupa. AquÃ­ tenÃ­a una fila propia de 52 px ocupados todo
          el dÃ­a para algo que se usa a ratos. */}
      <FiltrosLista conversaciones={conversaciones ?? []} />

      <AvisoCorruptas />

      <div ref={contenedor} className="flex-1 overflow-y-auto">
        {filtradas.length === 0 ? (
          // Con bÃºsqueda NO se dice Â«sin resultadosÂ» a secas: puede que no
          // haya conversaciones que casen y sÃ­ mensajes, que van justo
          // debajo. Decir que no hay nada teniendo doce resultados abajo es
          // la clase de mentira que hace que se deje de usar el buscador.
          busqueda.trim().length >= MINIMO_BUSQUEDA ? null : (
            <Vacio
              titulo={busqueda ? 'Sin resultados' : TITULO_VACIO[bandeja]}
              detalle={!busqueda && bandeja === 'bandeja' ? undefined : 'Prueba a quitar los filtros.'}
            />
          )
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
                  // Sin `height`: la mide measureElement. Fijarla aquÃ­ serÃ­a
                  // volver al problema â€” el hueco dirÃ­a 76 y el contenido 86.
                  style={{
                    position: 'absolute', top: 0, left: 0, width: '100%',
                    transform: `translateY(${v.start}px)`,
                  }}
                >
                  <Fila
                    conv={c}
                    canal={mezclando ? porCanal.get(c.canal_id ?? -1) : undefined}
                    // Esta SÃ va siempre, mezclando o no: que MarÃ­a estÃ©
                    // callada en el nÃºmero no depende de cÃ³mo filtres.
                    callada={!mariaAtiende(porCanal.get(c.canal_id ?? -1))}
                    activa={c.cliente_id === clienteId}
                    ultima={c.cliente_id === ultimaAbierta && c.cliente_id !== clienteId}
                    resaltada={v.index === resaltado}
                    marcada={marcas.has(c.id)}
                    abierta={deslizada === c.cliente_id}
                    onDeslizar={(destapada) => setDeslizada(destapada ? c.cliente_id : null)}
                    // La marca es POR CANAL, asÃ­ que necesita saber de quÃ©
                    // nÃºmero es esta conversaciÃ³n. Sin `canal_id` la fila ni
                    // siquiera llega hasta aquÃ­ â€” `motivoCorrupta` la aparta.
                    onMarcar={() => {
                      if (c.canal_id == null) return
                      marcar.mutate({
                        canalId: c.canal_id,
                        conversacionId: marcas.has(c.id) ? null : c.id,
                      })
                      setDeslizada(null)
                    }}
                    onClick={(el) => {
                      // El ancla se toma AQUÃ, con la fila todavÃ­a en su
                      // sitio: despuÃ©s de navegar ya es tarde.
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

        {/*
          Y DEBAJO, lo que se encontrÃ³ DENTRO de los mensajes.

          Va dentro del mismo contenedor con scroll para que se llegue a ello
          bajando, como en WhatsApp. Pregunta al servidor, asÃ­ que alcanza los
          16 000 mensajes y no solo lo que hay cargado.
        */}
        <ResultadosMensajes termino={busqueda} conversaciones={conversaciones ?? []} />
      </div>
    </div>
  )
}

/** Lo que se destapa al deslizar. Fijo, para que el gesto tenga un tope. */
const ANCHO_MARCA = 76

export function Fila({
  conv, canal, callada, activa, ultima, resaltada, marcada, abierta,
  onClick, onMarcar, onDeslizar,
}: {
  conv: Conversacion
  /** Solo llega si estÃ¡s viendo todos los canales mezclados. */
  canal?: Canal
  /** MarÃ­a estÃ¡ pausada en el canal de esta conversaciÃ³n. */
  callada: boolean
  activa: boolean
  /** La Ãºltima que abriste, para localizarla de un vistazo al volver. */
  ultima: boolean
  resaltada: boolean
  /** Es la marca de Â«revisado hasta aquÃ­Â» de su canal. */
  marcada: boolean
  /** Tiene el panel de la marca destapado. */
  abierta: boolean
  onClick: (e: React.MouseEvent) => void
  onMarcar: () => void
  onDeslizar: (destapada: boolean) => void
}) {
  const favorita = usePonerFavorita()
  const fijada = usePonerFijada()
  const etiquetas = conv.etiquetas ?? []
  const productos = productosDe(conv)
  // Sale de la conversaciÃ³n y no de una prop, al revÃ©s que `callada`: eso
  // es del CANAL y hay que traÃ©rselo de fuera; esto viaja en la propia fila.
  const escalada = escaladaAbierta(conv)

  /*
    EL GESTO DE DESLIZAR.

    Con eventos de PUNTERO, no de tacto: asÃ­ el mismo cÃ³digo vale para el
    dedo en el mÃ³vil y para arrastrar con el ratÃ³n en el PC. Con `touchstart`
    la marca solo existirÃ­a en el mÃ³vil, y se pidiÃ³ poder usarla en los dos.

    Lo delicado es no robarle el scroll a la lista. Hasta que el puntero no
    se ha movido 8 px no se decide nada; ahÃ­ se mira quÃ© eje manda y, si
    manda el vertical, el gesto se ABANDONA y la lista scrollea como
    siempre. Solo si manda el horizontal se captura el puntero. Al revÃ©s
    â€”capturar primero y decidir despuÃ©sâ€” la lista se queda pegada en cuanto
    rozas una fila, que en una lista de 341 es inaceptable.
  */
  const [arrastre, setArrastre] = useState<number | null>(null)
  const gesto = useRef<{ x: number; y: number; eje: '?' | 'x' } | null>(null)
  // Un arrastre horizontal termina soltando ENCIMA de la fila, y eso el
  // navegador lo cuenta como un clic. Sin esta bandera, deslizar abrirÃ­a
  // ademÃ¡s la conversaciÃ³n.
  const arrastrado = useRef(false)

  const x = arrastre ?? (abierta ? -ANCHO_MARCA : 0)

  const empezar = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // Se limpia AQUÃ, al empezar cada gesto, y no solo al tragarse el clic:
    // un `pointercancel` (el navegador se queda el gesto, entra una llamada,
    // cambias de app) termina sin clic y dejarÃ­a la bandera puesta. Entonces
    // el siguiente toque, uno legÃ­timo, se lo comerÃ­a este mismo guardia y
    // la conversaciÃ³n no abrirÃ­a â€” un fallo que solo aparece a ratos y que
    // nadie sabrÃ­a reproducir.
    arrastrado.current = false
    gesto.current = { x: e.clientX, y: e.clientY, eje: '?' }
  }

  const mover = (e: React.PointerEvent) => {
    const g = gesto.current
    if (!g) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (g.eje === '?') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      if (Math.abs(dy) >= Math.abs(dx)) { gesto.current = null; return }   // es scroll, no es nuestro
      g.eje = 'x'
      arrastrado.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    const base = abierta ? -ANCHO_MARCA : 0
    setArrastre(Math.max(-ANCHO_MARCA, Math.min(0, base + dx)))
  }

  const soltar = (e: React.PointerEvent) => {
    const g = gesto.current
    gesto.current = null
    if (g?.eje === 'x') {
      soltarPuntero(e)
      // El medio decide: pasado el medio se queda destapada, sin llegar
      // vuelve a su sitio.
      onDeslizar((arrastre ?? 0) < -ANCHO_MARCA / 2)
    }
    setArrastre(null)
  }

  /*
    `pointercancel` NO es `pointerup`, y tratarlos igual estaba mal.

    Cancelar significa que el navegador te ha quitado el gesto a media
    faena: entra una llamada, cambias de app, el sistema decide que en
    realidad era un scroll. El dedo nunca llegÃ³ a decidir nada. Si aquÃ­ se
    llamara a `onDeslizar`, un gesto que el usuario no terminÃ³ dejarÃ­a el
    panel destapado, y encima sin el clic que lo cerrarÃ­a despuÃ©s.

    Cancelar deshace: se suelta el arrastre y la fila vuelve al estado que
    ya tenÃ­a.
  */
  const cancelar = (e: React.PointerEvent) => {
    const g = gesto.current
    gesto.current = null
    if (g?.eje === 'x') soltarPuntero(e)
    setArrastre(null)
  }

  const soltarPuntero = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const pulsar = (e: React.MouseEvent) => {
    if (arrastrado.current) { arrastrado.current = false; return }
    // Con el panel destapado, tocar la fila lo cierra. Abrir la conversaciÃ³n
    // con el botÃ³n de la marca a la vista serÃ­a un salto que nadie ha pedido.
    if (abierta) { onDeslizar(false); return }
    onClick(e)
  }

  return (
    /*
      Tres capas: el recorte fuera, el botÃ³n de la marca al fondo y la fila
      encima, que es la Ãºnica que se mueve. El separador y el `group` viven
      en el RECORTE, no en la fila: si viajaran con ella, la lÃ­nea de abajo
      se desplazarÃ­a con el dedo y el hover se perderÃ­a a mitad del gesto.
    */
    <div className="group relative overflow-hidden border-b border-borde/60">
      <div className="absolute inset-y-0 right-0 flex">
        <button
          onClick={(e) => { e.stopPropagation(); onMarcar() }}
          // Fuera del recorrido del tabulador mientras estÃ¡ tapado: si no,
          // el teclado se pararÃ­a 341 veces en un botÃ³n que no se ve.
          tabIndex={abierta ? 0 : -1}
          className="flex w-[76px] flex-col items-center justify-center gap-1 bg-amber-400 text-[10px] font-semibold text-slate-900 transition-colors hover:bg-amber-300"
          aria-label={marcada ? 'Quitar la marca de revisado' : 'Marcar revisado hasta aquÃ­'}
        >
          {marcada ? <BookmarkX className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />}
          {marcada ? 'Quitar' : 'Marcar'}
        </button>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={pulsar}
        onPointerDown={empezar}
        onPointerMove={mover}
        onPointerUp={soltar}
        onPointerCancel={cancelar}
        // El teclado tambiÃ©n abre, y tambiÃ©n tiene que dejar el ancla puesta:
        // `onClick` la calcula desde currentTarget, que aquÃ­ es la misma fila.
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pulsar(e as unknown as React.MouseEvent) }
        }}
        style={{
          transform: x ? `translateX(${x}px)` : undefined,
          // Sin transiciÃ³n mientras el puntero manda: el retardo se notarÃ­a
          // como que la fila va detrÃ¡s del dedo. Al soltar, sÃ­.
          transition: arrastre === null ? 'transform .18s ease' : 'none',
          // El scroll vertical se lo queda el navegador; el horizontal, esto.
          touchAction: 'pan-y',
        }}
        className={[
          'relative flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left',
          // `bg-panel` es el ÃšNICO fondo de la fila, y tiene que ser opaco:
          // es lo que tapa el botÃ³n de la marca mientras la fila estÃ¡ en su
          // sitio. Los estados (activa, resaltada, hover) NO se ponen aquÃ­
          // como un `bg-*` mÃ¡s: dos clases de fondo en el mismo elemento las
          // resuelve Tailwind por el orden de su hoja de estilos, no por el
          // orden en que las escribas, asÃ­ que cuÃ¡l gana es una loterÃ­a. Van
          // en capas, justo debajo.
          'bg-panel',
        ].join(' ')}
      >
        {/*
          LAS CAPAS DE COLOR, de abajo arriba: estado de la fila y luego la
          marca. Van en `span` propios y no en el fondo porque el fondo tiene
          que quedarse opaco (ver arriba), y con `pointer-events-none` para
          que no le roben el gesto de deslizar a la fila.

          `group-hover` y no `hover` porque el `group` vive en el recorte, que
          es quien no se mueve: colgado de la fila, el hover se perderÃ­a en
          cuanto la fila se desplazara bajo el cursor.
        */}
        <span
          aria-hidden
          className={[
            'pointer-events-none absolute inset-0',
            activa ? 'bg-panel2' : resaltada ? 'bg-panel2/50' : 'group-hover:bg-panel2/30',
          ].join(' ')}
        />

        {/*
          Amarillo si es la marca; si no, el tinte flojo de la Ãºltima abierta.

          La marca gana a Â«Ãºltima abiertaÂ» a propÃ³sito: son dos cosas
          distintas â€”por dÃ³nde ibas repasando y quÃ© abriste la Ãºltima vezâ€” y
          si coinciden, la que hay que ver es la marca.
        */}
        {(marcada || ultima) && (
          <>
            <span
              aria-hidden
              className={['pointer-events-none absolute inset-0', marcada ? 'bg-amber-400/[0.13]' : 'bg-acento/[0.07]'].join(' ')}
            />
            <span
              aria-hidden
              className={['pointer-events-none absolute inset-y-0 left-0 w-[3px] rounded-r', marcada ? 'bg-amber-400' : 'bg-acento/70'].join(' ')}
            />
          </>
        )}

        <div
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
          style={{ background: colorAvatar(conv.cliente_id) }}
        >
          {iniciales(conv.nombre, conv.cliente_id)}
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            {/*
              EL NÃšMERO manda; el nombre de WhatsApp pasa detrÃ¡s.

              El nombre lo pone el cliente y lo cambia cuando quiere. El
              nÃºmero es el `cliente_id`, la identidad de verdad (regla 3), y
              es lo que hace falta para buscar, para cuadrar un pedido y para
              el `curl` de la pausa. Por eso se lleva el peso visual y el
              nombre se queda como pista.

              El nÃºmero NO trunca y el nombre SÃ: si en un mÃ³vil estrecho
              tiene que ceder alguno, cede el que no identifica a nadie.
              El `title` lleva el nÃºmero crudo, sin agrupar, que es el que se
              copia y se pega.
            */}
            <span className="shrink-0 font-medium tabular-nums" title={conv.cliente_id}>
              {telefonoLegible(conv.cliente_id)}
            </span>
            {conv.nombre && (
              <span className="min-w-0 flex-1 truncate text-xs text-texto2">{conv.nombre}</span>
            )}

            {/*
              LOS DISTINTIVOS, todos a la derecha.

              Estaban a la IZQUIERDA del nÃºmero y lo empujaban: el
              identificador de la conversaciÃ³n se movÃ­a de sitio segÃºn
              estuviera marcada o con el canal pausado, asÃ­ que al recorrer
              la lista los nÃºmeros no quedaban alineados y costaba leerlos
              en vertical. Ahora el nÃºmero siempre arranca en el mismo punto
              y lo que baila es el borde derecho, que no se lee.

              AQUÃ NO HAY PIN, y es a propÃ³sito. Lo habÃ­a, y salÃ­an DOS
              chinchetas por fila: esta y la del botÃ³n de fijar, que ya se
              pone verde y rellena cuando la conversaciÃ³n estÃ¡ fijada. Un
              estado se anuncia UNA vez. Se quedÃ³ el botÃ³n porque es el
              Ãºnico de los dos que ademÃ¡s sirve para desfijar; un adorno que
              no se puede pulsar no aporta nada que el botÃ³n no diga ya.

              Marcada y pausada sÃ­ siguen aquÃ­ porque sus controles no estÃ¡n
              en esta fila: la marca vive en el panel que se destapa al
              deslizar y la pausa del canal se toca desde la conversaciÃ³n.
              AhÃ­ el distintivo es la Ãºnica seÃ±al que hay, no una repeticiÃ³n.

              El canal (MX) y la HORA ya no estÃ¡n aquÃ­: se han ido abajo, a
              la columna de acciones, cada uno bajo su icono. Esta lÃ­nea es
              la que identifica al cliente y era la que mÃ¡s se apelotonaba en
              un mÃ³vil estrecho â€”nÃºmero, nombre, chip, tres iconos y horaâ€”;
              quitando los dos que no son de esta conversaciÃ³n sino de
              cuÃ¡ndo y por dÃ³nde, el nombre recupera todo el ancho que le
              sobraba.

              `ml-auto` en el grupo: lo empuja contra el borde tanto si hay
              nombre como si no.
            */}
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {/*
                ESCALADA, y la primera del grupo porque es la Ãºnica que
                significa Â«esto estÃ¡ parado esperÃ¡ndoteÂ».

                Va aquÃ­ y no abajo con las etiquetas por el mismo motivo que
                la marca y la pausa: su control no estÃ¡ en esta fila â€”se
                resuelve desde la cabecera del hiloâ€”, asÃ­ que el distintivo
                es la Ãºnica seÃ±al que hay, no una repeticiÃ³n de un botÃ³n que
                ya lo dice.

                El `title` lleva el motivo que escribiÃ³ MarÃ­a. Es texto suyo
                y puede ser cualquier cosa, asÃ­ que se enseÃ±a al pasar por
                encima y no en la fila: ocupando sitio fijo, un motivo largo
                le comerÃ­a el nombre al cliente en un mÃ³vil.
              */}
              {escalada && (
                // TriÃ¡ngulo de aviso, la misma palabra que la etiqueta roja
                // que le pone el flujo: quien vea el icono y quien filtre por
                // Â«IncidenciaÂ» tienen que entender que hablan de lo mismo.
                //
                // El title va en el <span> y no en el icono: los de lucide
                // no lo aceptan como prop y lo tiran sin decir nada.
                <span
                  title={conv.escalada_motivo
                    ? 'Incidencia: ' + conv.escalada_motivo
                    : 'Incidencia: esperando a una persona'}
                  className="flex"
                >
                  <AlertTriangle
                    className="h-3.5 w-3.5 text-alerta"
                    aria-label="Incidencia: esperando a una persona"
                  />
                </span>
              )}
              {callada && (
                <BotOff className="h-3.5 w-3.5 text-alerta" aria-label="MarÃ­a pausada en este canal" />
              )}
              {marcada && (
                <Bookmark
                  className="h-3.5 w-3.5 fill-current text-amber-400"
                  aria-label="Revisado hasta aquÃ­"
                />
              )}
            </span>
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
            TERCERA LÃNEA, y solo una: producto + etiquetas juntos.

            Fuera el chip de canal (WA/EV/AD): hoy solo entra trÃ¡fico real por
            uno, ya se dice en la cabecera del hilo, y era una pastilla en cada
            fila que no cambiaba nunca.

            Las etiquetas pasan de pastilla con nombre a PUNTO de color. Son
            las que se comÃ­an la fila en la conversaciÃ³n de Adil; el nombre
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
                      {i > 0 && <span className="opacity-40"> Â· </span>}
                      {nombreProducto(p.producto)}
                      {p.estado === 'pendiente' && (
                        <span className="ml-0.5 text-amber-400" title="Pedido pendiente de validar">â—</span>
                      )}
                      {p.estado === 'validado' && (
                        <span className="ml-0.5 text-acento" title="Pedido validado">âœ“</span>
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
          estÃ¡ ENCENDIDO (fijada, favorita, comprado). El resto aparece al pasar
          por encima o al llegar con el teclado.

          La marca NO estÃ¡ aquÃ­, vive en el panel que se destapa al deslizar.
          Por dos motivos: aquÃ­ ya hay tres iconos y en un mÃ³vil de 375 px un
          cuarto se come el sitio del mensaje; y la marca se MUEVE â€”es una
          sola en todo el canalâ€” mientras que fijar y favorita son propiedades
          de esta conversaciÃ³n y solo de esta.

          `acciones-fila` las deja siempre visibles en pantallas sin hover, que
          es donde no hay forma de descubrirlas de otra manera. Ver index.css.
        */}
        <div className="relative grid shrink-0 grid-cols-3 content-between justify-items-center gap-x-0.5 self-stretch">
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
              las otras acciones y asoma al pasar por encima. Esa lÃ³gica vive
              dentro del componente, que es quien sabe en quÃ© estado estÃ¡. */}
          <CarritoPedido conv={conv} compacto />

          {/*
            SEGUNDA FILA de la columna: la HORA bajo el favorito y el CANAL
            bajo el carrito. Antes vivÃ­an en la lÃ­nea 1, apretando al nÃºmero
            y al nombre.

            Van aquÃ­ y no sueltas en el texto porque no son datos de la
            conversaciÃ³n â€”no dicen quiÃ©n es ni quÃ© quiereâ€”, son el CUÃNDO y
            el POR DÃ“NDE. Puestas en la misma rejilla que los iconos caen
            cada una bajo el suyo y la columna derecha se lee como un
            bloque, no como cosas repartidas por la fila.

            `grid-cols-3` compartido por las dos filas es lo que garantiza
            la alineaciÃ³n: si la hora fuese un `flex` aparte, cualquier
            cambio de ancho â€”"9:05" contra "ayer"â€” la descolocarÃ­a respecto
            al icono de arriba. La celda 1 va vacÃ­a a propÃ³sito: debajo de
            la chincheta no hay nada que poner.

            `content-between` las baja al pie de la fila, a la altura del
            nombre del producto. No chocan con Ã©l: son columnas hermanas de
            un flex, asÃ­ que el producto trunca dentro de la suya y esta se
            queda con su ancho pase lo que pase.
          */}
          <span aria-hidden />
          <span className="whitespace-nowrap text-[11px] leading-none text-texto2 tabular-nums">
            {horaLista(conv.ultimo_en)}
          </span>
          {canal && (
            <span
              title={canal.nombre}
              className="whitespace-nowrap rounded px-1 py-0.5 text-[10px] font-semibold leading-none text-texto2 ring-1 ring-borde"
            >
              {distintivo(canal)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}



/**
 * Filas que no se pueden abrir (sin cliente_id o sin canal). No se pintan
 * en la lista para que nadie pinche en un hilo muerto, pero SÃ se dice que
 * estÃ¡n: esconderlas del todo convierte un dato roto en un misterio.
 */
function AvisoCorruptas() {
  const corruptas = useConversacionesCorruptas()
  if (!corruptas.length) return null
  return (
    <div className="mx-2 mt-2 rounded-lg bg-alerta/10 px-3 py-2 text-[11px] text-alerta">
      <strong>
        {corruptas.length === 1
          ? '1 conversaciÃ³n corrupta oculta'
          : `${corruptas.length} conversaciones corruptas ocultas`}
      </strong>
      <span className="block opacity-80">
        No se pueden abrir y se han apartado de la lista. Filas:{' '}
        {corruptas.map((c) => `#${c.id} (${motivoCorrupta(c)})`).join(', ')}
      </span>
    </div>
  )
}
