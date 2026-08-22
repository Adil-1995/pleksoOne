import { useEffect, useRef } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'

/**
 * Diálogo de confirmación para lo que no se puede deshacer solo.
 *
 * `detalle` es donde va el dato que hay que mirar antes de decir que sí —
 * el número de teléfono, el nombre de la etiqueta. Un "¿seguro?" a secas no
 * evita ningún error: lo que lo evita es ver A QUIÉN vas a bloquear.
 */
export function Confirmacion({
  abierto, titulo, detalle, cuerpo, textoConfirmar, peligrosa = false,
  trabajando = false, error, onConfirmar, onCancelar,
}: {
  abierto: boolean
  titulo: string
  /** Lo que hay que leer antes de confirmar. Se pinta grande y en monoespaciada. */
  detalle?: string
  cuerpo?: React.ReactNode
  textoConfirmar: string
  peligrosa?: boolean
  trabajando?: boolean
  error?: string | null
  onConfirmar: () => void
  onCancelar: () => void
}) {
  const cancelarRef = useRef<HTMLButtonElement>(null)

  // El foco arranca en CANCELAR, no en confirmar: si alguien llega con la
  // tecla Enter apretada, que no bloquee a un cliente sin querer.
  useEffect(() => {
    if (abierto) cancelarRef.current?.focus()
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape' && !trabajando) onCancelar() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [abierto, trabajando, onCancelar])

  if (!abierto) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={() => { if (!trabajando) onCancelar() }}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-borde bg-panel p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {peligrosa && (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-alerta/15">
              <AlertTriangle className="h-5 w-5 text-alerta" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{titulo}</h2>
            {detalle && (
              <p className="mt-2 break-all rounded-md bg-panel2 px-3 py-2 font-mono text-sm">
                {detalle}
              </p>
            )}
            {cuerpo && <div className="mt-2 text-sm text-texto2">{cuerpo}</div>}
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-md bg-alerta/10 px-3 py-2 text-xs text-alerta">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelarRef}
            onClick={onCancelar}
            disabled={trabajando}
            className="rounded-lg px-3 py-2 text-sm text-texto2 hover:bg-panel2 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={trabajando}
            className={[
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40',
              peligrosa ? 'bg-alerta text-white hover:brightness-110'
                        : 'bg-acento text-fondo hover:brightness-110',
            ].join(' ')}
          >
            {trabajando && <Loader2 className="h-4 w-4 animate-spin" />}
            {textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  )
}
