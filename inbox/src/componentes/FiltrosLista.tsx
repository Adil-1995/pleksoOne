import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Star, Inbox as IconoInbox, BellOff, Ban, X, Boxes, Search, Tag, ShoppingCart, Radio, Mail,
  AlertTriangle,
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
import { escaladaAbierta, type Conversacion, type EstadoProducto } from '@/tipos'
import { useOrdenBarra } from '@/hooks/useOrdenBarra'
import { BarraOrdenable, Reordenable } from './BarraOrdenable'

/**
 * El orden de fábrica de los iconos de la tira.
 *
 * Es la lista COMPLETA de los que se pueden recolocar, y hace de referencia
 * para lo guardado: un id que ya no esté aquí se descarta, y uno nuevo se
 * añade al final aunque tengas un orden guardado de antes. Así, añadir un
 * filtro mañana no se lo esconde a quien ya haya recolocado los suyos.
 */
const ORDEN_POR_DEFECTO = [
  'bandeja:bandeja', 'bandeja:favoritas', 'bandeja:silenciadas', 'bandeja:bloqueadas',
  'etiquetas', 'producto', 'canal',
  'pedido:pendiente', 'pedido:validado',
  'sinleer', 'escaladas',
]

/**
 * Bandejas y filtros.
 *
 * Las BANDEJAS son excluyentes y definen quÃ© lista miras. Los FILTROS
 * (etiqueta, producto) se combinan encima de la bandeja elegida. Se pintan
 * distinto a propÃ³sito para que se note que no son lo mismo.
 *
 *   [Todas] [Favoritos] [Etiquetas] [Productos] Â·Â·Â·Â·Â·Â·Â·scrollÂ·Â·Â·Â·Â·Â·Â· | [Buscar]
 *   [ ReclamaciÃ³n ] [ Cliente difÃ­cil ] ...        â† solo si la despliegas
 *
 * La lupa vive FUERA del contenedor con scroll: dentro se irÃ­a con Ã©l y
 * acabarÃ­a escondida a la derecha. Y la lÃ­nea de etiquetas se pliega desde
 * su icono, asÃ­ que solo ocupa alto cuando la quieres.
 */
