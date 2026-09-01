import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Megaphone, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { horaMensaje } from '@/lib/formato'
import { useUI } from '@/store/ui'
import { TextoMarcado } from './TextoMarcado'
import type { AnuncioOrigen } from '@/tipos'

/**
 * El mensaje automático del anuncio, pintado como un saliente más.
 *
 * POR QUÉ VA A LA DERECHA Y CON LOS COLORES DE LO NUESTRO. Porque eso es lo
 * que pasó: el cliente vio un mensaje del negocio antes de escribir. Pintarlo
 * a la izquierda diría que lo escribió él, y pintarlo centrado como un aviso
 * del sistema diría que es una nota interna. Ni una cosa ni la otra: es el
 * primer mensaje de la conversación y viene de nuestro lado.
 *
 * QUÉ LO DISTINGUE DE UN MENSAJE NUESTRO DE VERDAD. La cabecera dice
 * «Anuncio» con su megáfono, igual que los demás salientes dicen «María» o
 * «Tú», y NO lleva marca de entrega. Un doble check aquí sería mentira: esto
 * no lo hemos enviado nosotros y no tenemos ningún estado que enseñar.
 *
 * SOLO SE PLIEGA EL CUERPO. El titular y la imagen se ven siempre: son lo que
 * dice de qué producto venía la conversación de un vistazo, que es justo para
 * lo que existe esta burbuja. Plegarlos ahorraría cuatro píxeles y quitaría
 * la única razón de estar aquí.
 */
export function BurbujaAnuncio({
  a, creado, mensajeId,
}: {
  a: AnuncioOrigen
  creado: string
  /** Id del mensaje que trae el `referral`: la clave del estado desplegado. */
  mensajeId: number
}) {
  // La miniatura es una URL de Meta y caduca. Si no carga, se quita el hueco
  // en vez de dejar el icono de imagen rota: el texto es lo que importa.
  const [sinImagen, setSinImagen] = useState(false)

  // Abierto/cerrado vive en el STORE, no aquí. El hilo está virtualizado y
  // desmonta las burbujas que se van de la ventana: con un useState local,
  // desplegabas el anuncio, bajabas a leer y al volver estaba plegado otra
  // vez. Ver el comentario de `anunciosAbiertos` en store/ui.ts.
  const abierto = useUI((s) => !!s.anunciosAbiertos[mensajeId])
  const alternar = useUI((s) => s.alternarAnuncio)

  const cuerpoRef = useRef<HTMLParagraphElement>(null)
  const [desborda, setDesborda] = useState(false)

  /**
   * ¿El cuerpo pasa de dos líneas?
   *
   * Se mide de verdad, no se cuentan caracteres: cuántas líneas ocupa un
   * texto depende del ancho del panel, del tamaño de letra y de dónde parta
   * cada palabra. Un umbral de caracteres acertaría a veces y pondría un
   * «Leer más» que no despliega nada el resto.
   *
   * OJO CON EL DETALLE QUE PARECE DE MÁS: la medición pone el recorte
   * SIEMPRE, aunque la burbuja esté desplegada, y lo quita al terminar.
   * Sin eso, al estar desplegada `scrollHeight` y `clientHeight` valen lo
   * mismo, `desborda` sería false y el botón de «Leer menos» desaparecería
   * — y como la virtualización remonta la burbuja al volver a entrar en
   * pantalla, te quedarías con un anuncio abierto que ya no se puede
   * cerrar. Va en useLayoutEffect para que ocurra antes de pintar y no se
   * vea ni un parpadeo.
   */
  const medir = useCallback(() => {
    const el = cuerpoRef.current
    if (!el) return
    const tenia = el.classList.contains('line-clamp-2')
    if (!tenia) el.classList.add('line-clamp-2')
    const hay = el.scrollHeight - el.clientHeight > 1
    if (!tenia) el.classList.remove('line-clamp-2')
    setDesborda(hay)
  }, [])

  useLayoutEffect(() => {
    const el = cuerpoRef.current
    if (!el) return
    medir()

    // Solo interesa el ANCHO: el alto cambia al desplegar, y reaccionar a
    // eso sería medir dentro del observador que la propia medición dispara.
    let anchoPrevio = el.getBoundingClientRect().width
    const ro = new ResizeObserver((entradas) => {
      const ancho = entradas[0].contentRect.width
      if (Math.abs(ancho - anchoPrevio) < 0.5) return
      anchoPrevio = ancho
      medir()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [medir, a.cuerpo])

  return (
    <div className="flex justify-end px-3">
      <div className="relative max-w-[65%] rounded-lg bg-propio px-2.5 py-1.5 shadow-burbuja">
        <div className="mb-0.5 flex items-center gap-1 text-[11px] text-propio-texto/60">
          <Megaphone className="h-3 w-3" />
          Anuncio
        </div>

        {a.miniatura && !sinImagen && (
          <img
            src={a.miniatura}
            alt=""
            loading="lazy"
            onError={() => setSinImagen(true)}
            className="mb-1 max-h-56 w-auto rounded-md object-contain"
          />
        )}

        {a.titular && (
          <p className="whitespace-pre-wrap break-words text-[15px] font-semibold leading-snug">
            <TextoMarcado texto={a.titular} />
          </p>
        )}

        {a.cuerpo && (
          <p
            ref={cuerpoRef}
            className={[
              'whitespace-pre-wrap break-words text-[15px] leading-snug',
              abierto ? '' : 'line-clamp-2',
            ].join(' ')}
          >
            <TextoMarcado texto={a.cuerpo} />
          </p>
        )}

        {/* El botón solo existe si hay algo que desplegar. Un «Leer más» que
            al pulsarlo no cambia nada es peor que no tenerlo. */}
        {a.cuerpo && desborda && (
          <button
            type="button"
            onClick={() => alternar(mensajeId)}
            aria-expanded={abierto}
            className="mt-0.5 flex items-center gap-0.5 text-[12px] font-medium text-propio-texto/70 hover:text-propio-texto"
          >
            {abierto ? 'Leer menos' : 'Leer más'}
            {abierto
              ? <ChevronUp className="h-3 w-3" />
              : <ChevronDown className="h-3 w-3" />}
          </button>
        )}

        {a.enlace && (
          <a
            href={a.enlace}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 flex items-center justify-center gap-1 rounded velo velo-hover px-2 py-1.5 text-[11px] font-medium"
          >
            Ver el anuncio <ExternalLink className="h-3 w-3" />
          </a>
        )}

        {/* La hora es la del primer mensaje del cliente, no la del anuncio:
            Meta no nos dice cuándo se enseñó. Por eso no lleva marca de
            entrega — no tenemos ese dato y no vamos a inventarlo. */}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-propio-texto/60">
          <span>{horaMensaje(creado)}</span>
        </div>
      </div>
    </div>
  )
}
