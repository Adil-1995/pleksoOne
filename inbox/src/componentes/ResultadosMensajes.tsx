import { useNavigate } from 'react-router-dom'
import { Search, Loader2 } from 'lucide-react'
import {
  useBuscarMensajes, agrupar, MINIMO_BUSQUEDA, TOPE_RESULTADOS,
} from '@/hooks/useBuscarMensajes'
import { horaLista, iniciales, colorAvatar, telefonoLegible } from '@/lib/formato'
import type { Conversacion } from '@/tipos'

/**
 * Parte el texto en trozos, marcando los que casan con lo buscado.
 *
 * Se hace aquí y no en el servidor a propósito: el servidor devuelve el texto
 * tal cual y el resaltado es cosa de cómo se pinta. Además así resalta TODAS
 * las apariciones, no solo la que hizo casar la fila.
 *
 * `escapar` no es decorativo: sin él, buscar «(» revienta el `RegExp` y la
 * lista entera se queda en blanco por un paréntesis.
 */
function escapar(t: string): string {
  return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function Resaltado({ texto, termino }: { texto: string; termino: string }) {
  const q = termino.trim()
  if (!q) return <>{texto}</>
  const partes = texto.split(new RegExp('(' + escapar(q) + ')', 'gi'))
  return (
    <>
      {partes.map((p, i) =>
        p.toLowerCase() === q.toLowerCase()
          ? <mark key={i} className="rounded-sm bg-amber-300 px-0.5 text-black">{p}</mark>
          : <span key={i}>{p}</span>,
      )}
    </>
  )
}

/**
 * UN TROZO ALREDEDOR DE LO ENCONTRADO, no el mensaje entero.
 *
 * Un cliente puede mandar su dirección completa en un solo mensaje. Si se
 * pinta entera, un resultado ocupa media pantalla y los otros once no se ven.
 * Se recorta dejando contexto por los dos lados, y se avisa con «…» de que
 * hay más antes o después.
 */
function trozo(texto: string, termino: string, margen = 45): string {
  const i = texto.toLowerCase().indexOf(termino.trim().toLowerCase())
  if (i < 0) return texto.slice(0, margen * 2)
  const desde = Math.max(0, i - margen)
  const hasta = Math.min(texto.length, i + termino.length + margen)
  return (desde > 0 ? '…' : '') + texto.slice(desde, hasta) + (hasta < texto.length ? '…' : '')
}

/**
 * Los mensajes encontrados en el SERVIDOR, debajo de las conversaciones.
 *
 * Va debajo y no en lugar de la lista porque son dos respuestas distintas a
 * lo mismo: arriba, las conversaciones cuyo nombre o número casan; aquí, lo
 * que alguien escribió DENTRO. WhatsApp las separa igual.
 */
export function ResultadosMensajes({
  termino, conversaciones,
}: {
  termino: string
  conversaciones: Conversacion[]
}) {
  const navegar = useNavigate()
  const { data, isFetching, error } = useBuscarMensajes(termino)

  if (termino.trim().length < MINIMO_BUSQUEDA) return null

  const grupos = agrupar(data ?? [])
  const porCliente = new Map(conversaciones.map((c) => [c.cliente_id, c]))

  return (
    <div className="border-t border-borde">
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-texto2">
        <Search className="h-3.5 w-3.5" />
        Mensajes
        {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
        {!isFetching && data && (
          <span className="font-normal opacity-70">
            {data.length === 0
              ? 'ninguno'
              : grupos.length + (grupos.length === 1 ? ' conversación' : ' conversaciones')}
          </span>
        )}
      </div>

      {error && (
        <div className="px-3 pb-2 text-xs text-alerta">
          No se pudo buscar: {String(error)}
        </div>
      )}

      {/* El tope SE DICE. Un «50» mudo hace creer que no hay nada más. */}
      {data && data.length >= TOPE_RESULTADOS && (
        <div className="px-3 pb-1 text-[11px] text-texto2">
          Se muestran los {TOPE_RESULTADOS} más recientes. Afina la búsqueda si falta alguno.
        </div>
      )}

      {grupos.map((g) => {
        const conv = porCliente.get(g.clienteId)
        return (
          <button
            key={g.clienteId}
            onClick={() => navegar('/c/' + g.clienteId)}
            className="flex w-full gap-3 border-b border-borde px-3 py-2 text-left hover:bg-panel2"
          >
            <span
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
              style={{ background: colorAvatar(g.clienteId) }}
            >
              {iniciales(conv?.nombre ?? null, g.clienteId)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium tabular-nums">
                  {telefonoLegible(g.clienteId)}
                </span>
                {conv?.nombre && (
                  <span className="truncate text-xs text-texto2">{conv.nombre}</span>
                )}
                <span className="ml-auto shrink-0 text-[11px] text-texto2">
                  {horaLista(g.mensajes[0].creado)}
                </span>
              </span>
              {g.mensajes.slice(0, 3).map((m) => (
                <span key={m.id} className="mt-0.5 block truncate text-xs text-texto2">
                  <Resaltado texto={trozo(m.texto ?? '', termino)} termino={termino} />
                </span>
              ))}
              {g.mensajes.length > 3 && (
                <span className="mt-0.5 block text-[11px] opacity-60">
                  y {g.mensajes.length - 3} más en esta conversación
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
