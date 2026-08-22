import { Sun, Moon, Monitor } from 'lucide-react'
import { useTema } from '@/hooks/useTema'
import type { Tema } from '@/lib/tema'

const OPCIONES: { valor: Tema; icono: typeof Sun; titulo: string }[] = [
  { valor: 'claro',   icono: Sun,     titulo: 'Claro' },
  { valor: 'oscuro',  icono: Moon,    titulo: 'Oscuro' },
  { valor: 'sistema', icono: Monitor, titulo: 'Seguir al sistema' },
]

/**
 * Tres estados explícitos, no un interruptor de dos.
 *
 * Con un interruptor claro/oscuro no hay forma de decir "el que tenga el
 * móvil", que es lo que quiere casi todo el mundo: de día claro y de noche
 * oscuro, sin tocar nada.
 */
export function InterruptorTema() {
  const { tema, cambiar, guardando, error } = useTema()

  return (
    <div
      className="flex items-center gap-0.5 rounded-full bg-panel2 p-0.5"
      role="radiogroup"
      aria-label="Tema"
      title={error ?? undefined}
    >
      {OPCIONES.map(({ valor, icono: Icono, titulo }) => {
        const puesto = tema === valor
        return (
          <button
            key={valor}
            role="radio"
            aria-checked={puesto}
            aria-label={titulo}
            title={titulo}
            disabled={guardando}
            onClick={() => cambiar(valor)}
            className={[
              'rounded-full p-1.5 transition-colors disabled:opacity-50',
              puesto ? 'bg-acento text-fondo' : 'text-texto2 hover:text-texto',
            ].join(' ')}
          >
            <Icono className="h-4 w-4" />
          </button>
        )
      })}
    </div>
  )
}
