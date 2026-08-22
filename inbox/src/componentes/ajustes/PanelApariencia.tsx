import { Sun, Moon, Monitor, Loader2 } from 'lucide-react'
import { useTema } from '@/hooks/useTema'
import type { Tema } from '@/lib/tema'

const OPCIONES: { valor: Tema; icono: typeof Sun; titulo: string; detalle: string }[] = [
  { valor: 'claro',   icono: Sun,     titulo: 'Claro',  detalle: 'Siempre claro, den las horas que den.' },
  { valor: 'oscuro',  icono: Moon,    titulo: 'Oscuro',  detalle: 'Siempre oscuro.' },
  { valor: 'sistema', icono: Monitor, titulo: 'Seguir al sistema',
    detalle: 'Lo que tenga el móvil o el ordenador en cada momento.' },
]

/**
 * Tres estados, no un interruptor de dos: sin "seguir al sistema" no hay
 * forma de decir "de día claro y de noche oscuro sin tocar nada", que es lo
 * que quiere casi todo el mundo.
 *
 * Se guarda en el perfil de Supabase, no en localStorage: viaja con la
 * sesión y funciona igual dentro de Capacitor.
 */
export function PanelApariencia() {
  const { tema, cambiar, guardando, error } = useTema()

  return (
    <div className="space-y-2">
      {OPCIONES.map(({ valor, icono: Icono, titulo, detalle }) => {
        const puesto = tema === valor
        return (
          <button
            key={valor}
            onClick={() => cambiar(valor)}
            disabled={guardando}
            aria-pressed={puesto}
            className={[
              'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60',
              puesto ? 'border-acento bg-acento/10' : 'border-borde bg-panel hover:bg-panel2',
            ].join(' ')}
          >
            <Icono className={['mt-0.5 h-5 w-5 shrink-0', puesto ? 'text-acento' : 'text-texto2'].join(' ')} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{titulo}</span>
              <span className="block text-[11px] text-texto2">{detalle}</span>
            </span>
            {guardando && puesto && <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-texto2" />}
          </button>
        )
      })}

      {error && <p className="rounded bg-alerta/10 px-3 py-2 text-xs text-alerta">{error}</p>}
    </div>
  )
}
