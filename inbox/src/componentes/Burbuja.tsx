import { useState } from 'react'
import {
  Check, CheckCheck, Clock, AlertCircle, FileText, FileSpreadsheet, FileArchive,
  Bot, User, Loader2, Download, MapPin, ExternalLink, Copy,
} from 'lucide-react'
import { horaMensaje, pesoLegible } from '@/lib/formato'
import { nombreDeRuta } from '@/lib/media'
import { useUrlFirmada } from '@/hooks/useUrlFirmada'
import { useUI } from '@/store/ui'
import { ReproductorAudio } from './ReproductorAudio'
import {
  esOptimista, ubicacionDe, enlaceMapa, coordenadas,
  type MensajeEnLista, type Ubicacion,
} from '@/tipos'

export function Burbuja({ m }: { m: MensajeEnLista }) {
  const propio = m.direccion === 'out'
  const optimista = esOptimista(m)
  // TS necesita el estrechamiento aqui: m.fallo solo existe en el optimista.
  const abrirVisor = useUI((s) => s.abrirVisor)

  const adjunto = m.adjuntos?.[0]
  // storage_path manda sobre media_url: el primero es nuestra copia en el
  // bucket privado; media_url puede ser una URL de Meta que caduca en minutos.
  const ruta = adjunto?.storage_path ?? m.media_url
  const { url, cargando, error: errorMedia } = useUrlFirmada(ruta)
  const hayMedia = m.tipo !== 'text' && m.tipo !== 'template' && m.tipo !== 'location'
  const transcripcion = m.transcripcion ?? adjunto?.transcripcion ?? null
  const ubicacion = ubicacionDe(m)

  // El nombre real del fichero. En un mensaje que aún sube viene puesto a
  // mano; en los de la base de datos se deduce de la ruta, que lo lleva
  // detrás del sello de tiempo.
  const nombreFichero = adjunto?.nombre_fichero ?? nombreDeRuta(ruta)
  // La miniatura del vídeo se guarda como URL pública, así que no se firma.
  const miniatura = adjunto?.miniatura ?? null

  return (
    <div className={['flex px-3', propio ? 'justify-end' : 'justify-start'].join(' ')}>
      <div
        className={[
          // 65% del panel, como WhatsApp Web. El contenedor del hilo va a
          // ancho completo, así que este porcentaje es contra el panel real
          // y la burbuja queda pegada a SU lado.
          'relative max-w-[65%] rounded-lg px-2.5 py-1.5 shadow-burbuja',
          propio ? 'bg-propio' : 'bg-ajeno',
          optimista && !m.fallo ? 'opacity-70' : '',
        ].join(' ')}
      >
        {/* Quién habla: el equipo necesita distinguir a María de un humano */}
        {propio && (
          <div className="mb-0.5 flex items-center gap-1 text-[11px] text-propio-texto/60">
            {m.autor === 'bot' ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
            {m.autor === 'bot' ? 'María' : m.autor === 'humano' ? 'Tú' : 'Sistema'}
          </div>
        )}

        {hayMedia && cargando && (
          <div className="mb-1 flex h-16 w-56 items-center justify-center gap-2 rounded-md velo text-xs text-texto2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> cargando…
          </div>
        )}

        {hayMedia && errorMedia && (
          <div className="mb-1 flex items-start gap-1.5 rounded-md bg-alerta/15 px-2 py-1.5 text-[11px] text-alerta">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{errorMedia}</span>
          </div>
        )}

        {m.tipo === 'image' && url && (
          <button onClick={() => abrirVisor(url)} className="mb-1 block">
            <img
              src={url}
              alt={m.texto || 'Imagen'}
              loading="lazy"
              // object-CONTAIN, no cover: cover recorta la ficha por arriba,
              // que es justo donde va el titulo del producto.
              className="max-h-80 w-auto rounded-md object-contain"
            />
          </button>
        )}

        {m.tipo === 'video' && url && (
          // `poster` evita el rectángulo negro mientras nadie le da al play.
          // Si no hay miniatura, preload="metadata" hace que el navegador
          // pinte el primer fotograma por su cuenta en casi todos los casos.
          <video
            src={url}
            poster={miniatura ?? undefined}
            controls
            preload="metadata"
            className="mb-1 max-h-72 rounded-md"
          />
        )}

        {m.tipo === 'audio' && url && (
          <div className="mb-1">
            <ReproductorAudio url={url} propio={propio} transcripcion={transcripcion} duracionConocida={adjunto?.duracion ?? null} />
          </div>
        )}

        {m.tipo === 'document' && url && (
          <a
            href={url}
            download={nombreFichero ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="mb-1 flex items-center gap-2.5 rounded-md velo velo-hover px-2.5 py-2"
          >
            <IconoDoc nombre={nombreFichero} />
            <span className="min-w-0 flex-1">
              {/* El NOMBRE del fichero, no el pie de foto: son cosas
                  distintas y antes se pintaba el pie aquí, así que un PDF
                  sin comentario salía como "Documento" a secas. */}
              <span className="block truncate text-sm">{nombreFichero ?? 'Documento'}</span>
              <span className="text-[11px] opacity-60">
                {[adjunto?.tamano ? pesoLegible(adjunto.tamano) : null, extensionDe(nombreFichero)]
                  .filter(Boolean).join(' · ')}
              </span>
            </span>
            <Download className="h-4 w-4 shrink-0 opacity-60" />
          </a>
        )}

        {/*
          UBICACIÓN. Las coordenadas ya venían guardadas en `mensajes.payload`
          desde el primer día —el webhook crudo entero— así que esto no ha
          necesitado ni tabla nueva ni tocar el flujo. Lo que faltaba era
          mirarlas: hasta ahora una ubicación se pintaba como una burbuja
          VACÍA, solo con la hora, y parecía un mensaje perdido.

          Si el payload no trae coordenadas legibles se dice, no se pinta un
          0,0: ver `ubicacionDe()`.
        */}
        {m.tipo === 'location' && (
          ubicacion ? <TarjetaUbicacion u={ubicacion} /> : (
            <div className="mb-1 flex items-start gap-1.5 rounded-md bg-alerta/15 px-2 py-1.5 text-[11px] text-alerta">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>Llegó una ubicación pero no se pudieron leer sus coordenadas.</span>
            </div>
          )
        )}

        {/* El texto: en media hace de pie de foto, documentos incluidos */}
        {m.texto && (
          <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">{m.texto}</p>
        )}

        {/* Transcripción cuando no es audio (por si llega en el mensaje) */}
        {transcripcion && m.tipo !== 'audio' && (
          <p className="mt-1 rounded velo px-2 py-1 text-[13px] opacity-80">
            📝 {transcripcion}
          </p>
        )}

        <div
          className={[
            'mt-0.5 flex items-center justify-end gap-1 text-[11px]',
            propio ? 'text-propio-texto/60' : 'text-texto2',
          ].join(' ')}
        >
          <span>{horaMensaje(m.creado)}</span>
          {propio && <Marca estado={m.estado} />}
        </div>

        {optimista && m.fallo && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-alerta">
            <AlertCircle className="h-3 w-3" /> {m.fallo}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * La ubicación que mandó el cliente.
 *
 * Sin mapa embebido, y es una decisión, no una limitación: pintar teselas
 * obliga a pedírselas a un tercero, y eso manda las coordenadas de la casa
 * del cliente a un servidor ajeno cada vez que alguien abre la conversación.
 * Aquí no sale nada: la tarjeta se pinta sola, funciona sin conexión y no
 * añade una dependencia que un día se cae y deja un hueco gris.
 *
 * El mapa de verdad se abre al pulsar, en Google Maps, que es donde el
 * repartidor lo va a querer de todas formas. Y el botón de copiar está
 * porque lo que se hace con esto es pegárselo a la paquetería.
 */
function TarjetaUbicacion({ u }: { u: Ubicacion }) {
  const [copiado, setCopiado] = useState(false)

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(coordenadas(u))
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 1500)
    } catch {
      // Sin portapapeles (permiso denegado, contexto no seguro) no se finge
      // que ha ido bien: las coordenadas están escritas ahí arriba y se
      // pueden seleccionar a mano. Un «Copiado» falso es peor que nada.
      setCopiado(false)
    }
  }

  return (
    <div className="mb-1 w-56 rounded-md velo p-2.5">
      <div className="flex items-start gap-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-acento/20 text-acento">
          <MapPin className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{u.nombre ?? 'Ubicación'}</span>
          {u.direccion && (
            <span className="block truncate text-[11px] opacity-70">{u.direccion}</span>
          )}
          {/* Las coordenadas SIEMPRE, aunque haya nombre: es el único dato
              que no se puede confundir con otro sitio parecido. */}
          <span className="mt-0.5 block text-[11px] tabular-nums opacity-60">
            {u.latitud.toFixed(6)}, {u.longitud.toFixed(6)}
          </span>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <a
          href={enlaceMapa(u)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-1 rounded velo velo-hover px-2 py-1.5 text-[11px] font-medium"
        >
          Google Maps <ExternalLink className="h-3 w-3" />
        </a>
        <button
          onClick={copiar}
          className="flex items-center justify-center gap-1 rounded velo velo-hover px-2 py-1.5 text-[11px] font-medium"
          title="Copiar las coordenadas"
        >
          {copiado ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  )
}

function extensionDe(nombre: string | null): string | null {
  if (!nombre) return null
  const punto = nombre.lastIndexOf('.')
  if (punto <= 0 || punto === nombre.length - 1) return null
  return nombre.slice(punto + 1).toUpperCase()
}

/** Icono según el tipo de documento, para reconocerlo de un vistazo. */
function IconoDoc({ nombre }: { nombre: string | null }) {
  const ext = (extensionDe(nombre) ?? '').toLowerCase()
  const clase = 'h-7 w-7 shrink-0'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return <FileSpreadsheet className={clase + ' text-emerald-400'} />
  if (['zip', 'rar', '7z'].includes(ext)) return <FileArchive className={clase + ' text-amber-400'} />
  if (ext === 'pdf') return <FileText className={clase + ' text-red-400'} />
  return <FileText className={clase + ' opacity-70'} />
}

function Marca({ estado }: { estado: string }) {
  if (estado === 'pendiente') return <Clock className="h-3.5 w-3.5" aria-label="Enviando" />
  if (estado === 'error') return <AlertCircle className="h-3.5 w-3.5 text-alerta" aria-label="Error" />
  if (estado === 'leido') return <CheckCheck className="h-3.5 w-3.5 text-leido" aria-label="Leído" />
  if (estado === 'entregado') return <CheckCheck className="h-3.5 w-3.5" aria-label="Entregado" />
  return <Check className="h-3.5 w-3.5" aria-label="Enviado" />
}

