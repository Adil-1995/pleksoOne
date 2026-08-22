import { useRef, useState } from 'react'
import { ShoppingCart, Loader2 } from 'lucide-react'
import { useMarcarProducto } from '@/hooks/datos'
import {
  estadoPedidoDe, nombreProducto, productosDe, siguienteEstado, PINTA_PEDIDO,
} from '@/lib/productos'
import type { Conversacion, EstadoProducto } from '@/tipos'

const MS_PULSACION_LARGA = 450

/**
 * El carrito de la lista, con sus tres estados.
 *
 *   sin pedido  → sin icono (solo asoma al pasar por encima)
 *   pendiente   → carrito AMARILLO. Lo pone el flujo al detectar el pedido.
 *   validado    → carrito VERDE. Lo pone una persona.
 *
 * Se cicla con DOBLE CLIC en escritorio y con PULSACIÓN LARGA en el móvil.
 * No es capricho: en iOS el doble toque no llega como dblclick —lo consume
 * el navegador para hacer zoom— así que un solo gesto no cubre las dos
 * plataformas. Un clic simple no vale para ninguna: la fila entera abre la
 * conversación y cambiar un pedido sin querer sería peor que el ruido.
 */
export function CarritoPedido({
  conv, compacto = false,
}: {
  conv: Conversacion
  compacto?: boolean
}) {
  const marcar = useMarcarProducto()
  const [latiendo, setLatiendo] = useState(false)
  const temporizador = useRef<number | null>(null)
  const yaDisparado = useRef(false)
  const origen = useRef<{ x: number; y: number } | null>(null)

  const productos = productosDe(conv)
  const estado = estadoPedidoDe(productos)
  const pinta = PINTA_PEDIDO[estado]
  const hayPedido = estado !== 'interesado'

  function avisar() {
    // Vibración corta donde exista. En iOS NO existe la Vibration API, así
    // que el latido del icono es el único aviso que llega a todas partes:
    // por eso va siempre, no solo cuando falla la vibración.
    try { navigator.vibrate?.(15) } catch { /* da igual */ }
    setLatiendo(true)
    window.setTimeout(() => setLatiendo(false), 320)
  }

  /**
   * Cicla el estado. Con varios productos mueve TODOS al mismo sitio: el
   * icono de la fila representa la conversación entera, y dejar unos en un
   * estado y otros en otro haría que el icono mintiera. Para tocarlos uno a
   * uno está el menú de la conversación.
   */
  function ciclar() {
    const nuevo: EstadoProducto = siguienteEstado(estado)
    if (!productos.length) return          // sin productos no hay nada que ciclar
    avisar()
    for (const p of productos) {
      if (p.estado === nuevo) continue
      marcar.mutate({ conversacionId: conv.id, producto: p.producto, estado: nuevo })
    }
  }

  // ── Pulsación larga (móvil) ────────────────────────────────────────────
  function empezarPulsacion(e: React.PointerEvent) {
    yaDisparado.current = false
    origen.current = { x: e.clientX, y: e.clientY }
    temporizador.current = window.setTimeout(() => {
      temporizador.current = null
      yaDisparado.current = true
      ciclar()
    }, MS_PULSACION_LARGA)
  }

  function cancelarPulsacion() {
    if (temporizador.current !== null) {
      window.clearTimeout(temporizador.current)
      temporizador.current = null
    }
  }

  /**
   * Si el dedo se mueve, no era una pulsación: era el principio de un
   * scroll. Se mide por distancia y no con `onPointerLeave`, que en táctil
   * no llega de forma fiable — el dedo puede desplazarse varios píxeles sin
   * llegar a salir del botón, que es exactamente como empieza un arrastre.
   */
  function vigilarMovimiento(e: React.PointerEvent) {
    if (temporizador.current === null || !origen.current) return
    const dx = e.clientX - origen.current.x
    const dy = e.clientY - origen.current.y
    if (Math.hypot(dx, dy) > 10) cancelarPulsacion()
  }

  const titulo = [
    pinta.texto,
    productos.length ? productos.map((p) => nombreProducto(p.producto)).join(', ') : 'Sin productos',
    '',
    'Doble clic (o mantener pulsado) para cambiar',
  ].join('\n')

  return (
    <button
      onDoubleClick={(e) => {
        e.stopPropagation()
        // Si la pulsación larga ya cicló, el doble clic que venga detrás no
        // puede ciclar otra vez: un clic lento en escritorio dispara los dos
        // y el estado se saltaría un paso.
        if (yaDisparado.current) { yaDisparado.current = false; return }
        ciclar()
      }}
      onPointerDown={(e) => { e.stopPropagation(); empezarPulsacion(e) }}
      onPointerMove={vigilarMovimiento}
      onPointerUp={cancelarPulsacion}
      onPointerLeave={cancelarPulsacion}
      onPointerCancel={cancelarPulsacion}
      // Un clic simple no hace nada, pero tampoco puede abrir la
      // conversación: si no, mantener pulsado acabaría entrando en el hilo.
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      // NO se deshabilita mientras guarda. `ciclar()` lanza una mutación por
      // producto: la primera pondría isPending a true, el botón quedaría
      // deshabilitado y —esto es lo que muerde— un botón deshabilitado deja
      // de recibir eventos de puntero, así que la pulsación larga siguiente
      // se perdía. Además el cambio ya se ve al instante por el optimista;
      // bloquear la entrada solo lo hace parecer roto.
      disabled={!productos.length}
      aria-label={pinta.texto}
      title={titulo}
      className={[
        'rounded-full transition-colors disabled:cursor-default',
        compacto ? 'p-1' : 'p-2',
        // `select-none` y `touch-none`: sin esto, mantener pulsado en el
        // móvil selecciona texto o empieza a arrastrar la lista.
        'select-none [touch-action:none]',
        hayPedido ? pinta.color : 'acciones-fila text-texto2/50 hover:text-texto2',
        latiendo ? 'animate-latido-corto' : '',
      ].join(' ')}
    >
      {marcar.isPending
        ? <Loader2 className={(compacto ? 'h-4 w-4' : 'h-5 w-5') + ' animate-spin'} />
        : <ShoppingCart className={compacto ? 'h-4 w-4' : 'h-5 w-5'} />}
    </button>
  )
}
