import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Settings, Tags, Radio, Palette, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { InterruptorTema } from '@/componentes/InterruptorTema'
import { PanelEtiquetas } from '@/componentes/ajustes/PanelEtiquetas'
import { PanelCanales } from '@/componentes/ajustes/PanelCanales'
import { PanelApariencia } from '@/componentes/ajustes/PanelApariencia'

/**
 * Ajustes, con pestañas.
 *
 * AÑADIR UNA PESTAÑA NUEVA ES AÑADIR UNA ENTRADA A ESTA LISTA. El resto
 * —navegación, cabecera, el panel— sale de aquí solo. Es el motivo de que
 * las pestañas sean datos y no JSX repetido: la próxima (plantillas,
 * horarios, usuarios) no debería obligar a tocar nada más que este array y
 * su propio componente.
 */
const PESTANAS = [
  { id: 'etiquetas',  nombre: 'Etiquetas',  icono: Tags,    Panel: PanelEtiquetas },
  { id: 'canales',    nombre: 'Canales',    icono: Radio,   Panel: PanelCanales },
  { id: 'apariencia', nombre: 'Apariencia', icono: Palette, Panel: PanelApariencia },
] as const

type IdPestana = (typeof PESTANAS)[number]['id']

export function PaginaAjustes() {
  const [activa, setActiva] = useState<IdPestana>('etiquetas')
  const actual = PESTANAS.find((p) => p.id === activa) ?? PESTANAS[0]
  const Panel = actual.Panel

  return (
    <div className="flex h-full flex-col bg-fondo">
      <header className="flex shrink-0 items-center gap-3 border-b border-borde bg-panel px-4 py-3">
        <Link to="/" className="-ml-1 rounded p-1.5 text-texto2 hover:bg-panel2" aria-label="Volver al inbox">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Settings className="h-5 w-5 text-acento" />
        <h1 className="font-semibold">Ajustes</h1>
      </header>

      {/* Las pestañas hacen scroll horizontal: con seis o siete no se
          desbordan sin aviso, se desplazan. */}
      <nav
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-borde bg-panel px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        {PESTANAS.map(({ id, nombre, icono: Icono }) => {
          const puesta = id === activa
          return (
            <button
              key={id}
              role="tab"
              aria-selected={puesta}
              onClick={() => setActiva(id)}
              className={[
                'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                puesta ? 'bg-acento text-fondo' : 'bg-panel2 text-texto2 hover:text-texto',
              ].join(' ')}
            >
              <Icono className="h-4 w-4" />
              {nombre}
            </button>
          )
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl p-4">
          <Panel />
        </div>

        {/*
          Cerrar sesión, abajo del todo y con su propia separación. No es un
          ajuste: es salir. Mezclarlo con las pestañas hace que un dedo
          torpe cierre la sesión buscando otra cosa.
        */}
        <div className="mx-auto w-full max-w-2xl border-t border-borde px-4 py-6">
          <button
            onClick={() => supabase.auth.signOut()}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-alerta hover:bg-alerta/10"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  )
}

/** Se reexporta para que la cabecera del inbox no importe de dos sitios. */
export { InterruptorTema }
