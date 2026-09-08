import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

/**
 * ARRASTRAR PARA REORDENAR LOS ICONOS DE LA BARRA.
 *
 * EL PROBLEMA DEL MÓVIL, que es el que manda el diseño.
 *
 * La tira es `overflow-x-auto`: se desplaza en HORIZONTAL. Y arrastrar un
 * icono también es horizontal. O sea que aquí NO sirve el truco de la fila
 * de la lista —mirar qué eje manda y abandonar si es el del scroll—, porque
 * los dos gestos son el mismo eje. Cualquier umbral por distancia rompería
 * el scroll de la tira o haría el arrastre imposible.
 *
 * Así que el arrastre se ARMA CON UNA PULSACIÓN LARGA, 450 ms, el mismo
 * gesto y el mismo tiempo que ya cicla el carrito de la fila. Antes de eso,
 * el dedo desplaza la tira como siempre; y si te mueves más de 10 px antes
 * de que salte, se cancela: eso era un scroll, no un arrastre.
 *
 * Y en cuanto salta, se bloquea el scroll de verdad con un `touchmove`
 * NATIVO y `passive: false`. No vale con `touch-action` puesto al vuelo: el
 * navegador ya decidió al empezar el gesto y cambiarlo a mitad no lo
 * retira. Es el mismo motivo por el que la rueda de esta misma tira se
 * escucha de forma nativa y no con `onWheel`.
 */
const MS_PULSACION_LARGA = 450
const UMBRAL_CANCELA = 10

interface Ctx {
  posicion: (id: string) => number
  arrastrando: string | null
  empezar: (id: string, e: React.PointerEvent) => void
}
const Contexto = createContext<Ctx | null>(null)

export function BarraOrdenable({
  orden, alSoltar, children,
}: {
  orden: string[]
  alSoltar: (nuevo: string[]) => void
  children: React.ReactNode
}) {
  // El orden mientras se arrastra vive aquí: se ve moverse antes de guardar.
  const [vista, setVista] = useState<string[] | null>(null)
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const temporizador = useRef<number | null>(null)
  const origen = useRef<{ x: number; y: number } | null>(null)
  const actual = useRef<string[]>(orden)

  const lista = vista ?? orden
  actual.current = lista

  const posicion = useCallback((id: string) => {
    const i = lista.indexOf(id)
    return i < 0 ? 999 : i
  }, [lista])

  // Mientras se arrastra, el dedo NO desplaza la tira ni la página.
  useEffect(() => {
    if (!arrastrando) return
    const tragar = (e: TouchEvent) => e.preventDefault()
    document.addEventListener('touchmove', tragar, { passive: false })
    return () => document.removeEventListener('touchmove', tragar)
  }, [arrastrando])

  const cancelarEspera = () => {
    if (temporizador.current !== null) {
      window.clearTimeout(temporizador.current)
      temporizador.current = null
    }
  }

  const empezar = useCallback((id: string, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    origen.current = { x: e.clientX, y: e.clientY }
    const objetivo = e.currentTarget as HTMLElement
    cancelarEspera()
    temporizador.current = window.setTimeout(() => {
      temporizador.current = null
      // Vibración corta donde exista. En iOS no hay, y por eso el icono
      // además se levanta visualmente: el aviso tiene que llegar siempre.
      try { navigator.vibrate?.(15) } catch { /* da igual */ }
      setArrastrando(id)
      setVista(actual.current)
      try { objetivo.setPointerCapture(e.pointerId) } catch { /* da igual */ }
    }, MS_PULSACION_LARGA)
  }, [])

  const mover = (e: React.PointerEvent) => {
    // Antes de armarse: si el dedo se mueve, era un scroll de la tira.
    if (temporizador.current !== null) {
      const o = origen.current
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > UMBRAL_CANCELA) cancelarEspera()
      return
    }
    if (!arrastrando) return

    // LA TIRA SE DESPLAZA SOLA AL LLEGAR A UN BORDE.
    //
    // Sin esto no se puede mover un icono más allá de lo que se ve, que en
    // un móvil de 375 px son cinco de once: el destino está fuera de la
    // parte visible, `elementFromPoint` no lo encuentra y el arrastre
    // parece que no hace nada. Es justo el caso de llevarse un filtro al
    // principio de la tira estando al final.
    const caja = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-orden-id]')
      ?.closest<HTMLElement>('.overflow-x-auto')
    if (caja) {
      const r = caja.getBoundingClientRect()
      const BORDE = 48, PASO = 12
      if (e.clientX < r.left + BORDE) caja.scrollLeft -= PASO
      else if (e.clientX > r.right - BORDE) caja.scrollLeft += PASO
    }

    // Sobre qué icono está el dedo. `elementFromPoint` y no las coordenadas
    // de cada caja: con la tira desplazándose, las cajas se mueven y las
    // coordenadas guardadas mienten.
    const bajo = document.elementFromPoint(e.clientX, e.clientY)
    const destino = bajo?.closest('[data-orden-id]')?.getAttribute('data-orden-id')
    if (!destino || destino === arrastrando) return

    const l = [...actual.current]
    const de = l.indexOf(arrastrando)
    const a = l.indexOf(destino)
    if (de < 0 || a < 0) return
    l.splice(a, 0, ...l.splice(de, 1))
    setVista(l)
  }

  const soltar = () => {
    cancelarEspera()
    if (!arrastrando) return
    setArrastrando(null)
    const l = actual.current
    setVista(null)
    if (l.join() !== orden.join()) alSoltar(l)
  }

  return (
    <Contexto.Provider value={{ posicion, arrastrando, empezar }}>
      <div onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar} className="contents">
        {children}
      </div>
    </Contexto.Provider>
  )
}

/**
 * Envuelve UN icono de la barra.
 *
 * No reconstruye el JSX de los botones: solo los coloca con `order` de CSS
 * —la tira ya es flex— y les añade el gesto. Así los once iconos siguen
 * siendo exactamente los mismos botones de antes, con sus contadores y sus
 * títulos, y esto no puede romper ninguno.
 */
export function Reordenable({ id, children }: { id: string; children: React.ReactNode }) {
  const ctx = useContext(Contexto)
  const arrastrado = useRef(false)

  if (!ctx) return <>{children}</>
  const activo = ctx.arrastrando === id

  return (
    <div
      data-orden-id={id}
      style={{ order: ctx.posicion(id) }}
      onPointerDown={(e) => { arrastrado.current = false; ctx.empezar(id, e) }}
      onPointerUp={() => { if (ctx.arrastrando === id) arrastrado.current = true }}
      // Un arrastre termina soltando encima del icono, y el navegador lo
      // cuenta como clic. Sin esto, recolocar un filtro además lo activaría.
      onClickCapture={(e) => {
        if (arrastrado.current) { e.preventDefault(); e.stopPropagation(); arrastrado.current = false }
      }}
      className={[
        'flex shrink-0 rounded-full transition-transform',
        activo ? 'z-10 scale-110 opacity-80 ring-2 ring-acento' : '',
        ctx.arrastrando && !activo ? 'opacity-60' : '',
      ].join(' ')}
    >
      {children}
    </div>
  )
}
