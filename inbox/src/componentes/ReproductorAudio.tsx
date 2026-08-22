import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { Play, Pause } from 'lucide-react'
import { duracion } from '@/lib/formato'

const VELOCIDADES = [1, 1.5, 2] as const

/**
 * Audio con onda. Las notas de voz son el 26 % de las incidencias, así que
 * esto se usa mucho: velocidad x1.5 / x2 y transcripción debajo si existe.
 */
export function ReproductorAudio({
  url, propio, transcripcion, duracionConocida,
}: {
  url: string
  propio: boolean
  transcripcion?: string | null
  /** Segundos calculados en n8n desde el Ogg. Evita el 0:00 mientras carga. */
  duracionConocida?: number | null
}) {
  const caja = useRef<HTMLDivElement>(null)
  const ws = useRef<WaveSurfer | null>(null)
  const [sonando, setSonando] = useState(false)
  const [pos, setPos] = useState(0)
  const [total, setTotal] = useState(duracionConocida ?? 0)
  const [velocidad, setVelocidad] = useState<number>(1)
  const [fallo, setFallo] = useState(false)

  useEffect(() => {
    if (!caja.current) return
    const w = WaveSurfer.create({
      container: caja.current,
      height: 32,
      waveColor: propio ? 'rgba(255,255,255,.35)' : '#54656f',
      progressColor: propio ? '#ffffff' : '#00a884',
      cursorWidth: 0,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      normalize: true,
      url,
    })
    ws.current = w
    w.on('ready', () => setTotal(w.getDuration()))
    w.on('audioprocess', () => setPos(w.getCurrentTime()))
    w.on('seeking', () => setPos(w.getCurrentTime()))
    w.on('play', () => setSonando(true))
    w.on('pause', () => setSonando(false))
    w.on('finish', () => { setSonando(false); setPos(0) })
    w.on('error', () => setFallo(true))
    return () => { w.destroy(); ws.current = null }
  }, [url, propio])

  function alternar() { ws.current?.playPause() }

  function cambiarVelocidad() {
    const i = VELOCIDADES.indexOf(velocidad as (typeof VELOCIDADES)[number])
    const siguiente = VELOCIDADES[(i + 1) % VELOCIDADES.length]
    setVelocidad(siguiente)
    ws.current?.setPlaybackRate(siguiente, true)
  }

  if (fallo) {
    return (
      <audio controls src={url} className="w-56">
        Tu navegador no puede reproducir este audio.
      </audio>
    )
  }

  return (
    <div className="w-[260px] max-w-full">
      <div className="flex items-center gap-2">
        <button
          onClick={alternar}
          className={[
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            propio ? 'bg-white/20 hover:bg-white/30' : 'bg-acento text-fondo hover:opacity-90',
          ].join(' ')}
          aria-label={sonando ? 'Pausar' : 'Reproducir'}
        >
          {sonando ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
        </button>

        <div ref={caja} className="min-w-0 flex-1 cursor-pointer" />

        <button
          onClick={cambiarVelocidad}
          className={[
            'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold',
            propio ? 'bg-white/20 hover:bg-white/30' : 'bg-panel2 text-texto2 hover:text-texto',
          ].join(' ')}
          aria-label="Cambiar velocidad"
        >
          {velocidad}×
        </button>
      </div>

      <div className={['mt-1 text-[11px]', propio ? 'text-propio-texto/70' : 'text-texto2'].join(' ')}>
        {duracion(pos)} / {duracion(total)}
      </div>

      {transcripcion && (
        <div
          className={[
            'mt-2 rounded-md px-2 py-1.5 text-[13px] leading-snug',
            propio ? 'velo text-propio-texto/90' : 'velo text-texto2',
          ].join(' ')}
        >
          <span className="mr-1 opacity-60">📝</span>
          {transcripcion}
        </div>
      )}
    </div>
  )
}
