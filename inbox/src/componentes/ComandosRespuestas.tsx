import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Zap } from 'lucide-react'
import { useRespuestas } from '@/hooks/datos'
import { filtrarRespuestas, filtroDe } from '@/lib/respuestas'
import type { RespuestaRapida } from '@/tipos'

/**
 * Los comandos de «/», igual que las respuestas rápidas de WhatsApp Business.
 *
 * CUÁNDO SE ABRE: cuando el campo entero es una barra seguida de algo sin
 * espacios («/», «/env»). Solo al principio del mensaje, como en WhatsApp.
 * Restringirlo así lo hace predecible: nunca aparece a media frase porque
 * hayas escrito una fecha con barras o «y/o».
 *
 * QUÉ HACE AL ELEGIR: sustituye el «/env» por el texto de la respuesta y deja
 * el cursor al final. NO envía. Una plantilla casi siempre necesita un retoque
 * antes de salir, y mandarla directa convierte un dedo torpe en un mensaje a
 * un cliente real.
 */

export function useComandos(texto: string) {
  const { data: respuestas } = useRespuestas()
  const [indice, setIndice] = useState(0)
  // Cerrado a mano con Esc. Se reabre en cuanto vuelves a escribir la barra.
  const [descartado, setDescartado] = useState(false)

  const filtro = filtroDe(texto)
  const lista = useMemo(
    () => (filtro === null ? [] : filtrarRespuestas(respuestas ?? [], filtro)),
    [respuestas, filtro],
  )
  const abierto = filtro !== null && !descartado && lista.length > 0

  // El resaltado vuelve arriba en cuanto cambia el filtro: si te quedas en la
  // quinta y filtras hasta que solo hay dos, señalarías una fila que ya no está.
  useEffect(() => { setIndice(0) }, [filtro])
  useEffect(() => { if (filtro === null) setDescartado(false) }, [filtro])

  return {
    abierto,
    lista,
    indice: Math.min(indice, Math.max(0, lista.length - 1)),
    mover: (delta: number) =>
      setIndice((i) => {
        if (!lista.length) return 0
        // Da la vuelta: desde la última hacia abajo se llega a la primera.
        return (i + delta + lista.length) % lista.length
      }),
    cerrar: () => setDescartado(true),
  }
}

/**
 * Aplica una respuesta al contenido del campo.
 *
 * Se sustituye el campo ENTERO porque el desplegable solo se abre cuando el
 * campo entero es «/algo». Devolver el texto en vez de mutar deja la decisión
 * de dónde poner el cursor en quien tiene la referencia del textarea.
 */
export function aplicarRespuesta(r: RespuestaRapida): string {
  return r.texto
}

export function ListaComandos({
  lista, indice, onElegir, onSenalar,
}: {
  lista: RespuestaRapida[]
  indice: number
  onElegir: (r: RespuestaRapida) => void
  onSenalar: (i: number) => void
}) {
  const contenedor = useRef<HTMLUListElement>(null)

  // Que la fila resaltada se vea siempre: con veinte respuestas, moverse con
  // las flechas sacaría el resaltado de la caja y parecería que no pasa nada.
  useEffect(() => {
    const el = contenedor.current?.children[indice] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [indice])

  return (
    <div className="absolute bottom-full left-0 right-0 z-20 mb-2 px-2">
      <div className="overflow-hidden rounded-xl border border-borde bg-panel shadow-lg">
        <div className="flex items-center gap-1.5 border-b border-borde px-3 py-1.5 text-[11px] text-texto2">
          <Zap className="h-3 w-3" />
          Respuestas rápidas
          <span className="ml-auto">↑↓ mover · Enter insertar · Esc cerrar</span>
        </div>
        <ul ref={contenedor} className="max-h-64 overflow-y-auto" role="listbox">
          {lista.map((r, i) => (
            <li key={r.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === indice}
                // onMouseDown y no onClick: el click quita el foco del
                // textarea antes de disparar, y entonces insertaríamos el
                // texto en un campo desenfocado y el cursor se perdería.
                onMouseDown={(e) => { e.preventDefault(); onElegir(r) }}
                onMouseEnter={() => onSenalar(i)}
                className={[
                  'flex w-full items-start gap-3 px-3 py-2 text-left',
                  i === indice ? 'bg-panel2' : 'hover:bg-panel2/60',
                ].join(' ')}
              >
                <span className="shrink-0 rounded bg-acento/15 px-1.5 py-0.5 font-mono text-xs text-acento">
                  /{r.atajo}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-texto2">
                  {r.texto.replace(/\s+/g, ' ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * Las teclas del desplegable, para que el Redactor no tenga que repetirlas.
 * Devuelve true si la tecla se ha consumido: entonces el Redactor NO debe
 * hacer lo suyo (sobre todo, Enter no debe enviar el mensaje).
 *
 * SOBRE j/k: aquí no pueden ser j y k a secas. En la lista de conversaciones
 * funcionan porque no estás escribiendo; dentro del campo de mensaje son dos
 * letras que hacen falta para filtrar, y con ellas capturadas «/jueves» sería
 * imposible de teclear. Se dejan en Ctrl+J y Ctrl+K, que es lo mismo sin
 * robarle letras al filtro.
 */
export function teclasComandos(
  e: KeyboardEvent<HTMLTextAreaElement>,
  api: { lista: RespuestaRapida[]; indice: number; mover: (d: number) => void; cerrar: () => void },
  elegir: (r: RespuestaRapida) => void,
): boolean {
  const bajar = e.key === 'ArrowDown' || (e.ctrlKey && e.key.toLowerCase() === 'j')
  const subir  = e.key === 'ArrowUp'   || (e.ctrlKey && e.key.toLowerCase() === 'k')

  if (bajar) { e.preventDefault(); api.mover(1); return true }
  if (subir) { e.preventDefault(); api.mover(-1); return true }

  if (e.key === 'Enter' || e.key === 'Tab') {
    const r = api.lista[api.indice]
    if (!r) return false
    e.preventDefault()
    elegir(r)
    return true
  }

  if (e.key === 'Escape') {
    e.preventDefault()
    // Se para aquí: si subiera, el atajo global de Escape quitaría el foco
    // del campo y perderías el mensaje a medias por cerrar un desplegable.
    e.stopPropagation()
    api.cerrar()
    return true
  }

  return false
}
