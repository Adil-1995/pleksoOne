import { ArrowLeft, Clock3, AlertTriangle, Ban, BellOff, Pin, Bot, BotOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePonerBot, usePonerSilenciada, useEtiquetarConversacion, useResolverEscalado } from '@/hooks/datos'
import { capacidadesDe, estadoVentana } from '@/lib/canales'
import { clasePastilla } from '@/lib/colores'
import { iniciales, colorAvatar, telefonoLegible, horaLista } from '@/lib/formato'
import { estadoDe, escaladaAbierta, type Conversacion, type Canal } from '@/tipos'
import { pintaEstado } from './EstadoConv'
import { MenuConversacion } from './MenuConversacion'

/**
 * Cabecera del hilo: quiÃ©n es el cliente a la izquierda, y los tres puntos a
 * la derecha con todas las acciones dentro.
 *
 * La ÃšNICA acciÃ³n suelta es la pausa, y estÃ¡ fuera del menÃº a propÃ³sito:
 * es el control de seguridad del inbox y callar a MarÃ­a cuando se equivoca
 * con un cliente real no puede costar dos toques. El aro del avatar y la
 * franja de color de debajo repiten el estado, y la franja lleva ademÃ¡s su
 * propio botÃ³n para deshacerlo.
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
  const resolver = useResolverEscalado()

  const cap = capacidadesDe(canal, conv.canal)
  const ventana = estadoVentana(conv, cap)

  const estado = estadoDe(conv)
  const pinta = pintaEstado(conv)
  const etiquetas = conv.etiquetas ?? []
  const activo = conv.bot_activo

  // Silenciada o bloqueada, la pausa no pinta nada: MarÃ­a ya estÃ¡ callada
  // por otro motivo y el botÃ³n solo confundirÃ­a.
  const pausaUtil = estado === 'atendiendo' || estado === 'pausada'

  return (
    <div className="shrink-0 border-b border-borde bg-panel">
      {/*
        IZQUIERDA identidad, DERECHA pausa y tres puntos. Nada mÃ¡s.

        Antes habÃ­a seis iconos sueltos: 226 px que en un mÃ³vil de 375
        dejaban el nombre en dos letras. Ahora solo queda uno fuera â€”la
        pausaâ€” y el resto vive en el menÃº con su etiqueta escrita.
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
            bot_activo a secas, asÃ­ que una bloqueada nunca sale en verde. */}
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
          EL NÃšMERO arriba y el nombre debajo, no al revÃ©s.

          El de arriba es el identificador: es lo que se copia para el `curl`
          de la pausa, lo que hay que comparar con el aviso de Telegram y lo
          Ãºnico que no cambia (regla 3). El nombre de WhatsApp lo edita el
          cliente cuando quiere, asÃ­ que baja a la lÃ­nea de contexto junto al
          canal â€” sigue estando, pero deja de mandar.

          El `title` lleva el nÃºmero CRUDO, sin agrupar: es el que se pega.
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
                <span className="mx-1.5 opacity-40">Â·</span>
              </>
            )}
            {cap.nombre}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {/*
            LA PAUSA, suelta y a un toque.

            Es el Ãºnico icono que sale del menÃº, y sale porque es el control
            de seguridad del inbox: cuando MarÃ­a se equivoca con un cliente
            real, callarla no puede costar dos toques. Todo lo demÃ¡s se
            queda dentro.

            Desaparece si estÃ¡ silenciada o bloqueada: ahÃ­ MarÃ­a ya estÃ¡
            callada por otro motivo y el botÃ³n solo confundirÃ­a.
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
              aria-label={activo ? 'Pausar a MarÃ­a' : 'Devolver la conversaciÃ³n a MarÃ­a'}
              aria-pressed={!activo}
              title={activo
                ? 'MarÃ­a atiende. Pulsa para pausarla y atender tÃº'
                : 'Pausado: respondes tÃº. Pulsa para devolvÃ©rsela a MarÃ­a'}
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
              <span className="ml-1 opacity-0 transition-opacity group-hover:opacity-70">Ã—</span>
            </button>
          ))}
        </div>
      )}

      {/* â”€â”€ Avisos de estado. No pueden pasar desapercibidos. â”€â”€ */}

      {/*
        EL ESCALADO VA EL PRIMERO de los avisos, por encima de bloqueada y
        de pausada. Los demÃ¡s describen una situaciÃ³n estable que alguien
        eligiÃ³; este dice que hay un cliente esperando AHORA y que MarÃ­a ya
        no va a contestarle.

        Y aquÃ­ estÃ¡ el botÃ³n de darlo por resuelto, que es el Ãºnico que hay
        en toda la app. No estÃ¡ en la fila de la lista a propÃ³sito: apagar
        la alarma desde la lista es un dedo torpe rozando la pantalla al
        hacer scroll. Para quitarla hay que haber ABIERTO la conversaciÃ³n,
        que es exactamente lo que se quiere que pases a hacer.

        El motivo se enseÃ±a entero, sin recortar: es lo que hace falta para
        decidir si esto lo contestas tÃº en diez segundos o hay que buscar
        el dato. Cabe porque ya viene limitado a 300 caracteres desde n8n.
      */}
      {escaladaAbierta(conv) && (
        <div className="flex items-start gap-2 bg-alerta/15 px-4 py-1.5 text-xs text-alerta">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            <strong className="font-semibold">MarÃ­a escalÃ³ y se callÃ³</strong>
            <span className="opacity-70"> Â· {horaLista(conv.escalada_en)}</span>
            {conv.escalada_motivo && <> â€” {conv.escalada_motivo}</>}
          </span>
          <button
            onClick={() => resolver.mutate({
              clienteId: conv.cliente_id,
              valor: new Date().toISOString(),
            })}
            disabled={resolver.isPending}
            className="shrink-0 font-medium underline hover:no-underline disabled:opacity-50"
            title="Quitar el aviso. Si MarÃ­a vuelve a escalar, reaparece solo."
          >
            Resuelto
          </button>
        </div>
      )}

      {estado === 'bloqueada' && (
        <div className="flex items-center gap-2 bg-alerta/15 px-4 py-1.5 text-xs text-alerta">
          <Ban className="h-3.5 w-3.5 shrink-0" />
          Cliente bloqueado en WhatsApp. Sus mensajes no llegan y no puedes escribirle.
        </div>
      )}
      {estado === 'silenciada' && (
        <div className="flex items-center gap-2 bg-aviso/10 px-4 py-1.5 text-xs text-aviso">
          <BellOff className="h-3.5 w-3.5 shrink-0" />
          Silenciada: los mensajes se guardan, pero MarÃ­a no responde y no salta ningÃºn aviso.
          <button
            onClick={() => silenciada.mutate({ clienteId: conv.cliente_id, valor: false })}
            className="ml-1 underline hover:no-underline"
          >
            Quitar el silencio
          </button>
        </div>
      )}
      {/* El botÃ³n de arriba ya lo deshace, pero esta franja es la que se ve
          sin buscar: quien llega a la conversaciÃ³n y ve el aviso tiene la
          salida ahÃ­ mismo, sin tener que localizar el icono. */}
      {estado === 'pausada' && (
        <div className="flex items-center gap-2 bg-alerta/10 px-4 py-1.5 text-xs text-alerta">
          <BotOff className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">MarÃ­a estÃ¡ pausada en esta conversaciÃ³n. Respondes tÃº.</span>
          <button
            onClick={() => poner.mutate({ clienteId: conv.cliente_id, activo: true })}
            disabled={poner.isPending}
            className="shrink-0 font-medium underline hover:no-underline disabled:opacity-50"
          >
            DevolvÃ©rsela
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
