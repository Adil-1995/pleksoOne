import { useEffect, useMemo, useRef, useState } from 'react'
import { Smile, Clock, Search } from 'lucide-react'
import { GRUPOS, buscarEmojis, leerRecientes, apuntarReciente } from '@/lib/emojis'

/**
 * El selector de emojis del campo de mensaje.
 *
 * SE CIERRA AL ELEGIR, y es deliberado aunque WhatsApp Web lo deje abierto:
 * aquí el panel tapa el campo de texto, y quedarse abierto obliga a un clic
 * extra para ver lo que acabas de escribir. Para poner varios seguidos está
 * el buscador, que es más rápido que ir pinchando.
 *
 * EL FOCO VUELVE AL CAMPO en cuanto se inserta, y por eso los botones usan
 * `onMouseDown` con `preventDefault`: con `onClick` el navegador ya le ha
 * quitado el foco al textarea antes de dispararlo, y entonces el cursor se
 * pierde y el emoji siguiente acabaría al final del texto en vez de donde
 * estabas escribiendo.
 */
export function SelectorEmojis({ onElegir }: { onElegir: (emoji: string) => void }) {
  const [abierto, setAbierto] = useState(false)
  const [grupo, setGrupo] = useState(GRUPOS[0].id)
  const [busca, setBusca] = useState('')
  const [recientes, setRecientes] = useState<string[]>([])
  const caja = useRef<HTMLDivElement>(null)

  // Se leen al ABRIR, no al montar: si pones un emoji en otra conversación,
  // al volver a abrir aquí tiene que salir arriba sin recargar la página.
  useEffect(() => { if (abierto) setRecientes(leerRecientes()) }, [abierto])

  // Cerrar al pinchar fuera y con Escape. Sin esto el panel se queda puesto
  // tapando el hilo y hay que volver a darle al botón para quitarlo.
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false)
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Se para aquí: si subiera, el atajo global de Escape quitaría el foco
      // del campo y perderías el mensaje a medias por cerrar un desplegable.
      e.stopPropagation()
      setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla, true)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla, true)
    }
  }, [abierto])

  const resultados = useMemo(() => buscarEmojis(busca), [busca])
  const buscando = busca.trim().length > 0
  const actual = GRUPOS.find((g) => g.id === grupo) ?? GRUPOS[0]

  function elegir(emoji: string) {
    setRecientes(apuntarReciente(emoji))
    onElegir(emoji)
    setAbierto(false)
    setBusca('')
  }

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className={[
          'rounded-full p-2.5 hover:bg-panel2',
          abierto ? 'text-acento' : 'text-texto2',
        ].join(' ')}
        aria-label="Emojis"
        aria-expanded={abierto}
      >
        <Smile className="h-5 w-5" />
      </button>

      {abierto && (
        // Anclado al botón y hacia ARRIBA: el campo está abajo del todo y un
        // panel hacia abajo se saldría de la pantalla.
        <div className="absolute bottom-full left-0 z-30 mb-2 w-[19rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-borde bg-panel shadow-lg">
          <div className="flex items-center gap-2 border-b border-borde px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-texto2" />
            <input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar: gracias, envio, fuego…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-texto2"
            />
          </div>

          {!buscando && (
            <div className="flex border-b border-borde">
              {recientes.length > 0 && (
                <BotonGrupo
                  activo={grupo === 'recientes'}
                  onClick={() => setGrupo('recientes')}
                  titulo="Recientes"
                >
                  <Clock className="h-4 w-4" />
                </BotonGrupo>
              )}
              {GRUPOS.map((g) => (
                <BotonGrupo
                  key={g.id}
                  activo={grupo === g.id}
                  onClick={() => setGrupo(g.id)}
                  titulo={g.nombre}
                >
                  <span className="text-lg leading-none">{g.icono}</span>
                </BotonGrupo>
              ))}
            </div>
          )}

          <div className="max-h-56 overflow-y-auto p-1.5">
            {buscando && resultados.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-texto2">
                Ningún emoji con «{busca.trim()}».
              </p>
            )}

            <Rejilla
              emojis={
                buscando ? resultados
                : grupo === 'recientes' ? recientes
                : actual.emojis.map(([e]) => e)
              }
              onElegir={elegir}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function BotonGrupo({
  activo, onClick, titulo, children,
}: {
  activo: boolean; onClick: () => void; titulo: string; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      className={[
        'flex flex-1 items-center justify-center border-b-2 py-1.5',
        activo ? 'border-acento text-acento' : 'border-transparent text-texto2 hover:bg-panel2',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Rejilla({ emojis, onElegir }: { emojis: string[]; onElegir: (e: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emojis.map((e, i) => (
        <button
          // El emoji no vale de clave: en «recientes» y en un grupo puede
          // repetirse, y React se quejaría de claves duplicadas.
          key={e + i}
          type="button"
          // onMouseDown y no onClick: ver el comentario de arriba sobre el foco.
          onMouseDown={(ev) => { ev.preventDefault(); onElegir(e) }}
          className="rounded-md p-1 text-xl leading-none hover:bg-panel2"
        >
          {e}
        </button>
      ))}
    </div>
  )
}
