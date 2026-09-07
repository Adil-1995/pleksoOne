import { useCallback, useEffect, useMemo, useRef } from 'react'
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

  // ANCLA AL FINAL.
  //
  // Mientras `anclado` esté a true, cualquier cambio de alto del hilo vuelve a
  // pegarlo abajo. Hace falta porque el alto NO es conocido cuando se abre la
  // conversación: las burbujas se miden después de pintarse, la URL firmada de
  // cada imagen se pide por red, y el <img> va con loading="lazy" y sin alto
  // reservado. O sea que el hilo sigue creciendo cientos de milisegundos
  // después de colocar el scroll, y por eso se quedaba a media conversación.
  //
  // Esto NO carga ni un mensaje más: `useMensajes` ya se trae el hilo entero
  // (hasta 500, orden ascendente) en una sola consulta. El último mensaje ya
  // estaba descargado; lo único que faltaba era mirarlo. Egress: cero.
  const anclado = useRef(true)
  const observador = useRef<ResizeObserver | null>(null)

  const alFinal = useCallback(() => {
    const c = contenedor.current
    if (c) c.scrollTop = c.scrollHeight
  }, [])

  // Ref de callback y no un useRef normal a propósito: el div de dentro no
  // existe mientras el hilo está cargando, y con un efecto habría que adivinar
  // en qué render aparece. Así el observador se engancha justo cuando nace.
  const ponerLienzo = useCallback((el: HTMLDivElement | null) => {
    observador.current?.disconnect()
    observador.current = null
    if (!el) return
    observador.current = new ResizeObserver(() => { if (anclado.current) alFinal() })
    observador.current.observe(el)
  }, [alFinal])

  // Soltar el ancla es SOLO cosa del usuario: rueda o dedo. El evento `scroll`
  // no la suelta nunca, y no es un descuido. Cuando una imagen carga, el
  // navegador puede mover el scroll él solo y ese `scroll` diría «ya no estás
  // abajo» justo en el fotograma en que íbamos a bajar: el ancla se soltaría
  // sola y volveríamos al fallo. Lo que sí hace `scroll` es volver a anclar
  // cuando llegas al final por tu cuenta.
  const soltarAncla = useCallback(() => { anclado.current = false }, [])
  const alDesplazar = useCallback(() => {
    const c = contenedor.current
    if (c && c.scrollHeight - c.scrollTop - c.clientHeight < 40) anclado.current = true
  }, [])

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
  // Se hace por triplicado a propósito: scrollToIndex coloca el índice, pero
  // con alturas dinámicas (imágenes que aún no han cargado) el cálculo se
  // queda corto. El scrollTop directo, en los siguientes fotogramas, remata lo
  // que ya se puede rematar; el ancla de arriba se ocupa de todo lo que llegue
  // tarde. Y volver a anclar aquí es lo que mantiene el comportamiento de
  // siempre: al abrir una conversación y al entrar un mensaje, abajo, aunque
  // estuvieras leyendo más arriba.
  useEffect(() => {
    if (!elementos.length) return
    anclado.current = true
    virtual.scrollToIndex(elementos.length - 1, { align: 'end' })
    const r1 = requestAnimationFrame(alFinal)
    const r2 = requestAnimationFrame(() => requestAnimationFrame(alFinal))
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2) }
  }, [elementos.length, conv.cliente_id, virtual, alFinal])

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
    <div
      ref={contenedor}
      onWheel={soltarAncla}
      onTouchMove={soltarAncla}
      onScroll={alDesplazar}
      className="fondo-hilo flex flex-1 flex-col overflow-y-auto py-3"
    >
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
        ref={ponerLienzo}
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
