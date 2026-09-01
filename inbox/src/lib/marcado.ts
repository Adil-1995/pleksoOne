/**
 * El marcado de WhatsApp, a trozos con estilo.
 *
 * POR QUÉ HACE FALTA. El cuerpo del anuncio que manda Meta viene con el
 * marcado puesto: llegaba literal —«**Soporte Inteligente 360°**», con los
 * asteriscos a la vista— porque la burbuja lo pintaba como texto plano.
 * En WhatsApp el cliente lo ve en negrita, así que aquí también.
 *
 * POR QUÉ UNA FUNCIÓN PURA Y NO UN COMPONENTE. Esto devuelve TROZOS, no
 * JSX, para poder probarlo desde node sin montar React. Lo que puede
 * romperse en silencio no es el `<strong>`, es decidir qué es una marca y
 * qué no: un guion bajo dentro de `nombre_fichero` o un asterisco de una
 * lista con viñetas se comerían medio mensaje sin dar error.
 *
 * QUÉ RECONOCE
 *   **negrita**  *negrita*   (Markdown y WhatsApp; el anuncio usa el doble)
 *   _cursiva_
 *   ~~tachado~~  ~tachado~
 *   `mono`
 *
 * QUÉ NO, A PROPÓSITO
 *   Ni enlaces, ni títulos, ni listas, ni bloques de código. Esto no es un
 *   renderizador de Markdown: es lo que WhatsApp pinta, ni más ni menos.
 *   Un `# ` al principio de una línea es un texto que empieza por almohadilla.
 */

export interface Trozo {
  texto: string
  negrita?: boolean
  cursiva?: boolean
  tachado?: boolean
  mono?: boolean
}

type Estilo = 'negrita' | 'cursiva' | 'tachado' | 'mono'

/**
 * Las marcas, de la más larga a la más corta. El orden IMPORTA: si `*` se
 * probara antes que `**`, «**hola**» abriría con el primer asterisco y
 * cerraría con el segundo, dejando un trozo vacío en negrita y el resto
 * del texto suelto con asteriscos.
 */
const MARCAS: { marca: string; estilo: Estilo }[] = [
  { marca: '**', estilo: 'negrita' },
  { marca: '~~', estilo: 'tachado' },
  { marca: '*',  estilo: 'negrita' },
  { marca: '_',  estilo: 'cursiva' },
  { marca: '~',  estilo: 'tachado' },
  { marca: '`',  estilo: 'mono'    },
]

/** Alfanumérico, tildes incluidas: «año_2026» tiene que contar como palabra. */
function esPalabra(c: string | undefined): boolean {
  return !!c && /[\p{L}\p{N}]/u.test(c)
}

function esBlanco(c: string | undefined): boolean {
  return c === undefined || /\s/.test(c)
}

/**
 * ¿Se abre una marca justo aquí?
 *
 * Las dos condiciones que evitan los falsos positivos que importan:
 *
 *   - Detrás de la marca NO puede haber un espacio. Eso descarta la viñeta
 *     de una lista («* Envío gratis»), que es el caso que más aparece en el
 *     texto de un anuncio.
 *   - El guion bajo, además, tiene que ir pegado a un borde de palabra. Sin
 *     eso, `nombre_fichero_largo` se pintaría con «fichero» en cursiva.
 */
function abreAqui(texto: string, i: number, activos: Set<Estilo>): { marca: string; estilo: Estilo } | null {
  for (const m of MARCAS) {
    if (!texto.startsWith(m.marca, i)) continue
    // Una marca dentro de sí misma no se reabre: «*a *b* c*» se lee como
    // un solo tramo, no como una muñeca rusa que se come el texto.
    if (activos.has(m.estilo)) continue
    const siguiente = texto[i + m.marca.length]
    if (esBlanco(siguiente)) continue
    if (m.marca === '_' && esPalabra(texto[i - 1])) continue
    return m
  }
  return null
}

/**
 * Dónde cierra. -1 si no cierra, y entonces la marca NO es una marca: se
 * queda como texto. Un asterisco suelto tiene que verse como un asterisco.
 */
function buscarCierre(texto: string, desde: number, marca: string): number {
  for (let j = desde; j <= texto.length - marca.length; j++) {
    if (!texto.startsWith(marca, j)) continue
    if (j === desde) continue                    // vacío: «**» no es negrita
    if (esBlanco(texto[j - 1])) continue         // «hola *que tal *» no cierra
    if (marca === '_' && esPalabra(texto[j + marca.length])) continue
    return j
  }
  return -1
}

function analizar(texto: string, activos: Set<Estilo>, salida: Trozo[]): void {
  let acumulado = ''
  let i = 0

  const soltar = () => {
    if (!acumulado) return
    const t: Trozo = { texto: acumulado }
    for (const e of activos) t[e] = true
    salida.push(t)
    acumulado = ''
  }

  while (i < texto.length) {
    const m = abreAqui(texto, i, activos)
    if (m) {
      const cierre = buscarCierre(texto, i + m.marca.length, m.marca)
      if (cierre !== -1) {
        soltar()
        const dentro = new Set(activos)
        dentro.add(m.estilo)
        // El contenido siempre es MÁS CORTO que lo que entró (se comen las
        // dos marcas), así que esto termina siempre.
        analizar(texto.slice(i + m.marca.length, cierre), dentro, salida)
        i = cierre + m.marca.length
        continue
      }
    }
    acumulado += texto[i]
    i += 1
  }

  soltar()
}

/**
 * El texto partido en trozos con su estilo. Un texto sin marcas devuelve
 * un solo trozo sin estilos, que es el caso normal y no cuesta nada.
 */
export function trozos(texto: string | null | undefined): Trozo[] {
  const t = String(texto ?? '')
  if (!t) return []
  const salida: Trozo[] = []
  analizar(t, new Set(), salida)
  return salida
}
