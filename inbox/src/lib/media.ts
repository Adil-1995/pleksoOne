import { LIMITES_MEDIA } from './canales'

export type TipoMedia = 'image' | 'video' | 'audio' | 'document'

export function tipoDeFichero(f: File): TipoMedia {
  if (f.type.startsWith('image/')) return 'image'
  if (f.type.startsWith('video/')) return 'video'
  if (f.type.startsWith('audio/')) return 'audio'
  return 'document'
}

/**
 * Nombre apto para una clave de Storage: sin acentos, espacios ni signos.
 * Se conserva la extensión, que es lo que hace que el navegador y WhatsApp
 * sepan qué es el fichero.
 */
export function nombreSeguro(nombre: string): string {
  const limpio = nombre
    .normalize('NFD').replace(/[̀-ͯ]/g, '')    // fuera tildes
    .replace(/[^A-Za-z0-9._-]+/g, '-')                   // fuera todo lo raro
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
  // 80 caracteres es de sobra y evita rutas absurdas.
  if (limpio.length <= 80) return limpio || 'fichero'
  const punto = limpio.lastIndexOf('.')
  const ext = punto > 0 ? limpio.slice(punto) : ''
  return limpio.slice(0, 80 - ext.length) + ext
}

/**
 * Nombre legible a partir de la ruta (o URL) de Storage.
 *
 * Las rutas salientes se guardan como `salientes/{cliente}/{ts}-{nombre}`,
 * así que el nombre original se recupera quitando el sello de tiempo. Eso
 * evita tener que añadir una columna solo para esto.
 *
 * El anclaje de `^\d+-` es importante: un fichero que se llame de verdad
 * "2024-informe.pdf" se guarda como "1787391234-2024-informe.pdf" y solo
 * se le quita el primer bloque, no el año.
 */
export function nombreDeRuta(ruta: string | null | undefined): string | null {
  if (!ruta) return null
  let ultimo = ruta.split('?')[0].split('/').pop() || ''
  try { ultimo = decodeURIComponent(ultimo) } catch { /* se queda como está */ }
  const sinSello = ultimo.replace(/^\d{10,}-/, '')
  return sinSello || null
}

export interface Revision {
  ok: boolean
  motivo?: string
  tipo: TipoMedia
  limite: number
}

/**
 * Se comprueba ANTES de subir nada.
 * Subir 15 MB para que Meta lo rechace al final es la peor experiencia posible,
 * sobre todo con datos móviles.
 */
export function revisar(f: File): Revision {
  const tipo = tipoDeFichero(f)
  const limite = LIMITES_MEDIA[tipo]
  if (f.size <= limite) return { ok: true, tipo, limite }

  // Las imágenes se comprimen, así que pasarse no es fatal todavía.
  if (tipo === 'image') return { ok: true, tipo, limite }

  return {
    ok: false,
    tipo,
    limite,
    motivo:
      `Este ${tipo === 'video' ? 'vídeo' : 'fichero'} pesa ` +
      `${(f.size / 1048576).toFixed(1)} MB y WhatsApp acepta como mucho ` +
      `${Math.round(limite / 1048576)} MB. Hay que reducirlo antes de enviarlo.`,
  }
}

/**
 * Los ÚNICOS tipos que WhatsApp acepta como `image`: jpeg y png.
 *
 * Todo lo demás —webp, bmp, avif, tiff, gif— hay que convertirlo antes de
 * enviarlo. Si no, Meta lo rechaza al descargar la URL y aquí solo se ve un
 * envío fallido sin explicación, que es el peor sitio donde enterarse.
 */
export const IMAGEN_WA = new Set(['image/jpeg', 'image/png'])

/** El navegador no ha sabido descodificar la imagen (HEIC, un SVG sin tamaño…). */
export class ImagenIlegible extends Error {}

/** Una imagen cuya animación se pierde al convertirla. */
export function pierdeAnimacion(f: File): boolean {
  return f.type === 'image/gif' || f.type === 'image/apng'
}

