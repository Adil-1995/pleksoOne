import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '@/store/ui'
import type { Conversacion } from '@/tipos'

/**
 * Atajos de teclado: j/k mover, Ctrl+B buscar, Esc cerrar.
 *
 * Las teclas SUELTAS (j, k) no se disparan mientras escribes en un campo: si
 * no, sería imposible teclear una jota dentro de un mensaje.
 *
 * Ctrl+B SÍ funciona escribiendo, y a propósito. Es un acorde, no se pulsa sin
 * querer, y si solo funcionara fuera del campo habría que salir del mensaje
 * para poder buscar.
 *
 * La barra ya no abre el buscador: ahora es de los comandos de respuestas
 * rápidas del campo de mensaje (ver ComandosRespuestas.tsx).
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

      // Ctrl+B / Cmd+B: buscar. Va ANTES del corte de «estás escribiendo»
      // porque tiene que funcionar también con el cursor en el mensaje.
      //
      // El preventDefault no es decorativo: en Firefox, Ctrl+B abre la barra
      // lateral de marcadores. En Chrome y Edge no está asignado (los
      // marcadores son Ctrl+Shift+B). Dentro del campo no pisa la negrita
      // porque el compositor es un <textarea>, y ahí Ctrl+B no hace nada en
      // ningún navegador: la negrita solo existe en texto enriquecido.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        abrirBuscador()
        return
      }

      if (escribiendo(e.target) || e.metaKey || e.ctrlKey || e.altKey) return

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
