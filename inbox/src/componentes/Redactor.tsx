import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { Send, Paperclip, X, Loader2, AlertTriangle, Ban } from 'lucide-react'
import { enviar, subirMedia, subirMiniatura, ponerBot } from '@/lib/envio'
import { revisar, comprimirImagen, miniaturaDeVideo, tipoDeFichero } from '@/lib/media'
import { capacidadesDe, estadoVentana } from '@/lib/canales'
import { useUI } from '@/store/ui'
import { useQueryClient } from '@tanstack/react-query'
import { claves } from '@/hooks/datos'
import type { Conversacion, Canal, MensajeOptimista } from '@/tipos'

export function Redactor({ conv, canal }: { conv: Conversacion; canal: Canal | undefined }) {
  const [texto, setTexto] = useState('')
  const [adjunto, setAdjunto] = useState<File | null>(null)
  // `vista` es la miniatura que se ve en el compositor (imagen o fotograma
  // del vídeo). `urlLocal` es el fichero en sí: sirve de media_url del
  // mensaje optimista para que un PDF ya se vea y se pueda abrir mientras
  // sube. Antes eran la misma variable, y por eso un documento recién
  // enviado aparecía como una burbuja vacía hasta que llegaba el realtime.
  const [vista, setVista] = useState<string | null>(null)
  const [urlLocal, setUrlLocal] = useState<string | null>(null)
  const [progreso, setProgreso] = useState<number | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const ficheroRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const { anadirOptimista, marcarFallo, quitarOptimista } = useUI()

  const cap = capacidadesDe(canal, conv.canal)
  const ventana = estadoVentana(conv, cap)
  const bloqueado = ventana.aplica && !ventana.abierta

  async function elegir(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setAviso(null)

    // Se avisa ANTES de subir nada: con datos móviles, subir 15 MB para que
    // Meta lo rechace al final es lo peor que le puedes hacer a alguien.
    const rev = revisar(f)
    if (!rev.ok) { setAviso(rev.motivo!); return }

    let final = f
    if (rev.tipo === 'image') {
      final = await comprimirImagen(f)
      if (final.size > rev.limite) {
        setAviso(
          `Ni comprimida baja de ${Math.round(rev.limite / 1048576)} MB ` +
          `(se queda en ${(final.size / 1048576).toFixed(1)} MB). Prueba con otra.`,
        )
        return
      }
    }
    setAdjunto(final)
    setVista(
      rev.tipo === 'image' ? URL.createObjectURL(final)
      : rev.tipo === 'video' ? await miniaturaDeVideo(final)
      : null,
    )
    setUrlLocal(URL.createObjectURL(final))
  }

  function quitarAdjunto() {
    if (vista?.startsWith('blob:')) URL.revokeObjectURL(vista)
    if (urlLocal?.startsWith('blob:')) URL.revokeObjectURL(urlLocal)
    setAdjunto(null); setVista(null); setUrlLocal(null); setAviso(null)
  }

  async function mandar() {
    if (bloqueado) return
    const cuerpo = texto.trim()
    if (!cuerpo && !adjunto) return

    const idTemporal = -Date.now()
    const fichero = adjunto
    const miniaturaLocal = fichero && tipoDeFichero(fichero) === 'video' ? vista : null

    const optimista: MensajeOptimista = {
      id: idTemporal, optimista: true,
      cliente_id: conv.cliente_id, direccion: 'out', autor: 'humano',
      tipo: fichero ? tipoDeFichero(fichero) : 'text',
      // El fichero local, no la miniatura: así el PDF ya se abre y el vídeo
      // ya se reproduce mientras la subida está en marcha.
      texto: cuerpo || null, media_url: urlLocal, transcripcion: null,
      estado: 'pendiente', msg_id_canal: null,
      creado: new Date().toISOString(), canal: conv.canal,
      // Adjunto de mentira para que la burbuja pinte ya nombre y peso.
      adjuntos: fichero
        ? [{
            id: idTemporal, mensaje_id: idTemporal,
            tipo: tipoDeFichero(fichero),
            storage_path: urlLocal ?? fichero.name,
            tamano: fichero.size, duracion: null,
            transcripcion: null, miniatura: miniaturaLocal,
            nombre_fichero: fichero.name,
          }]
        : undefined,
    }
    anadirOptimista(conv.cliente_id, optimista)

    setTexto(''); setAdjunto(null); setVista(null); setUrlLocal(null)

    // AUTO-PAUSA: si escribe un humano, María se calla. Que dos voces
    // respondan a la vez es peor que no responder.
    if (conv.bot_activo) {
      ponerBot(conv.cliente_id, false)
        .then(() => qc.invalidateQueries({ queryKey: claves.conversaciones }))
        .catch(() => { /* el envío es lo importante; esto se reintenta al recargar */ })
    }

    try {
      let mediaUrl: string | undefined
      let miniaturaUrl: string | undefined
      if (fichero) {
        setProgreso(0)
        const { url } = await subirMedia(conv.cliente_id, fichero, setProgreso)
        mediaUrl = url
        // La miniatura del vídeo va después y sin bloquear: si falla, se
        // envía igual y el reproductor sale sin poster.
        if (miniaturaLocal) {
          miniaturaUrl = (await subirMiniatura(conv.cliente_id, miniaturaLocal)) ?? undefined
        }
        setProgreso(null)
      }

      const tipo = fichero ? tipoDeFichero(fichero) : 'text'
      const r = await enviar({
        cliente_id: conv.cliente_id,
        accion: tipo === 'image' ? 'imagen'
              : tipo === 'video' ? 'video'
              : tipo === 'audio' ? 'audio'
              : tipo === 'document' ? 'documento'
              : 'texto',
        texto: cuerpo || undefined,
        media_url: mediaUrl,
        nombre_fichero: fichero?.name,
        tamano: fichero?.size,
        miniatura_url: miniaturaUrl,
      })

      if (!r.ok) {
        marcarFallo(conv.cliente_id, idTemporal, r.error ?? 'No se pudo enviar')
        return
      }
      // n8n ya lo ha escrito en `mensajes`; el realtime lo traerá con su id real.
      setTimeout(() => quitarOptimista(conv.cliente_id, idTemporal), 1200)
      qc.invalidateQueries({ queryKey: claves.mensajes(conv.cliente_id) })
    } catch (e) {
      setProgreso(null)
      marcarFallo(conv.cliente_id, idTemporal, e instanceof Error ? e.message : 'Error')
    }
  }

  function teclas(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mandar() }
  }

  // Bloqueada gana a todo: Meta rechazaría el envío igualmente, así que mejor
  // no dejar ni escribir el mensaje que perderlo contra un error.
  if (conv.bloqueada) {
    return (
      <div className="flex shrink-0 items-center justify-center gap-2 border-t border-borde bg-panel px-4 py-3 text-center text-sm text-alerta">
        <Ban className="h-4 w-4 shrink-0" />
        Cliente bloqueado en WhatsApp. Desbloquéalo desde el menú para poder escribirle.
      </div>
    )
  }

  if (bloqueado) {
    return (
      <div className="shrink-0 border-t border-borde bg-panel px-4 py-3 text-center text-sm text-texto2">
        La ventana de {cap.ventanaHoras} h está cerrada. Solo se puede reabrir con una
        plantilla aprobada{cap.puedePlantillas ? '' : ', y este canal no las soporta'}.
      </div>
    )
  }

  return (
    <div className="shrink-0 border-t border-borde bg-panel">
      {aviso && (
        <div className="flex items-start gap-2 bg-alerta/10 px-4 py-2 text-xs text-alerta">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{aviso}</span>
          <button onClick={() => setAviso(null)} aria-label="Cerrar aviso"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {adjunto && (
        <div className="flex items-center gap-3 border-b border-borde px-4 py-2">
          {vista
            ? <img src={vista} alt="" className="h-14 w-14 rounded object-cover" />
            : <div className="flex h-14 w-14 items-center justify-center rounded bg-panel2 text-xs text-texto2">
                {adjunto.name.split('.').pop()?.toUpperCase()}
              </div>}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{adjunto.name}</div>
            <div className="text-xs text-texto2">{(adjunto.size / 1048576).toFixed(2)} MB</div>
            {progreso !== null && (
              <div className="mt-1 h-1 overflow-hidden rounded bg-panel2">
                <div className="h-full bg-acento transition-all" style={{ width: `${progreso}%` }} />
              </div>
            )}
          </div>
          <button onClick={quitarAdjunto} className="rounded p-1 text-texto2 hover:bg-panel2" aria-label="Quitar adjunto">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 p-2">
        {cap.puedeEnviarMedia && (
          <>
            <input ref={ficheroRef} type="file" hidden onChange={elegir}
                   accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" />
            <button
              onClick={() => ficheroRef.current?.click()}
              className="rounded-full p-2.5 text-texto2 hover:bg-panel2"
              aria-label="Adjuntar"
            >
              <Paperclip className="h-5 w-5" />
            </button>
          </>
        )}

        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={teclas}
          rows={1}
          placeholder="Escribe un mensaje"
          className="max-h-32 min-h-[42px] flex-1 resize-none rounded-2xl bg-panel2 px-4 py-2.5 outline-none placeholder:text-texto2"
        />

        <button
          onClick={mandar}
          disabled={progreso !== null || (!texto.trim() && !adjunto)}
          className="rounded-full bg-acento p-2.5 text-fondo disabled:opacity-40"
          aria-label="Enviar"
        >
          {progreso !== null
            ? <Loader2 className="h-5 w-5 animate-spin" />
            : <Send className="h-5 w-5" />}
        </button>
      </div>
    </div>
  )
}
