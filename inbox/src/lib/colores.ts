/**
 * PALETA CERRADA de etiquetas.
 *
 * Nueve colores y ni uno más. El mismo listado está en el CHECK de la tabla
 * `etiquetas`, así que la base de datos rechaza cualquier otro: no es una
 * convención del frontend, es una restricción de verdad.
 *
 * No hay selector libre a propósito. Con un selector, en un mes hay catorce
 * tonos de azul que nadie distingue y las etiquetas dejan de servir para
 * reconocer nada de un vistazo, que es lo único que tienen que hacer.
 *
 * OJO con las clases: van escritas ENTERAS. Tailwind lee el código fuente
 * buscando literales, así que `bg-${color}-500` no genera ningún CSS y la
 * pastilla saldría transparente.
 */
export const COLORES_ETIQUETA = [
  'rojo', 'naranja', 'ambar', 'verde', 'turquesa', 'azul', 'violeta', 'rosa', 'gris',
] as const

export type ColorEtiqueta = (typeof COLORES_ETIQUETA)[number]

export function esColorEtiqueta(v: unknown): v is ColorEtiqueta {
  return typeof v === 'string' && (COLORES_ETIQUETA as readonly string[]).includes(v)
}

interface Pinta {
  /** Pastilla en la lista y en la cabecera. */
  pastilla: string
  /** Punto sólido, para el selector y la pantalla de gestión. */
  punto: string
  etiqueta: string
}

// Cada color lleva su variante para tema claro y para oscuro. Un
// `text-red-300` bonito sobre fondo oscuro es ilegible sobre blanco, así que
// el tono del texto cambia y el del fondo no.
const PINTA: Record<ColorEtiqueta, Pinta> = {
  rojo:     { pastilla: 'bg-red-500/15 text-red-700 ring-red-500/30 dark:text-red-300',                 punto: 'bg-red-500',     etiqueta: 'Rojo' },
  naranja:  { pastilla: 'bg-orange-500/15 text-orange-700 ring-orange-500/30 dark:text-orange-300',     punto: 'bg-orange-500',  etiqueta: 'Naranja' },
  ambar:    { pastilla: 'bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300',         punto: 'bg-amber-500',   etiqueta: 'Ámbar' },
  verde:    { pastilla: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300', punto: 'bg-emerald-500', etiqueta: 'Verde' },
  turquesa: { pastilla: 'bg-teal-500/15 text-teal-700 ring-teal-500/30 dark:text-teal-300',             punto: 'bg-teal-500',    etiqueta: 'Turquesa' },
  azul:     { pastilla: 'bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300',                 punto: 'bg-sky-500',     etiqueta: 'Azul' },
  violeta:  { pastilla: 'bg-violet-500/15 text-violet-700 ring-violet-500/30 dark:text-violet-300',     punto: 'bg-violet-500',  etiqueta: 'Violeta' },
  rosa:     { pastilla: 'bg-pink-500/15 text-pink-700 ring-pink-500/30 dark:text-pink-300',             punto: 'bg-pink-500',    etiqueta: 'Rosa' },
  gris:     { pastilla: 'bg-slate-500/15 text-slate-700 ring-slate-500/30 dark:text-slate-300',         punto: 'bg-slate-500',   etiqueta: 'Gris' },
}

const RESERVA: Pinta = PINTA.gris

export function pintaDe(color: string): Pinta {
  return esColorEtiqueta(color) ? PINTA[color] : RESERVA
}

export function clasePastilla(color: string): string {
  return pintaDe(color).pastilla
}

export function clasePunto(color: string): string {
  return pintaDe(color).punto
}

export function nombreColor(color: string): string {
  return pintaDe(color).etiqueta
}