/**
 * La imagen que trae el portapapeles, venga como venga.
 *
 * Se miran las DOS puertas. `files` es la habitual, pero hay combinaciones
 * —según el navegador y la aplicación de origen— en las que la imagen solo
 * aparece en `items`. Mirando una sola, pegar funciona desde unos sitios y
 * desde otros no, sin ningún patrón visible para quien lo usa.
 *
 * OJO: hay que llamarla SÍNCRONAMENTE dentro del onPaste. Pasado el primer
 * `await`, el navegador ya ha vaciado el portapapeles del evento y esto
 * devuelve null aunque la imagen estuviera ahí.
 */
export function imagenDelPortapapeles(dt: DataTransfer): File | null {
  for (const f of Array.from(dt.files)) {
    if (f.type.startsWith('image/')) return conNombreDePegado(f)
  }
  for (const it of Array.from(dt.items)) {
    if (it.kind !== 'file' || !it.type.startsWith('image/')) continue
    const f = it.getAsFile()
    if (f) return conNombreDePegado(f)
  }
  return null
}

/**
 * Una imagen pegada llega sin nombre, o con el mismo `image.png` siempre.
 * Se le pone uno con sello de tiempo para que en el hilo se distingan unas
 * de otras y para que no parezca que se ha reenviado la misma foto.
 */
function conNombreDePegado(f: File): File {
  const generico = !f.name || /^image\.[a-z0-9]+$/i.test(f.name)
  if (!generico) return f
  const ext = (f.type.split('/')[1] || 'png').replace('+xml', '')
  const s = new Date()
  const dosCifras = (n: number) => String(n).padStart(2, '0')
  const sello = `${s.getFullYear()}${dosCifras(s.getMonth() + 1)}${dosCifras(s.getDate())}` +
                `-${dosCifras(s.getHours())}${dosCifras(s.getMinutes())}${dosCifras(s.getSeconds())}`
  return new File([f], `pegada-${sello}.${ext}`, { type: f.type })
}

/**
 * Deja la imagen en un formato que WhatsApp acepte, y dentro del límite.
 *
 * Antes esto solo comprimía, y de paso convertía a JPEG *si* hacía falta
 * comprimir. Eso dejaba dos agujeros: un webp o un bmp que ya cabía se
 * enviaba con su tipo original y Meta lo rechazaba, y un GIF salía por un
 * `return` temprano y acababa igual. Ahora SIEMPRE se re-codifica a jpeg o
 * png, que son los dos únicos que Meta admite.
 *
 * El PNG se conserva cuando la imagen tiene transparencia: pasarla a JPEG
 * le pone fondo NEGRO, y un logo o una captura con esquinas transparentes
 * llegaban al cliente con un marco negro. Si no cabe en el límite, se cae a
 * JPEG, porque más vale fondo negro que no poder enviarla.
 */
export async function comprimirImagen(
  file: File,
  limiteBytes = LIMITES_MEDIA.image,
  ladoMaximo = 1600,
): Promise<File> {
  if (!file.type.startsWith('image/')) return file

  const bitmap = await crearBitmap(file)
  // Un SVG sin `width`/`height` intrínsecos se carga pero mide 0x0, y el
  // canvas saldría en blanco sin que nadie lo notara hasta ver el mensaje
  // enviado. Mejor decirlo aquí.
  const anchoOrigen = bitmap.width
  const altoOrigen = bitmap.height
  if (!anchoOrigen || !altoOrigen) {
    throw new ImagenIlegible('La imagen no declara tamaño, así que no se puede convertir.')
  }

  const escala = Math.min(1, ladoMaximo / Math.max(anchoOrigen, altoOrigen))
  const w = Math.round(anchoOrigen * escala)
  const h = Math.round(altoOrigen * escala)

  const lienzo = document.createElement('canvas')
  lienzo.width = w
  lienzo.height = h
  const ctx = lienzo.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, w, h)
  if ('close' in bitmap) (bitmap as ImageBitmap).close?.()

  // PNG primero SOLO si de verdad hay transparencia que perder. Un PNG opaco
  // —una captura de pantalla, que es el 90 % de lo que se pega— pesa varias
  // veces más que su JPEG sin ganar nada.
  if (tieneTransparencia(ctx, w, h, file.type)) {
    const png = await aBlob(lienzo, 'image/png')
    if (png && png.size <= limiteBytes) {
      return new File([png], cambiarExtension(file.name, 'png'), { type: 'image/png' })
    }
  }

  for (const calidad of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await aBlob(lienzo, 'image/jpeg', calidad)
    if (blob && blob.size <= limiteBytes) {
      return new File([blob], cambiarExtension(file.name, 'jpg'), { type: 'image/jpeg' })
    }
  }

  // Ni al 40 %. Se devuelve el JPEG más pequeño que sepamos hacer, no el
  // original: el original puede ser un webp o un bmp, y entonces al aviso de
  // tamaño se le sumaría un rechazo de Meta por el tipo. Que falle por UNA
  // razón y que sea la que el aviso explica.
  const ultimo = await aBlob(lienzo, 'image/jpeg', 0.4)
  if (ultimo) return new File([ultimo], cambiarExtension(file.name, 'jpg'), { type: 'image/jpeg' })
  return file
}

