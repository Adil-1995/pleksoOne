import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

export type Elemento =
  | { clase: 'dia'; clave: string; iso: string }
  | { clase: 'anuncio'; clave: string; a: AnuncioOrigen; iso: string; id: number }
  | { clase: 'msg'; clave: string; m: MensajeEnLista }

/** La fecha de cualquier elemento del hilo, sea del tipo que sea. */
export function isoDe(el: Elemento): string {
  return el.clase === 'msg' ? el.m.creado : el.iso
}

/**
 * QUÉ FECHA TOCA ENSEÑAR ARRIBA, dado lo primero que asoma por el borde.
 *
 * Va aparte del cálculo del DOM para poder probarla: medir rectángulos es
 * cosa del navegador, pero decidir qué se enseña es una regla, y una regla
 * que no se prueba se rompe la próxima vez que alguien toque el hilo.
 *
 * LA REGLA: la fecha de lo que asoma, salvo que lo que asome sea el separador
 * de verdad. Entonces no hay pastilla, porque el separador YA está diciendo
 * esa misma fecha y se verían las dos.
 *
 * Primero lo intenté con «salvo que el separador esté ENTERO a la vista», y
 * en el navegador salía la fecha dos veces: al llegar abajo del todo el
 * separador quedaba cortado 17 px por arriba, así que no contaba como entero
 * y aparecía además la pastilla. Con el separador visible —del todo o a
 * medias— la pastilla sobra siempre.
 *
 * LO QUE CUESTA, y se sabe: mientras el separador se está yendo por arriba
 * hay unos 44 px de scroll en los que se lee a medias y no hay pastilla. Es
 * un instante mientras arrastras, y es el precio de no repetir nunca la
 * fecha. La alternativa —tapar el separador de dentro para que la pastilla
 * ocupe su sitio— es un pegado exacto que se rompe en cuanto alguien cambie
 * un padding, y no compensa por 44 px.
 */
