import { supabase } from './supabase'

export type Tema = 'claro' | 'oscuro' | 'sistema'
export const TEMAS: Tema[] = ['claro', 'oscuro', 'sistema']

const PREGUNTA_OSCURO = '(prefers-color-scheme: dark)'

export function esTema(v: unknown): v is Tema {
  return v === 'claro' || v === 'oscuro' || v === 'sistema'
}

/** Lo que el sistema operativo dice ahora mismo. */
export function temaDelSistema(): 'claro' | 'oscuro' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'oscuro'
  return window.matchMedia(PREGUNTA_OSCURO).matches ? 'oscuro' : 'claro'
}

/** El tema efectivo: "sistema" se resuelve al que toque en este momento. */
export function resolver(tema: Tema): 'claro' | 'oscuro' {
  return tema === 'sistema' ? temaDelSistema() : tema
}

/**
 * Escribe el tema en <html>. Toda la paleta cuelga de este atributo.
 *
 * `sistema` no llega nunca al DOM: se resuelve antes. Así el CSS solo tiene
 * que conocer dos estados y no hace falta duplicar la paleta dentro de un
 * `@media (prefers-color-scheme)`.
 */
export function aplicar(tema: Tema): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-tema', resolver(tema))
}

/**
 * Avisa cuando el sistema cambia de claro a oscuro.
 * Solo hace algo si el usuario eligió "sistema"; en otro caso su elección
 * manda y el cambio del móvil se ignora.
 */
export function escucharSistema(alCambiar: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(PREGUNTA_OSCURO)
  const fn = () => alCambiar()
  // Safari viejo (y el WebView de iOS) no tiene addEventListener en MediaQueryList.
  if (mq.addEventListener) { mq.addEventListener('change', fn); return () => mq.removeEventListener('change', fn) }
  mq.addListener(fn)
  return () => mq.removeListener(fn)
}

/**
 * PERSISTENCIA — en el perfil del usuario de Supabase, NO en localStorage.
 *
 * Va en `user_metadata`, que es literalmente el perfil: viaja con la sesión,
 * lo mismo en el navegador que dentro de Capacitor, y se sincroniza entre el
 * móvil y el escritorio sin tabla nueva ni RLS que revisar.
 *
 * localStorage quedaría atrapado en un dispositivo y encima se pierde al
 * limpiar datos del navegador, que es justo lo que se hace cuando algo va mal.
 */
export function temaDelPerfil(metadata: Record<string, unknown> | undefined): Tema {
  const v = metadata?.tema
  return esTema(v) ? v : 'sistema'
}

export async function guardarTema(tema: Tema): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data: { tema } })
  if (error) throw new Error(error.message)
}
