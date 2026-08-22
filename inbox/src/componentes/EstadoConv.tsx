import { Bot, BotOff, BellOff, Ban } from 'lucide-react'
import { estadoDe, type Conversacion, type EstadoConversacion } from '@/tipos'

/**
 * El estado de una conversación, pintado igual en todas partes.
 *
 * Un solo sitio decide el icono, el color y la palabra. Antes la lista miraba
 * `bot_activo` por su cuenta y la cabecera por la suya; con cuatro estados eso
 * acaba en que un sitio dice "atendiendo" de una conversación bloqueada.
 */
const PINTA: Record<EstadoConversacion, {
  icono: typeof Bot
  palabra: string
  explicacion: string
  texto: string
  fondo: string
  anillo: string
}> = {
  atendiendo: {
    icono: Bot, palabra: 'María atiende',
    explicacion: 'María responde sola a este cliente.',
    texto: 'text-acento', fondo: 'bg-acento/15', anillo: 'ring-acento',
  },
  pausada: {
    icono: BotOff, palabra: 'Pausada',
    explicacion: 'María está pausada en esta conversación. Respondes tú.',
    texto: 'text-alerta', fondo: 'bg-alerta/15', anillo: 'ring-alerta',
  },
  silenciada: {
    icono: BellOff, palabra: 'Silenciada',
    explicacion: 'Los mensajes entran y se guardan, pero María no responde y no salta ningún aviso.',
    texto: 'text-aviso', fondo: 'bg-aviso/15', anillo: 'ring-aviso',
  },
  bloqueada: {
    icono: Ban, palabra: 'Bloqueada',
    explicacion: 'Bloqueada en WhatsApp: sus mensajes ya no llegan y no puedes escribirle.',
    texto: 'text-alerta', fondo: 'bg-alerta/20', anillo: 'ring-alerta',
  },
}

export function pintaEstado(c: Pick<Conversacion, 'bot_activo' | 'silenciada' | 'bloqueada'>) {
  return PINTA[estadoDe(c)]
}

/** Solo el icono, para la fila de la lista, donde no cabe la palabra. */
export function IconoEstado({
  conv,
}: {
  conv: Pick<Conversacion, 'bot_activo' | 'silenciada' | 'bloqueada'>
}) {
  const estado = estadoDe(conv)
  if (estado === 'atendiendo') return null   // lo normal no se señala
  const p = PINTA[estado]
  const Icono = p.icono
  return <Icono className={['h-3.5 w-3.5 shrink-0', p.texto].join(' ')} aria-label={p.palabra} />
}