export function FiltrosLista({ conversaciones }: { conversaciones: Conversacion[] }) {
  const {
    bandeja, setBandeja, etiquetaFiltro, setEtiquetaFiltro, limpiarFiltros,
    productoFiltro, setProductoFiltro,
    estadoProductoFiltro, setEstadoProductoFiltro,
    busqueda, setBusqueda, buscadorAbierto, abrirBuscador, cerrarBuscador,
    etiquetasAbiertas, alternarEtiquetas, pedidoFiltro, setPedidoFiltro,
    canalFiltro, setCanalFiltro, soloNoLeidas, setSoloNoLeidas,
    soloEscaladas, setSoloEscaladas,
  } = useUI()
  const { data: etiquetas } = useEtiquetas()
  const { data: canales } = useCanales()
  // El orden de los iconos, por usuario. Ver useOrdenBarra: vive en
  // user_metadata, así que es el mismo en el móvil y en el PC.
  const { orden: ordenBarra, guardar: guardarOrden } = useOrdenBarra(ORDEN_POR_DEFECTO)
  const { canalId: canalGuardado, guardar: guardarCanal, cargado: canalCargado } = useCanalPorDefecto()

  // Solo se ofrecen canales que tengan conversaciones o estÃ©n activos: uno
  // dado de alta hace un minuto y todavÃ­a sin mensajes tiene que salir, pero
  // uno retirado hace meses y sin nada detrÃ¡s no ensucia el desplegable.
  const canalesVisibles = (canales ?? []).filter(
    (c) => c.activo || conversaciones.some((v) => v.canal_id === c.id))
  const canalElegido = canalesVisibles.find((c) => c.id === canalFiltro) ?? null

  // Al arrancar, el canal del perfil. Una sola vez: despuÃ©s manda lo que
  // toques, y si no, cambiar de canal se desharÃ­a solo al siguiente refetch.
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

  // Contadores de las pestaÃ±as de estado, sobre el producto elegido y con la
  // bandeja ya aplicada â€” si no, "Todos (45)" contarÃ­a tambiÃ©n silenciadas y
  // bloqueadas, que no estÃ¡n en la lista que estÃ¡s mirando.
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

  // Los contadores salen de lo que ya estÃ¡ cargado: ni una consulta mÃ¡s.
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

  // CuÃ¡ntas conversaciones tienen algo en cada estado de pedido. Sobre la
  // lista entera, no sobre la bandeja: son un filtro global.
  const conPendiente = conversaciones.filter(
    (c) => estadoPedidoDe(c.conversacion_productos ?? []) === 'pendiente').length
  const conValidado = conversaciones.filter(
    (c) => estadoPedidoDe(c.conversacion_productos ?? []) === 'validado').length

  // Conversaciones con algo sin leer. Sobre la lista entera y no sobre la
  // bandeja, igual que los carritos: es un filtro global.
  const conNoLeidas = conversaciones.filter((c) => c.no_leidos > 0).length

  // Conversaciones con un escalado abierto. Igual que las de arriba: sobre
  // la lista entera, porque es un filtro global.
  const conEscalada = conversaciones.filter(escaladaAbierta).length

  const hayFiltro = etiquetaFiltro !== null || bandeja !== 'bandeja' ||
                    productoFiltro !== null || pedidoFiltro !== null ||
                    canalFiltro !== null || soloNoLeidas || soloEscaladas

  return (
    <div className="border-b border-borde">
      {/*
        LÃNEA 1 â€” todas, favoritos, etiquetas, productos, y la lupa al final.

        El buscador ya no tiene fila propia. Ocupaba 52 px fijos todo el dÃ­a
        para algo que se usa un rato; ahora se despliega sobre esta misma
        lÃ­nea. Esa altura vuelve a la lista, que es lo que se mira.

        Silenciadas y bloqueadas solo asoman si hay algo dentro. Hoy no hay,
        asÃ­ que se ven los cuatro y ya estÃ¡ â€” pero si un dÃ­a bloqueas a
        alguien tiene que haber forma de llegar a Ã©l.
      */}
      {buscadorAbierto ? (
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Search className="pointer-events-none ml-1 h-4 w-4 shrink-0 text-texto2" />
          <input
            ref={campoBusqueda}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') cerrarBuscador() }}
            placeholder="Buscar por nombre, nÃºmero o mensaje"
            className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-texto2"
          />
          <button
            onClick={cerrarBuscador}
            className="shrink-0 rounded-full p-1.5 text-texto2 hover:bg-panel2 hover:text-texto"
            aria-label="Cerrar la bÃºsqueda"
            title="Cerrar la bÃºsqueda"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        // La lupa va FUERA de la tira desplazable. Dentro se irÃ­a con el
        // scroll y acabarÃ­a escondida a la derecha, que es exactamente lo
        // que ya nos pasÃ³ con el selector de producto. AquÃ­ es un hermano
        // del contenedor con scroll, asÃ­ que se queda quieta pase lo que
        // pase con los demÃ¡s.
        <div className="flex items-stretch">
          <div className="min-w-0 flex-1">
            <TiraDesplazable separador={false}>
              <BarraOrdenable orden={ordenBarra} alSoltar={guardarOrden}>

              {BANDEJAS.map(({ id, icono: Icono, texto, cuenta }) => {
                if ((id === 'silenciadas' || id === 'bloqueadas') && cuenta === 0 && bandeja !== id) return null
                const puesta = bandeja === id
                // El contador va siempre en "Todas": es el nÃºmero de
                // referencia, el que dice cuÃ¡ntas conversaciones tienes de
                // verdad. En el resto solo cuando estÃ¡ activo, para no
                // volver a la fila de cifras que nadie leÃ­a.
                const verCuenta = id === 'bandeja' || puesta
                return (
                  <Reordenable key={id} id={'bandeja:' + id}>
                  <button
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
                  </Reordenable>
                )
              })}

              {/* Abre y cierra la lÃ­nea de pastillas. AsÃ­ esa fila solo
                  ocupa alto cuando hace falta. Se queda encendido tambiÃ©n
                  con la lÃ­nea plegada si hay una etiqueta filtrando: si no,
                  el filtro seguirÃ­a puesto sin nada que lo delatara. */}
              {(etiquetas ?? []).length > 0 && (
                <Reordenable id="etiquetas">
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
                </Reordenable>
              )}

              {/* El producto es lo Ãºnico que no puede ser un icono a secas:
                  hay cuatro y no se distinguen por dibujo. Desplegable, pero
                  colapsado al icono mientras no haya ninguno elegido. */}
              {productos.length > 0 && (
                <Reordenable id="producto">
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
                    <option value="">Productoâ€¦</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>{p.nombre} ({p.conversaciones})</option>
                    ))}
                  </select>
                </label>
                </Reordenable>
              )}

              {/*
                EL CANAL, un icono mÃ¡s y el Ãºltimo de la lÃ­nea.

                Antes iba el primero y desplegado a lo ancho: "Todos los
                canales" son 17 caracteres ocupando sitio fijo para decir que
                NO hay filtro puesto, y eso empujaba al resto fuera de la
                vista. Ahora sigue el patrÃ³n de los demÃ¡s â€” icono mientras no
                filtra, y solo se ensancha cuando hay algo que contar.

                El <select> va invisible ENCIMA del botÃ³n en vez de estilarse
                Ã©l: asÃ­ el desplegable sigue siendo el nativo (la rueda de
                iOS, que es donde se usa esto) pero lo que se ve es un icono
                del mismo tamaÃ±o que los otros cuatro.
              */}
              {canalesVisibles.length > 1 && (
                <Reordenable id="canal">
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
                    {/* El cÃ³digo del canal, no su nombre: es lo que hace que
                        no se te olvide que tienes un filtro puesto sin
                        volver a comerse la lÃ­nea. */}
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
                </Reordenable>
              )}

              {/* Los dos carritos. El color ES el filtro: amarillo lo que la
                  mÃ¡quina ha detectado y falta validar, verde lo confirmado.
                  Se ocultan si no hay ninguno de ese tipo â€” un filtro que
                  siempre darÃ­a cero no merece sitio en la tira. */}
              {([['pendiente', conPendiente], ['validado', conValidado]] as const).map(
                ([est, cuenta]) => cuenta === 0 && pedidoFiltro !== est ? null : (
                  <Reordenable key={est} id={'pedido:' + est}>
                  <button
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
                  </Reordenable>
                ),
              )}

              {/*
                SIN LEER, justo a la derecha del carrito verde.

                Es el mismo patrÃ³n que los carritos: un icono que filtra la
                lista al pulsarlo y se enciende mientras estÃ¡ puesto. El dato
                es el `no_leidos` que ya escribe el flujo y que ya pinta el
                contador de cada fila â€” no hay dato nuevo ni consulta nueva.

                CUENTA CONVERSACIONES, no mensajes. Es lo que cuentan los
                carritos y las bandejas, y es lo que hace que el nÃºmero
                cuadre con las filas que ves al pulsarlo: si dijera 23
                mensajes y salieran 9 filas, el nÃºmero no servirÃ­a para nada.

                EL NÃšMERO SE VE SIEMPRE, no solo con el filtro puesto â€” al
                revÃ©s que los carritos, y a propÃ³sito. Los carritos son un
                cajÃ³n que miras cuando te toca; esto es lo que te dice si
                tienes trabajo pendiente ahora mismo, y para eso hay que
                leerlo sin pulsar nada.

                Y NO SE ESCONDE CON CERO, otra vez al revÃ©s que los carritos.
                Un icono que desaparece cuando no hay nada es indistinguible
                de un icono roto, y ese sitio vacÃ­o es justo donde vas a
                mirar. Con cero se queda apagado y sin nÃºmero: dice Â«todo
                leÃ­doÂ», que tambiÃ©n es una respuesta.
              */}
              <Reordenable id="sinleer">
              <button
                onClick={() => setSoloNoLeidas(!soloNoLeidas)}
                title={'Sin leer (' + conNoLeidas + ')\n' +
                       'Solo las conversaciones con mensajes que nadie ha abierto.'}
                aria-label="Sin leer"
                aria-pressed={soloNoLeidas}
                className={[
                  'flex shrink-0 items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium transition-colors',
                  soloNoLeidas
                    ? 'bg-acento text-fondo'
                    : conNoLeidas > 0
                      ? 'bg-panel2 text-acento hover:brightness-125'
                      : 'bg-panel2 text-texto2 hover:text-texto',
                ].join(' ')}
              >
                <Mail className="h-4 w-4" />
                {conNoLeidas > 0 && <span className="tabular-nums">{conNoLeidas}</span>}
              </button>
              </Reordenable>

              {/*
                ESCALADAS, pegado al de sin leer. Los dos contestan a Â«Â¿tengo
                trabajo ahora mismo?Â» y por eso van juntos, pero no dicen lo
                mismo: sin leer es que nadie lo ha abierto; escalada es que
                MARÃA SE HA RENDIDO y se ha callado con el cliente delante.

                POR QUÃ‰ ESTE ES EL BOTÃ“N QUE MÃS SE TIENE QUE VER. Desde que
                el escalado calla a MarÃ­a, una conversaciÃ³n escalada no da
                ninguna seÃ±al por sÃ­ sola: el cliente pregunta, nadie
                contesta y la fila ni siquiera sube. El Ãºnico aviso era el
                Telegram, y un aviso que hay que estar mirando no es una red
                de seguridad. Este nÃºmero es la red.

                EN ROJO Y NO EN VERDE, al revÃ©s que los otros filtros. El
                acento se usa para lo que va bien; esto es lo que estÃ¡
                parado. Encendido, se pinta el botÃ³n entero de rojo para que
                se distinga de un vistazo de tener puesto cualquier otro
                filtro.

                EL NÃšMERO SIEMPRE Y SIN ESCONDERSE CON CERO, por lo mismo
                que en sin leer: un icono que desaparece es indistinguible
                de uno roto, y cero aquÃ­ es una respuesta que se quiere leer
                â€”Â«no hay nadie esperandoÂ»â€”, no una ausencia.
              */}
              <Reordenable id="escaladas">
              <button
                onClick={() => setSoloEscaladas(!soloEscaladas)}
                title={'Escaladas (' + conEscalada + ')\n' +
                       'MarÃ­a se callÃ³ y dejÃ³ la conversaciÃ³n esperando a una persona.'}
                aria-label="Escaladas"
                aria-pressed={soloEscaladas}
                className={[
                  'flex shrink-0 items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium transition-colors',
                  soloEscaladas
                    ? 'bg-alerta text-fondo'
                    : conEscalada > 0
                      ? 'bg-alerta/15 text-alerta hover:bg-alerta/25'
                      : 'bg-panel2 text-texto2 hover:text-texto',
                ].join(' ')}
              >
                <AlertTriangle className="h-4 w-4" />
                {conEscalada > 0 && <span className="tabular-nums">{conEscalada}</span>}
              </button>
              </Reordenable>
              </BarraOrdenable>
            </TiraDesplazable>
          </div>

          <button
            onClick={abrirBuscador}
            title="Buscar   ( Ctrl+B )"
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
        LÃNEA 2 â€” etiquetas, con su NOMBRE al lado del color.

        Estuvieron un rato como puntos sueltos para ahorrar sitio y no habÃ­a
        forma de saber cuÃ¡l era cuÃ¡l: un color sin nombre no identifica nada
        si tienes cinco. El sitio sale de poder plegar la lÃ­nea entera desde
        el icono de la lÃ­nea 1, no de quitarles el texto.

        Plegada mientras se busca: la barra de bÃºsqueda ocupa la lÃ­nea 1 y
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
        AVISO DE FILTRO ACTIVO, con las pestaÃ±as de estado DENTRO.
        Antes eran dos filas. Van juntas porque dicen lo mismo: quÃ© estÃ¡s
        mirando. Y sigue en color, porque lo que no puede pasar es que creas
        que tienes menos conversaciones de las que hay.
      */}
      {hayFiltro && (
        <div className="border-t border-borde bg-acento/10 text-acento">
          <div className="flex items-center gap-2 px-3 py-1">
            <span className="min-w-0 flex-1 truncate text-xs">
              <strong className="font-semibold">{descripcionFiltro({
                bandeja, productoFiltro, estadoProductoFiltro, pedidoFiltro, soloNoLeidas,
                soloEscaladas,
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
 * Tira con scroll horizontal que AVISA de que hay mÃ¡s.
 *
 * La barra de scroll va oculta (en el mÃ³vil ocupa y queda fea), y sin ella
 * una tira desbordada es indistinguible de una tira completa. El degradado
 * del borde es la Ãºnica pista, asÃ­ que solo se pinta cuando de verdad hay
 * contenido fuera y desaparece al llegar al final.
 *
 * En el ORDENADOR, ademÃ¡s, hay que mover la tira a mano. Un ratÃ³n normal solo
 * genera `deltaY`, y el navegador lleva ese gesto al primer antepasado que
 * desplace en VERTICAL: la tira, que solo desplaza en horizontal, se queda
 * quieta y parece rota. El trackpad sÃ­ da `deltaX` y por eso ahÃ­ funcionaba.
 * Lo traducimos nosotros en el `wheel` de mÃ¡s abajo.
 */
function TiraDesplazable({
  children, separador = true,
}: {
  children: React.ReactNode
  /** La primera tira no lleva lÃ­nea arriba: ya la pone el buscador. */
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
    // al abrir una conversaciÃ³n en mÃ³vil, sin que la ventana se mueva.
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [medir, children])

  // La rueda vertical, convertida en desplazamiento horizontal.
  //
  // Va como listener NATIVO con `passive: false` y no como `onWheel` de React:
  // React registra `wheel` en la raÃ­z como pasivo, y en un listener pasivo el
  // `preventDefault` no hace nada (solo un aviso en consola). Sin ese
  // preventDefault, el gesto ademÃ¡s desplazarÃ­a la lista de conversaciones
  // por detrÃ¡s, y verÃ­as las dos cosas moverse a la vez.
  useEffect(() => {
    const el = caja.current
    if (!el) return
    const alRodar = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return        // no hay nada que mover
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return // el trackpad ya sabe solo

      // `deltaMode` no siempre viene en pÃ­xeles: Firefox suele mandar lÃ­neas.
      const paso = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1
      const antes = el.scrollLeft
      el.scrollLeft += e.deltaY * paso

      // Si no nos hemos movido es que ya estÃ¡bamos en un extremo. Entonces NO
      // nos tragamos el gesto: que siga su camino y desplace la lista, que es
      // lo que espera cualquiera al seguir girando la rueda.
      if (el.scrollLeft !== antes) e.preventDefault()
    }
    el.addEventListener('wheel', alRodar, { passive: false })
    return () => el.removeEventListener('wheel', alRodar)
  }, [])

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

/** Lo que estÃ¡s viendo, en una frase. Sin adivinanzas. */
function descripcionFiltro({
  bandeja, productoFiltro, estadoProductoFiltro, pedidoFiltro, soloNoLeidas, soloEscaladas,
  canal, etiqueta,
}: {
  bandeja: Bandeja
  productoFiltro: string | null
  estadoProductoFiltro: EstadoProducto | null
  pedidoFiltro: EstadoProducto | null
  soloNoLeidas: boolean
  soloEscaladas: boolean
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
  if (soloNoLeidas) trozos.push('sin leer')
  if (soloEscaladas) trozos.push('escaladas')
  if (pedidoFiltro) trozos.push(PINTA_PEDIDO[pedidoFiltro].texto.toLowerCase())
  if (etiqueta) trozos.push(`etiqueta Â«${etiqueta}Â»`)

  return trozos.length ? trozos.join(' Â· ') : 'una lista filtrada'
}

/** El filtrado en sÃ­, fuera del componente para poder probarlo aparte. */
export function aplicarFiltros(
  lista: Conversacion[],
  { bandeja, etiquetaFiltro, canalFiltro, productoFiltro, estadoProductoFiltro, pedidoFiltro, soloNoLeidas, soloEscaladas, busqueda }: {
    bandeja: Bandeja
    etiquetaFiltro: number | null
    canalFiltro: number | null
    productoFiltro: string | null
    estadoProductoFiltro: EstadoProducto | null
    pedidoFiltro: EstadoProducto | null
    soloNoLeidas: boolean
    soloEscaladas: boolean
    busqueda: string
  },
): Conversacion[] {
  let out = lista

  // 1. Bandeja. Las bloqueadas NUNCA aparecen fuera de su pestaÃ±a: si
  //    salieran en "Todas", alguien les escribirÃ­a sin entender por quÃ© falla.
  if (bandeja === 'bandeja')          out = out.filter((c) => !c.silenciada && !c.bloqueada)
  else if (bandeja === 'favoritas')   out = out.filter((c) => c.favorita && !c.bloqueada)
  else if (bandeja === 'silenciadas') out = out.filter((c) => c.silenciada && !c.bloqueada)
  else if (bandeja === 'bloqueadas')  out = out.filter((c) => c.bloqueada)

  if (etiquetaFiltro !== null) {
    out = out.filter((c) => (c.etiquetas ?? []).some((e) => e.id === etiquetaFiltro))
  }
  // 2. Canal. Va lo PRIMERO de los filtros combinables: es en quÃ© bandeja
  //    de paÃ­s estÃ¡s, y todo lo demÃ¡s se cuenta dentro de ella.
  if (canalFiltro !== null) out = out.filter((c) => c.canal_id === canalFiltro)

  // 3. Estado de pedido, para toda la lista. Se mira el estado de la
  //    CONVERSACIÃ“N (el mÃ¡s avanzado de sus productos), igual que el icono
  //    del carrito: si el icono estÃ¡ verde, tiene que salir en el filtro verde.
  if (pedidoFiltro !== null) {
    out = out.filter((c) => estadoPedidoDe(c.conversacion_productos ?? []) === pedidoFiltro)
  }

  // 4. Sin leer. Se COMBINA con el resto en vez de ser una bandeja aparte:
  //    "sin leer de MÃ©xico" o "sin leer con pedido pendiente" son preguntas
  //    Ãºtiles, y una bandeja excluyente no dejarÃ­a hacerlas.
  if (soloNoLeidas) out = out.filter((c) => c.no_leidos > 0)

  // 5. Escaladas. Se combina igual que el anterior, y ahÃ­ estÃ¡ la gracia:
  //    "escaladas sin leer" es la lista de las que ademÃ¡s nadie ha abierto,
  //    que es por donde hay que empezar.
  if (soloEscaladas) out = out.filter(escaladaAbierta)

  // 3. Producto. El estado solo se aplica DENTRO de un producto: filtrar por
  //    "comprados" sin decir de quÃ© mezclarÃ­a clientes de productos distintos
  //    y el contador de la pestaÃ±a no cuadrarÃ­a con nada.
  if (productoFiltro !== null) {
    out = out.filter((c) =>
      (c.conversacion_productos ?? []).some((p) =>
        p.producto === productoFiltro &&
        (estadoProductoFiltro === null || p.estado === estadoProductoFiltro)))
  }

  const q = busqueda.trim().toLowerCase()
  if (q) {
    // Los DÃGITOS de lo que se ha escrito, aparte. Ahora que el nÃºmero es lo
    // que se ve en la lista, se busca copiÃ¡ndolo de ahÃ­ â€”o del aviso de
    // Telegram, o del mÃ³vilâ€” y viene con `+`, espacios o guiones. Sin esto,
    // pegar Â«+52 1 559 193 7975Â» no encontraba nada mientras el nÃºmero
    // estaba delante en pantalla, y parecÃ­a que el buscador no funcionaba.
    //
    // Solo se usa si quedan 3 dÃ­gitos o mÃ¡s: con uno o dos, cualquier nÃºmero
    // los contiene y el resultado serÃ­a la lista entera.
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
