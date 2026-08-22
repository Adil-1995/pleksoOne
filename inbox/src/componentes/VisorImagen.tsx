import { useEffect } from 'react'
import { X, Download } from 'lucide-react'
import { useUI } from '@/store/ui'

/** Imagen a pantalla completa. Esc cierra, y el fondo también. */
export function VisorImagen() {
  const { visor, cerrarVisor } = useUI()

  useEffect(() => {
    if (!visor) return
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrarVisor() }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [visor, cerrarVisor])

  if (!visor) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={cerrarVisor}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute right-3 top-3 flex gap-2">
        <a
          href={visor.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20"
          aria-label="Abrir original"
        >
          <Download className="h-5 w-5" />
        </a>
        <button
          onClick={cerrarVisor}
          className="rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <img
        src={visor.url}
        alt={visor.nombre || ''}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[92vw] object-contain"
      />
    </div>
  )
}