function aBlob(lienzo: HTMLCanvasElement, tipo: string, calidad?: number): Promise<Blob | null> {
  return new Promise((r) => lienzo.toBlob(r, tipo, calidad))
}

/**
 * ¿Queda algún píxel no opaco?
 *
 * Solo se mira en los formatos que PUEDEN llevar canal alfa: un JPEG nunca
 * lo tiene y recorrer sus píxeles sería tirar tiempo en cada envío. Se
 * muestrea uno de cada cuatro píxeles — con menos, una esquina transparente
 * pequeña se escaparía; leerlos todos en una imagen de 1600 px son 10 MB de
 * ImageData por foto.
 */
function tieneTransparencia(ctx: CanvasRenderingContext2D, w: number, h: number, tipo: string): boolean {
  if (!/^image\/(png|webp|gif|avif|apng|svg)/.test(tipo)) return false
  try {
    const datos = ctx.getImageData(0, 0, w, h).data
    for (let i = 3; i < datos.length; i += 16) {
      if (datos[i] < 255) return true
    }
    return false
  } catch {
    // Lienzo contaminado o memoria: se asume que no, que es lo que había antes.
    return false
  }
}

async function crearBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file) } catch { /* seguimos por el camino largo */ }
  }
  return new Promise((res, rej) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => { URL.revokeObjectURL(url); res(img) }
    // Aquí es donde acaba un HEIC del iPhone: ningún navegador de escritorio
    // lo descodifica. Se convierte en un aviso con nombre, no en una promesa
    // rechazada que nadie captura y que deja el compositor mudo.
    img.onerror = () => {
      URL.revokeObjectURL(url)
      rej(new ImagenIlegible(
        'Este navegador no sabe abrir imágenes ' +
        (file.type ? file.type.replace('image/', '').toUpperCase() : 'de este tipo') +
        '. Conviértela a JPG o PNG y vuelve a pegarla.',
      ))
    }
    img.src = url
  })
}

function cambiarExtension(nombre: string, ext: string): string {
  return nombre.replace(/\.[^.]+$/, '') + '.' + ext
}

/** Primer fotograma de un vídeo, para previsualizar antes de enviar. */
export async function miniaturaDeVideo(file: File): Promise<string | null> {
  return new Promise((res) => {
    const v = document.createElement('video')
    const url = URL.createObjectURL(file)
    let resuelto = false
    const terminar = (valor: string | null) => {
      if (resuelto) return
      resuelto = true
      URL.revokeObjectURL(url)
      res(valor)
    }
    v.preload = 'metadata'
    v.muted = true
    v.onloadeddata = () => {
      try {
        const c = document.createElement('canvas')
        c.width = v.videoWidth
        c.height = v.videoHeight
        c.getContext('2d')?.drawImage(v, 0, 0)
        terminar(c.toDataURL('image/jpeg', 0.6))
      } catch { terminar(null) }
    }
    v.onerror = () => terminar(null)
    setTimeout(() => terminar(null), 5000)
    v.src = url
  })
}
