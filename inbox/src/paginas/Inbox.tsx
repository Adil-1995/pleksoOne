import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { MessagesSquare, Settings } from 'lucide-react'
import { useConversaciones, useCanales, useRealtime } from '@/hooks/datos'
import { useAtajos } from '@/hooks/useAtajos'
import { ListaConversaciones } from '@/componentes/ListaConversaciones'
import { Cabecera } from '@/componentes/Cabecera'
import { Hilo } from '@/componentes/Hilo'
import { Redactor } from '@/componentes/Redactor'
import { VisorImagen } from '@/componentes/VisorImagen'
import { AvisoCanalesPausados, AvisoCanalDelHilo } from '@/componentes/AvisoCanalPausado'
import { Vacio } from '@/componentes/Esqueletos'
import { ErrorBoundary } from '@/componentes/ErrorBoundary'
import type { Canal } from '@/tipos'

export function Inbox() {
  const { clienteId } = useParams()
  const { data: conversaciones } = useConversaciones()
  const { data: canales } = useCanales()

  useRealtime(clienteId)
  useAtajos(conversaciones ?? [])

  const conv = useMemo(
    () => (conversaciones ?? []).find((c) => c.cliente_id === clienteId),
    [conversaciones, clienteId],
  )
  const canal = useMemo<Canal | undefined>(
    () => (canales ?? []).find((c) => c.id === conv?.canal_id),
    [canales, conv],
  )

  return (
    <div className="flex h-full">
      {/* Panel izquierdo: en móvil se oculta cuando hay conversación abierta */}
      <aside
        className={[
          'w-full shrink-0 flex-col border-r border-borde bg-panel md:flex md:w-[380px]',
          clienteId ? 'hidden md:flex' : 'flex',
        ].join(' ')}
      >
        <div className="flex items-center justify-between gap-2 border-b border-borde px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <MessagesSquare className="h-5 w-5 shrink-0 text-acento" />
            <span className="truncate font-semibold">Inbox</span>
          </div>
          {/* UN solo icono. Antes había tres sueltos —tema, etiquetas,
              canales— más el de salir: cuatro cosas que se tocan una vez al
              mes ocupando la cabecera que se mira todo el día. */}
          <Link
            to="/ajustes"
            className="shrink-0 rounded p-1.5 text-texto2 hover:bg-panel2"
            title="Ajustes"
            aria-label="Ajustes"
          >
            <Settings className="h-4 w-4" />
          </Link>
        </div>
        <AvisoCanalesPausados />
        <div className="min-h-0 flex-1">
          <ListaConversaciones />
        </div>
      </aside>

      {/* Panel derecho */}
      <main className={['min-w-0 flex-1 flex-col', clienteId ? 'flex' : 'hidden md:flex'].join(' ')}>
        {conv ? (
          // Cada mitad con su red: si revienta el hilo, la lista sigue viva.
          <ErrorBoundary zona={"la conversación " + conv.cliente_id} key={conv.cliente_id}>
            <Cabecera conv={conv} canal={canal} />
            <AvisoCanalDelHilo canal={canal} />
            <Hilo conv={conv} />
            <Redactor conv={conv} canal={canal} />
          </ErrorBoundary>
        ) : (
          <div className="fondo-hilo flex h-full items-center justify-center">
            <Vacio
              titulo="Elige una conversación"
              detalle="j / k para moverte · / para buscar · Esc para cerrar"
            />
          </div>
        )}
      </main>

      <VisorImagen />
    </div>
  )
}
