import { Link } from 'react-router-dom'
import { BotOff } from 'lucide-react'
import { useCanales } from '@/hooks/datos'
import { mariaAtiende } from '@/lib/canales'
import type { Canal } from '@/tipos'

/**
 * "No quiero pausar un número y olvidarme."
 *
 * Ese es todo el motivo de este componente. Un interruptor escondido en
 * Ajustes que deja al bot mudo es exactamente la clase de cosa que se
 * descubre tres días después, contando pedidos que no llegaron. Así que la
 * pausa se anuncia en la lista, mientras dure, con enlace directo para
 * deshacerla — y no se puede cerrar: un aviso que se descarta es un aviso
 * que se descarta el primer día.
 */
export function AvisoCanalesPausados() {
  const { data: canales } = useCanales()
  const pausados = (canales ?? []).filter((c) => c.activo && !mariaAtiende(c))
  if (!pausados.length) return null

  return (
    <Link
      to="/ajustes"
      className="flex items-start gap-2 border-b border-alerta/30 bg-alerta/10 px-3 py-2 text-alerta hover:bg-alerta/15"
    >
      <BotOff className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 text-xs leading-snug">
        <span className="font-semibold">
          {pausados.length === 1
            ? `María está pausada en ${pausados[0].nombre}`
            : `María está pausada en ${pausados.length} canales`}
        </span>
        <span className="block opacity-80">
          {pausados.length > 1 && `${pausados.map((c) => c.nombre).join(' · ')}. `}
          Los mensajes siguen entrando: los contesta un humano o no los contesta nadie.
        </span>
      </span>
    </Link>
  )
}

/** El mismo aviso, pero para UNA conversación, dentro del hilo. */
export function AvisoCanalDelHilo({ canal }: { canal?: Canal }) {
  if (mariaAtiende(canal)) return null
  return (
    <div className="flex items-center gap-2 border-b border-alerta/30 bg-alerta/10 px-4 py-1.5 text-[11px] text-alerta">
      <BotOff className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        María está pausada en <b>{canal?.nombre}</b>. Aquí contestas tú.
      </span>
      <Link to="/ajustes" className="shrink-0 underline underline-offset-2 hover:no-underline">
        Ajustes
      </Link>
    </div>
  )
}