export function fechaFlotante(el: Elemento | null): string | null {
  if (!el) return null
  if (el.clase === 'dia') return null
  return isoDe(el)
}

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

  // TODO el que baje pasa por aquí, y por eso la comprobación del ancla está
  // AQUÍ y no en cada llamador. Estuvo solo en el ResizeObserver y era una
  // carrera: los dos requestAnimationFrame de más abajo quedan pendientes unos
  // milisegundos, y si sueltas el ancla justo en ese hueco te bajaban igual.
  // Medido: la misma prueba salía «se queda arriba» o «vuelve abajo» según
  // llegara la rueda antes o después del fotograma.
  // `alFinal` se declara ANTES que `recalcularDia` y no puede llamarlo
  // directamente —sería usarlo antes de existir—, así que se deja aquí un
  // hueco que se rellena más abajo. Hace falta porque el hilo se coloca en
  // varias tandas: el primer intento, dos fotogramas después, y otra vez cada
  // vez que una imagen carga y el ResizeObserver dispara. Sin esto la
  // pastilla se quedaba VACÍA al abrir y no aparecía hasta que tocabas el
  // scroll, que es justo cuando ya no la necesitas.
  const recalcularRef = useRef<(() => void) | null>(null)

  const alFinal = useCallback(() => {
    const c = contenedor.current
    if (c && anclado.current) c.scrollTop = c.scrollHeight
    recalcularRef.current?.()
  }, [])

  // Ref de callback y no un useRef normal a propósito: el div de dentro no
  // existe mientras el hilo está cargando, y con un efecto habría que adivinar
  // en qué render aparece. Así el observador se engancha justo cuando nace.
  const ponerLienzo = useCallback((el: HTMLDivElement | null) => {
    observador.current?.disconnect()
    observador.current = null
    if (!el) return
    observador.current = new ResizeObserver(alFinal)
    observador.current.observe(el)
  }, [alFinal])

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

  /**
   * LA FECHA FLOTANTE, como en WhatsApp.
   *
   * El separador de día es un elemento más del hilo, así que se queda donde
   * le toca: arriba del todo de su día. En una conversación con veinte
   * mensajes del 24 de agosto, subes a leerlos y la fecha se ha ido de la
   * pantalla — te quedas mirando mensajes sin saber de cuándo son. Lo de
   * «Hoy» se veía siempre solo porque el hilo abre abajo, pegado a él.
   *
   * Se arregla con una pastilla pegada al borde de arriba que dice de qué día
   * es lo que estás viendo AHORA. No sustituye a los separadores: son las dos
   * cosas que hace WhatsApp, el separador marca el corte y la pastilla te
   * sitúa cuando el corte ya no se ve.
   *
   * SE MIDE EN EL DOM, no con las coordenadas del virtualizador. Sus
   * `start`/`end` son del lienzo interior, que lleva un `marginTop: auto`
   * para que un hilo corto quede abajo; contar desde ahí obliga a restar un
   * desplazamiento que cambia según cuántos mensajes haya. El rectángulo del
   * primer hijo que asoma responde a la pregunta directamente y no puede
   * desincronizarse de lo que se ve.
   */
  const [diaFlotante, setDiaFlotante] = useState<string | null>(null)

  const recalcularDia = useCallback(() => {
    const c = contenedor.current
    if (!c) return
    // Arriba del todo no hace falta: el separador de verdad está ahí. Y esto
    // cubre de paso el hilo corto que no llega a hacer scroll.
    if (c.scrollTop <= 0) { setDiaFlotante((v) => (v === null ? v : null)); return }
    const borde = c.getBoundingClientRect().top
    let indice: number | null = null
    for (const hijo of c.querySelectorAll<HTMLElement>('[data-index]')) {
      if (hijo.getBoundingClientRect().bottom > borde + 1) {
        indice = Number(hijo.dataset.index)
        break
      }
    }
    const nuevo = fechaFlotante(indice === null ? null : (elementos[indice] ?? null))
    setDiaFlotante((v) => (v === nuevo ? v : nuevo))
  }, [elementos])

  // Se recalcula al desplazar y cuando cambia el hilo. No hace falta más: solo
  // se guarda la ETIQUETA, así que un desplazamiento que no cambia de día no
  // provoca ni un pintado.
  useEffect(() => {
    recalcularRef.current = recalcularDia
    // Por tandas, y por el mismo motivo que el colocado del hilo: al abrir,
    // los eventos de scroll ocurren ANTES de que las burbujas estén medidas,
    // así que en ese momento no hay ningún hijo asomando por el borde y la
    // cuenta sale vacía. Después ya no se desplaza nada, así que sin estos
    // reintentos la pastilla se quedaba en blanco hasta que tocabas el
    // scroll — comprobado en producción: al abrir salía null, y un evento de
    // scroll SIN MOVER NADA la ponía en «24 DE AGOSTO 2026».
    recalcularDia()
    const r1 = requestAnimationFrame(recalcularDia)
    const r2 = requestAnimationFrame(() => requestAnimationFrame(recalcularDia))
    const t = window.setTimeout(recalcularDia, 250)
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
      window.clearTimeout(t)
    }
  }, [recalcularDia])

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
    recalcularDia()
  }, [recalcularDia])


  // Al abrir, el contador a cero.
  useEffect(() => { if (conv.no_leidos > 0) marcarLeida(conv.cliente_id) }, [conv.cliente_id, conv.no_leidos])


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
        LA PASTILLA DE LA FECHA, pegada al borde de arriba.

        `h-0` NO es un truco: es lo que la deja flotar SIN ocupar sitio. Con
        alto propio, este hijo empujaría el hilo hacia abajo y se comería el
        `marginTop: auto` que mantiene los hilos cortos pegados abajo. Con
        alto cero, lo de dentro desborda y se ve, pero para el layout no
        existe.

        `sticky` y no `absolute` porque el contenedor es el que hace scroll:
        una caja absoluta se desplazaría con el contenido y desaparecería por
        arriba a los dos dedos de scroll.

        Y `pointer-events-none` para que no se coma un clic en la burbuja que
        pase por debajo.
      */}
      <div className="pointer-events-none sticky top-0 z-10 h-0">
        <div className="flex justify-center pt-1">
          {diaFlotante && (
            <span className="rounded-md bg-panel2/95 px-3 py-1 text-[11px] uppercase tracking-wide text-texto2 shadow-sm backdrop-blur-sm">
              {etiquetaDia(diaFlotante)}
            </span>
          )}
        </div>
      </div>
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
      {/*
        shrink-0 NO es adorno, y sin el el ancla de arriba no funciona.
        Este div es hijo de un contenedor `flex flex-col`, o sea un item flex
        con `flex-shrink: 1` por defecto: cuando el hilo es mas alto que el
        panel, flexbox lo ENCOGE hasta el alto del panel. Medido: con
        `style.height` a 1333 px su caja real medía 558. El hilo hacia scroll
        igualmente porque las burbujas van en `position: absolute` y desbordan
        la caja, asi que no se notaba nada... salvo que el ResizeObserver del
        ancla no se enteraba JAMAS: el alto de la caja no cambiaba nunca.
        Con shrink-0 la caja mide de verdad lo que dice getTotalSize(), el
        observador dispara, y de paso el `py-3` de abajo deja de perderse.
      */}
      <div
        ref={ponerLienzo}
        className="w-full shrink-0"
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
