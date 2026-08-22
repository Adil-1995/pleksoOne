import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/**
 * Diálogo que NUNCA se ancla a lo que lo abrió.
 *
 * Va por un portal a <body> a propósito. Las filas de la lista están
 * posicionadas con `transform: translateY(...)` porque están virtualizadas, y
 * un `transform` crea un bloque contenedor: dentro de él, `position: fixed`
 * deja de referirse a la ventana y pasa a referirse a la fila. Un menú
 * colgado del icono se salía del panel por la izquierda y se cortaba —
 * ni el título ni los nombres de los productos se leían.
 *
 * En móvil sube desde abajo a todo el ancho, que es donde el pulgar llega.
 * En escritorio va centrado. En los dos casos el ancho lo manda la ventana,
 * no el botón.
 */
export function Modal({
  abierto, titulo, onCerrar, children,
}: {
  abierto: boolean
  titulo: string
  onCerrar: () => void
  children: React.ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', esc)
    // Sin esto, en el móvil se puede hacer scroll de la lista por debajo del
    // diálogo y al cerrarlo te has movido de sitio sin querer.
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus()
    return () => {
      window.removeEventListener('keydown', esc)
      document.body.style.overflow = overflow
    }
  }, [abierto, onCerrar])

  if (!abierto) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onClick={onCerrar}
    >
      <div
        ref={panel}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={[
          'w-full overflow-hidden bg-panel shadow-xl outline-none',
          // Móvil: hoja pegada abajo, esquinas redondeadas solo arriba.
          'max-h-[85vh] rounded-t-2xl',
          // Escritorio: caja centrada y contenida. `mx-4` para que nunca
          // toque el borde de la ventana.
          'sm:mx-4 sm:max-w-sm sm:rounded-2xl sm:border sm:border-borde',
        ].join(' ')}
      >
        <div className="flex items-center justify-between gap-3 border-b border-borde px-4 py-3">
          <h2 className="min-w-0 truncate text-sm font-semibold">{titulo}</h2>
          <button
            onClick={onCerrar}
            className="-mr-1 shrink-0 rounded-full p-1.5 text-texto2 hover:bg-panel2 hover:text-texto"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
