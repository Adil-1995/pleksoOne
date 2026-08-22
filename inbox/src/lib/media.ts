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
 * Comprime una imagen a JPEG bajando calidad y tamaño hasta entrar en el límite.
 * Usa canvas, que existe igual dentro del WebView de Capacitor.
 */
export async function comprimirImagen(
  file: File,
  limiteBytes = LIMITES_MEDIA.image,
  ladoMaximo = 1600,
): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  // Un GIF comprimido deja de animarse: mejor dejarlo como está.
  if (file.type === 'image/gif') return file

  const bitmap = await crearBitmap(file)
  const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * escala)
  const h = Math.round(bitmap.height * escala)

  const lienzo = document.createElement('canvas')
  lienzo.width = w
  lienzo.height = h
  const ctx = lienzo.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, w, h)
  if ('close' in bitmap) (bitmap as ImageBitmap).close?.()

  for (const calidad of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob | null>((r) =>
      lienzo.toBlob(r, 'image/jpeg', calidad),
    )
    if (blob && blob.size <= limiteBytes) {
      return new File([blob], cambiarExtension(file.name, 'jpg'), { type: 'image/jpeg' })
    }
  }
  // Ni al 40 %: devolvemos el original y que el aviso de tamaño haga su trabajo.
  return file
}

async function crearBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file) } catch { /* seguimos por el camino largo */ }
  }
  return new Promise((res, rej) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => { URL.revokeObjectURL(url); res(img) }
    img.onerror = (e) => { URL.revokeObjectURL(url); rej(e) }
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
