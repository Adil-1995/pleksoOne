import { useMemo } from 'react'
import { trozos } from '@/lib/marcado'

/**
 * Pinta un texto con el marcado de WhatsApp resuelto.
 *
 * Devuelve solo los `<span>`, sin envoltorio, para que quien lo use decida
 * el elemento y las clases. Eso es lo que permite que en la burbuja del
 * anuncio el cuerpo formateado siga estando dentro de UN párrafo y el
 * `line-clamp` de dos líneas funcione: si esto metiera su propio `<div>`,
 * el recorte contaría bloques en vez de líneas y no plegaría nada.
 */
export function TextoMarcado({ texto }: { texto: string | null | undefined }) {
  const partes = useMemo(() => trozos(texto), [texto])

  return (
    <>
      {partes.map((t, i) => {
        const clases = [
          t.negrita ? 'font-semibold' : '',
          t.cursiva ? 'italic' : '',
          t.tachado ? 'line-through' : '',
          t.mono ? 'font-mono text-[0.9em]' : '',
        ].filter(Boolean).join(' ')

        // Sin estilos no se envuelve en nada: un texto normal es un solo
        // nodo de texto, como antes de existir esto.
        if (!clases) return t.texto
        return <span key={i} className={clases}>{t.texto}</span>
      })}
    </>
  )
}
