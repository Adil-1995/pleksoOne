import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '@/store/ui'
import type { Conversacion } from '@/tipos'

/**
 * Atajos de teclado: j/k mover, / buscar, Esc cerrar.
 * No se disparan mientras escribes en un campo, que si no sería imposible
 * teclear una barra dentro de un mensaje.
 */
export function useAtajos(conversaciones: Conversacion[]) {
  const navegar = useNavigate()
  const { clienteId } = useParams()
  const {
    resaltado, moverResaltado, cerrarVisor, visor, setBusqueda,
    buscadorAbierto, abrirBuscador, cerrarBuscador,
  } = useUI()

  useEffect(() => {
    function escribiendo(t: EventTarget | null): boolean {
      const el = t as HTMLElement | null
      if (!el) return false
      return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable === true
      )
    }

    function alPulsar(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (visor) { cerrarVisor(); return }
        // El buscador ya no tiene fila fija: Escape lo pliega del todo, que
        // es lo que devuelve el alto a la lista. Solo quitarle el foco
        // dejaría la barra abierta ocupando sitio.
        if (buscadorAbierto) { cerrarBuscador(); (e.target as HTMLElement)?.blur?.(); return }
        if (escribiendo(e.target)) { (e.target as HTMLElement).blur(); return }
        if (clienteId) navegar('/')
        return
      }

      if (escribiendo(e.target) || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === '/') {
        e.preventDefault()
        // Abrir y enfocar lo hace el propio componente; antes esto buscaba
        // un input que ahora solo existe cuando el buscador está desplegado.
        abrirBuscador()
        return
      }

      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        const delta = e.key === 'j' ? 1 : -1
        const siguiente = Math.max(0, Math.min(conversaciones.length - 1, resaltado + delta))
        moverResaltado(delta, conversaciones.length)
        const c = conversaciones[siguiente]
        if (c) navegar(`/c/${c.cliente_id}`)
        return
      }

      if (e.key === 'Backspace' && !clienteId) {
        setBusqueda('')
      }
    }

    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [conversaciones, resaltado, moverResaltado, navegar, clienteId, visor, cerrarVisor,
      setBusqueda, buscadorAbierto, abrirBuscador, cerrarBuscador])
}
