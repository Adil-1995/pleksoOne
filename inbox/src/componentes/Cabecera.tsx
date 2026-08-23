import { ArrowLeft, Clock3, AlertTriangle, Ban, BellOff, Pin, Bot, BotOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePonerBot, usePonerSilenciada, useEtiquetarConversacion } from '@/hooks/datos'
import { capacidadesDe, estadoVentana } from '@/lib/canales'
import { clasePastilla } from '@/lib/colores'
import { iniciales, colorAvatar, telefonoLegible } from '@/lib/formato'
import { estadoDe, type Conversacion, type Canal } from '@/tipos'
import { pintaEstado } from './EstadoConv'
import { MenuConversacion } from './MenuConversacion'

/**
 * Cabecera del hilo: quién es el cliente a la izquierda, y los tres puntos a
 * la derecha con todas las acciones dentro.
 *
 * La ÚNICA acción suelta es la pausa, y está fuera del menú a propósito:
 * es el control de seguridad del inbox y callar a María cuando se equivoca
 * con un cliente real no puede costar dos toques. El aro del avatar y la
 * franja de color de debajo repiten el estado, y la franja lleva además su
 * propio botón para deshacerlo.
 */
export function Cabecera({
  conv, canal,
}: {
  conv: Conversacion
  canal: Canal | undefined
}) {
  const navegar = useNavigate()
  const poner = usePonerBot()
  const silenciada = usePonerSilenciada()
  const etiquetar = useEtiquetarConversacion()

  const cap = capacidadesDe(canal, conv.canal)
  const ventana = estadoVentana(conv, cap)

  const estado = estadoDe(conv)
  const pinta = pintaEstado(conv)
  const etiquetas = conv.etiquetas ?? []
  const activo = conv.bot_activo

  // Silenciada o bloqueada, la pausa no pinta nada: María ya está callada
  // por otro motivo y el botón solo confundiría.
  const pausaUtil = estado === 'atendiendo' || estado === 'pausada'

  return (
    <div className="shrink-0 border-b border-borde bg-panel">
      {/*
        IZQUIERDA identidad, DERECHA pausa y tres puntos. Nada más.

        Antes había seis iconos sueltos: 226 px que en un móvil de 375
        dejaban el nombre en dos letras. Ahora solo queda uno fuera —la
        pausa— y el resto vive en el menú con su etiqueta escrita.
      */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          onClick={() => navegar('/')}
          className="-ml-1 rounded p-1.5 text-texto2 hover:bg-panel2 md:hidden"
          aria-label="Volver"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        {/* Anillo alrededor del avatar: el color lo decide el estado, no
            bot_activo a secas, así que una bloqueada nunca sale en verde. */}
        <div
          className={[
            'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ring-2 ring-offset-2 ring-offset-panel',
            pinta.anillo,
          ].join(' ')}
          style={{ background: colorAvatar(conv.cliente_id) }}
          title={pinta.explicacion}
        >
          {iniciales(conv.nombre, conv.cliente_id)}
          {estado !== 'atendiendo' && (
            <span className={['absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-fondo', pinta.fondo.replace('/15', '').replace('/20', '')].join(' ')}>
              <pinta.icono className="h-2.5 w-2.5" />
            </span>
          )}
        </div>

        {/*
          EL NÚMERO arriba y el nombre debajo, no al revés.

          El de arriba es el identificador: es lo que se copia para el `curl`
          de la pausa, lo que hay que comparar con el aviso de Telegram y lo
          único que no cambia (regla 3). El nombre de WhatsApp lo edita el
          cliente cuando quiere, así que baja a la línea de contexto junto al
          canal — sigue estando, pero deja de mandar.

          El `title` lleva el número CRUDO, sin agrupar: es el que se pega.
        */}
        <div className="min-w-0 flex-1 basis-40">
          <div className="flex items-center gap-1.5">
            {conv.fijada && <Pin className="h-3.5 w-3.5 shrink-0 text-acento" aria-label="Fijada" />}
            <span className="truncate font-medium tabular-nums" title={conv.cliente_id}>
              {telefonoLegible(conv.cliente_id)}
            </span>
          </div>
          <div className="truncate text-xs text-texto2">
            {conv.nombre && (
              <>
                {conv.nombre}
                <span className="mx-1.5 opacity-40">·</span>
              </>
            )}
            {cap.nombre}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {/*
            LA PAUSA, suelta y a un toque.

            Es el único icono que sale del menú, y sale porque es el control
            de seguridad del inbox: cuando María se equivoca con un cliente
            real, callarla no puede costar dos toques. Todo lo demás se
            queda dentro.

            Desaparece si está silenciada o bloqueada: ahí María ya está
            callada por otro motivo y el botón solo confundiría.
          */}
          {pausaUtil && (
            <button
              onClick={() => poner.mutate({ clienteId: conv.cliente_id, activo: !activo })}
              disabled={poner.isPending}
              className={[
                'rounded-full p-2 transition-colors disabled:opacity-50',
                activo
                  ? 'text-acento hover:bg-acento/15'
                  : 'bg-alerta/15 text-alerta hover:bg-alerta/25',
              ].join(' ')}
              aria-label={activo ? 'Pausar a María' : 'Devolver la conversación a María'}
              aria-pressed={!activo}
              title={activo
                ? 'María atiende. Pulsa para pausarla y atender tú'
                : 'Pausado: respondes tú. Pulsa para devolvérsela a María'}
            >
              {activo ? <Bot className="h-5 w-5" /> : <BotOff className="h-5 w-5" />}
            </button>
          )}

          {/* Arriba a la derecha, como en cualquier app. Dentro va el resto. */}
          <MenuConversacion conv={conv} />
        </div>
      </div>

      {/* Etiquetas puestas, para quitarlas de un clic */}
      {etiquetas.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
          {etiquetas.map((e) => (
            <button
              key={e.id}
              onClick={() => etiquetar.mutate({ conversacionId: conv.id, etiqueta: e, poner: false })}
              className={['group rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', clasePastilla(e.color)].join(' ')}
              title={'Quitar la etiqueta ' + e.nombre}
            >
              {e.nombre}
              <span className="ml-1 opacity-0 transition-opacity group-hover:opacity-70">×</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Avisos de estado. No pueden pasar desapercibidos. ── */}
      {estado === 'bloqueada' && (
        <div className="flex items-center gap-2 bg-alerta/15 px-4 py-1.5 text-xs text-alerta">
          <Ban className="h-3.5 w-3.5 shrink-0" />
          Cliente bloqueado en WhatsApp. Sus mensajes no llegan y no puedes escribirle.
        </div>
      )}
      {estado === 'silenciada' && (
        <div className="flex items-center gap-2 bg-aviso/10 px-4 py-1.5 text-xs text-aviso">
          <BellOff className="h-3.5 w-3.5 shrink-0" />
          Silenciada: los mensajes se guardan, pero María no responde y no salta ningún aviso.
          <button
            onClick={() => silenciada.mutate({ clienteId: conv.cliente_id, valor: false })}
            className="ml-1 underline hover:no-underline"
          >
            Quitar el silencio
          </button>
        </div>
      )}
      {/* El botón de arriba ya lo deshace, pero esta franja es la que se ve
          sin buscar: quien llega a la conversación y ve el aviso tiene la
          salida ahí mismo, sin tener que localizar el icono. */}
      {estado === 'pausada' && (
        <div className="flex items-center gap-2 bg-alerta/10 px-4 py-1.5 text-xs text-alerta">
          <BotOff className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">María está pausada en esta conversación. Respondes tú.</span>
          <button
            onClick={() => poner.mutate({ clienteId: conv.cliente_id, activo: true })}
            disabled={poner.isPending}
            className="shrink-0 font-medium underline hover:no-underline disabled:opacity-50"
          >
            Devolvérsela
          </button>
        </div>
      )}

      {/* Ventana de servicio: solo si el canal la tiene */}
      {ventana.aplica && !ventana.abierta && (
        <div className="flex items-center gap-2 bg-alerta/10 px-4 py-1.5 text-xs text-alerta">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Ventana de {cap.ventanaHoras} h cerrada. Solo se puede escribir con plantilla.
        </div>
      )}
      {ventana.aplica && ventana.abierta && ventana.avisar && (
        <div className="flex items-center gap-2 bg-aviso/10 px-4 py-1.5 text-xs text-aviso">
          <Clock3 className="h-3.5 w-3.5 shrink-0" />
          Quedan {ventana.horasRestantes > 0 ? `${ventana.horasRestantes} h ` : ''}
          {ventana.minutosRestantes} min de la ventana de {cap.ventanaHoras} h.
        </div>
      )}
    </div>
  )
}
