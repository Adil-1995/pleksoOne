import { useState } from 'react'
import { Megaphone, ExternalLink } from 'lucide-react'
import { horaMensaje } from '@/lib/formato'
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
 * EL CUERPO VA ENTERO. Sin `truncate` ni `line-clamp`: el texto del anuncio
 * es justo lo que dice de qué producto venía la conversación, y cortarlo a
 * dos líneas deja la pregunta a medio responder. Si es largo, ocupa lo que
 * ocupe — el hilo tiene scroll.
 */
export function BurbujaAnuncio({ a, creado }: { a: AnuncioOrigen; creado: string }) {
  // La miniatura es una URL de Meta y caduca. Si no carga, se quita el hueco
  // en vez de dejar el icono de imagen rota: el texto es lo que importa.
  const [sinImagen, setSinImagen] = useState(false)

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
            {a.titular}
          </p>
        )}

        {a.cuerpo && (
          <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">
            {a.cuerpo}
          </p>
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
