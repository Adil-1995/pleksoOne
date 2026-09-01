import { useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useMensajes } from '@/hooks/datos'
import { useUI } from '@/store/ui'
import { marcarLeida } from '@/lib/envio'
import { etiquetaDia, mismoDia } from '@/lib/formato'
import { Burbuja } from './Burbuja'
import { BurbujaAnuncio } from './BurbujaAnuncio'
import { EsqueletoHilo, Vacio } from './Esqueletos'
import {
  anuncioDe, esOptimista,
  type AnuncioOrigen, type Conversacion, type MensajeEnLista,
} from '@/tipos'

// Referencia estable: si esto se creara en cada render, volveriamos al bucle.
const SIN_OPTIMISTAS: MensajeEnLista[] = []

type Elemento =
  | { clase: 'dia'; clave: string; iso: string }
  | { clase: 'anuncio'; clave: string; a: AnuncioOrigen; iso: string; id: number }
  | { clase: 'msg'; clave: string; m: MensajeEnLista }

export function Hilo({ conv }: { conv: Conversacion }) {
  const { data: mensajes, isPending, error } = useMensajes(conv.cliente_id)

  // OJO con el `?? []`: si va DENTRO del selector, crea un array nuevo en cada
  // lectura del snapshot. Zustand compara por referencia, nunca coincide, y
  // React entra en bucle infinito ("Maximum update depth exceeded") que se
  // lleva la app entera por delante. El respaldo va FUERA, con una constante.
  const optimistas = useUI((s) => s.optimistas[conv.cliente_id]) ?? SIN_OPTIMISTAS
  const contenedor = useRef<HTMLDivElement>(null)

  // Al abrir, el contador a cero.
  useEffect(() => { if (conv.no_leidos > 0) marcarLeida(conv.cliente_id) }, [conv.cliente_id, conv.no_leidos])

  const elementos = useMemo<Elemento[]>(() => {
    const todos: MensajeEnLista[] = [...(mensajes ?? []), ...optimistas]
    const out: Elemento[] = []
    let anterior: string | null = null
    for (const m of todos) {
      if (!anterior || !mismoDia(anterior, m.creado)) {
        out.push({ clase: 'dia', clave: 'd' + m.creado, iso: m.creado })
        anterior = m.creado
      }
      // El anuncio va JUSTO ANTES del mensaje que lo trae, que es el orden en
      // que ocurrió: Meta enseña el mensaje automático y luego el cliente
      // escribe. Se pinta uno por cada `referral`, no solo el primero: si el
      // cliente vuelve por un anuncio distinto semanas después, ese segundo
      // anuncio explica el cambio de tema y esconderlo sería perder el porqué.
      const anuncio = esOptimista(m) ? null : anuncioDe(m)
      if (anuncio) out.push({ clase: 'anuncio', clave: 'a' + m.id, a: anuncio, iso: m.creado, id: m.id })
      out.push({ clase: 'msg', clave: 'm' + m.id, m })
    }
    return out
  }, [mensajes, optimistas])

  const virtual = useVirtualizer({
    count: elementos.length,
    getScrollElement: () => contenedor.current,
    estimateSize: (i) => {
      const c = elementos[i]?.clase
      return c === 'dia' ? 44 : c === 'anuncio' ? 150 : 76
    },
    overscan: 10,
    // Las burbujas miden lo que miden: sin esto, las imágenes descuadran todo.
    measureElement: (el) => el.getBoundingClientRect().height,
  })

  // Abajo del todo al abrir y al llegar mensajes nuevos.
  //
  // Se hace por duplicado a propósito: scrollToIndex coloca el índice, pero
  // con alturas dinámicas (imágenes que aún no han cargado) el cálculo se
  // queda corto. El scrollTop directo, en el siguiente fotograma, remata.
  useEffect(() => {
    if (!elementos.length) return
    virtual.scrollToIndex(elementos.length - 1, { align: 'end' })
    const alFinal = () => {
      const c = contenedor.current
      if (c) c.scrollTop = c.scrollHeight
    }
    const r1 = requestAnimationFrame(alFinal)
    const r2 = requestAnimationFrame(() => requestAnimationFrame(alFinal))
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2) }
  }, [elementos.length, conv.cliente_id, virtual])

  if (isPending) return <div className="fondo-hilo flex-1 overflow-hidden"><EsqueletoHilo /></div>
  if (error) return <Vacio titulo="No se pudo cargar el hilo" detalle={String(error)} />
  if (!elementos.length) {
    return (
      <div className="fondo-hilo flex-1">
        <Vacio titulo="Sin mensajes todavía" detalle="Aquí aparecerá la conversación." />
      </div>
    )
  }

  return (
    // flex-col es imprescindible: sin el, el marginTop:auto de abajo no hace
    // nada y los mensajes se quedan pegados arriba.
    <div ref={contenedor} className="fondo-hilo flex flex-1 flex-col overflow-y-auto py-3">
      {/*
        marginTop:auto  → con pocos mensajes quedan ABAJO y el hueco arriba,
        como en WhatsApp. Con `justify-end` en el contenedor, al desbordar se
        cortaría el primer mensaje; con margen automático, no.

        ANCHO COMPLETO, como WhatsApp Web. Aquí hubo un `mx-auto max-w-[800px]`
        para que el hilo no se estirase en pantalla ancha, pero centrar la
        columna deja los mensajes RECIBIDOS flotando en mitad del panel con un
        hueco enorme a su izquierda: el `justify-start` de la burbuja alinea
        contra la columna de 800px, no contra el panel. Quien manda el ancho
        es la burbuja (max-w 65%), no el contenedor.
      */}
      <div
        className="w-full"
        style={{ height: virtual.getTotalSize(), position: 'relative', marginTop: 'auto' }}
      >
        {virtual.getVirtualItems().map((v) => {
          const el = elementos[v.index]
          return (
            <div
              key={el.clave}
              data-index={v.index}
              ref={virtual.measureElement}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)` }}
            >
              {el.clase === 'dia' ? (
                <div className="flex justify-center py-2">
                  <span className="rounded-md bg-panel2/90 px-3 py-1 text-[11px] uppercase tracking-wide text-texto2">
                    {etiquetaDia(el.iso)}
                  </span>
                </div>
              ) : el.clase === 'anuncio' ? (
                <div className="py-0.5">
                  <BurbujaAnuncio a={el.a} creado={el.iso} mensajeId={el.id} />
                </div>
              ) : (
                <div className="py-0.5"><Burbuja m={el.m} /></div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
