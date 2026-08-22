import { useState } from 'react'
import { Bot, BotOff, Plus, Loader2, Check, X, ShieldAlert, Pencil } from 'lucide-react'
import { useCanales, useGestionCanales } from '@/hooks/datos'
import { avisarPausaCanal } from '@/lib/envio'
import { mariaAtiende } from '@/lib/canales'
import { TIPOS_CANAL, type Canal } from '@/tipos'

const VACIO: Partial<Canal> = {
  tipo: 'whatsapp_cloud', nombre: '', identificador: '', waba_id: '',
  pais: 'MX', ventana_horas: 24, soporta_media: true, soporta_plantillas: true,
  prompt_url: '', catalogo_hoja: '', activo: true, orden: 50,
}

// ⚠️  EL INTERRUPTOR DE CANAL NO ESTÁ OPERATIVO TODAVÍA.
//
// `canales.bot_activo` se escribe desde aquí y desde 09-pausa-canal.sql,
// pero el flujo multicanal de n8n NO lo lee: sus cinco puertas de pausa
// miran `conversaciones.bot_activo`, que es por cliente. Pausar un canal
// desde esta pantalla guardaría el cambio y María seguiría respondiendo.
//
// Es el peor fallo posible de los dos: no es que no funcione, es que
// PARECE que funciona. Por eso el botón se deshabilita en vez de quitarse
// — quitarlo escondería que la función existe y está a medias.
//
// Se pone a true al publicar fase8-multicanal-pausa-canal.json. No antes.
const PAUSA_CANAL_OPERATIVA = true

export function PanelCanales() {
  const { data: canales, isPending } = useCanales()
  const { crear, editar } = useGestionCanales()
  const [editando, setEditando] = useState<number | 'nuevo' | null>(null)

  // Pausar o reactivar María en un canal avisa al Telegram de Incidencias.
  // El aviso lo manda n8n, no el navegador: el token de Telegram vive en el
  // servidor. Si el aviso falla, el cambio se guarda igual — perder el
  // interruptor por no poder avisar sería lo peor de los dos mundos.
  const alternarBot = async (c: Canal) => {
    if (!PAUSA_CANAL_OPERATIVA) return   // cinturón: el botón ya va disabled
    const nuevo = !mariaAtiende(c)          // pulsar invierte lo que se ve
    await editar.mutateAsync({ id: c.id, bot_activo: nuevo })
    avisarPausaCanal(c.id, !nuevo).catch(() => {})
  }

  return (
    <div className="space-y-3">
      {editando !== 'nuevo' && (
        <button
          onClick={() => setEditando('nuevo')}
          className="flex items-center gap-1.5 rounded-lg bg-acento px-3 py-1.5 text-sm font-medium text-fondo"
        >
          <Plus className="h-4 w-4" /> Añadir canal
        </button>
      )}

        {/*
          Este aviso no es decoración. La tentación de meter aquí el token
          para "tenerlo todo junto" es real, y lo que pasaría es que quedaría
          legible para cualquiera que abra el inspector: el inbox lee esta
          tabla con la anon key.
        */}
        <div className="flex items-start gap-2 rounded-lg bg-aviso/10 px-3 py-2 text-xs text-aviso">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Aquí solo va <strong>configuración</strong>. El token de Meta sigue en{' '}
            <code className="font-mono">/opt/bot/wa.env</code>, en el servidor, y no
            pasa por esta pantalla ni por el navegador.
          </span>
        </div>

        {editando === 'nuevo' && (
          <Formulario
            inicial={VACIO}
            guardando={crear.isPending}
            error={crear.error instanceof Error ? crear.error.message : null}
            onGuardar={async (c) => { await crear.mutateAsync(c); setEditando(null) }}
            onCancelar={() => setEditando(null)}
          />
        )}

        {isPending && <p className="text-sm text-texto2">Cargando…</p>}

        {(canales ?? []).map((c) =>
          editando === c.id ? (
            <Formulario
              key={c.id}
              inicial={c}
              guardando={editar.isPending}
              error={editar.error instanceof Error ? editar.error.message : null}
              onGuardar={async (cambios) => { await editar.mutateAsync({ id: c.id, ...cambios }); setEditando(null) }}
              onCancelar={() => setEditando(null)}
            />
          ) : (
            <Ficha
              key={c.id} canal={c} onEditar={() => setEditando(c.id)}
              onAlternar={() => editar.mutate({ id: c.id, activo: !c.activo })}
              onAlternarBot={() => alternarBot(c)}
            />
          ),
        )}

      {!isPending && !(canales ?? []).length && (
        <p className="rounded-lg border border-dashed border-borde px-4 py-8 text-center text-sm text-texto2">
          No hay canales. Si acabas de ejecutar el SQL, recarga.
        </p>
      )}
    </div>
  )
}

function Ficha({ canal, onEditar, onAlternar, onAlternarBot }: {
  canal: Canal; onEditar: () => void; onAlternar: () => void; onAlternarBot: () => void
}) {
  const atiende = mariaAtiende(canal)
  const tipo = TIPOS_CANAL.find((t) => t.id === canal.tipo)
  return (
    <div className={['rounded-lg border border-borde bg-panel p-3', canal.activo ? '' : 'opacity-60'].join(' ')}>
      <div className="flex items-center gap-2">
        <span className={['h-2 w-2 shrink-0 rounded-full', canal.activo ? 'bg-acento' : 'bg-texto2'].join(' ')} />
        <span className="min-w-0 flex-1 truncate font-medium">{canal.nombre}</span>
        <button onClick={onEditar} className="rounded p-1.5 text-texto2 hover:bg-panel2" aria-label="Editar">
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={onAlternar}
          className={['rounded-lg px-2.5 py-1 text-xs font-medium', canal.activo
            ? 'bg-panel2 text-texto2 hover:text-texto' : 'bg-acento/15 text-acento'].join(' ')}
        >
          {canal.activo ? 'Desactivar' : 'Activar'}
        </button>
      </div>

      {/*
        EL INTERRUPTOR MAESTRO. Va arriba y grande porque es lo que más se
        toca de esta ficha, y porque un canal con María callada tiene que
        cantar desde lejos: lo peligroso no es pausar, es olvidarse.
      */}
      <button
        onClick={onAlternarBot}
        disabled={!PAUSA_CANAL_OPERATIVA}
        aria-pressed={!atiende}
        className={[
          'mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
          !PAUSA_CANAL_OPERATIVA
            ? 'cursor-not-allowed bg-panel2 text-texto2 opacity-50'
            : atiende
              ? 'bg-panel2 text-texto2 hover:text-texto'
              : 'bg-alerta/15 text-alerta ring-1 ring-alerta/40',
        ].join(' ')}
      >
        {atiende ? <Bot className="h-4 w-4 shrink-0" /> : <BotOff className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="block font-medium">
            {!PAUSA_CANAL_OPERATIVA
              ? 'Pausa por canal — todavía no disponible'
              : atiende ? 'María atiende este canal' : 'MARÍA PAUSADA EN ESTE CANAL'}
          </span>
          <span className="block text-[11px] opacity-80">
            {!PAUSA_CANAL_OPERATIVA
              ? 'El flujo aún no lee este interruptor: pulsarlo guardaría el cambio y María seguiría respondiendo.'
              : atiende
                ? 'Pulsa para callarla con todos los clientes de este número.'
                : 'Los mensajes entran y se guardan, pero no responde nadie salvo tú. Pulsa para reactivarla.'}
          </span>
        </span>
      </button>

      {!PAUSA_CANAL_OPERATIVA && (
        <p className="mt-1 flex items-start gap-1.5 rounded bg-alerta/10 px-2 py-1 text-[11px] text-alerta">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Para callar a María ahora mismo: pausa cliente a cliente desde su
            conversación, o el <code className="font-mono">curl</code> a Supabase.
            El botón vuelve cuando el flujo lea{' '}
            <code className="font-mono">canales.bot_activo</code>.
          </span>
        </p>
      )}

      {!atiende && canal.pausado_en && (
        <p className="mt-1 text-[11px] text-texto2">
          Pausado el {new Date(canal.pausado_en).toLocaleString('es-MX', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
          })}
        </p>
      )}

      <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-[11px] text-texto2">
        <dt>Tipo</dt><dd className="text-texto">{tipo?.nombre ?? canal.tipo}</dd>
        <dt>Phone Number ID</dt><dd className="font-mono text-texto">{canal.identificador}</dd>
        {canal.waba_id && <><dt>WABA ID</dt><dd className="font-mono text-texto">{canal.waba_id}</dd></>}
        <dt>País · ventana</dt><dd className="text-texto">{canal.pais ?? '—'} · {canal.ventana_horas} h</dd>
        <dt>Puede</dt>
        <dd className="text-texto">
          {[canal.soporta_media && 'media', canal.soporta_plantillas && 'plantillas']
            .filter(Boolean).join(', ') || 'solo texto'}
        </dd>
        <dt>Prompt propio</dt>
        <dd className="truncate text-texto">
          {canal.prompt_url
            ? <a href={canal.prompt_url} target="_blank" rel="noreferrer" className="underline">abrir el Doc</a>
            : <span className="text-texto2">solo el común</span>}
        </dd>
        <dt>Catálogo</dt>
        <dd className="text-texto">{canal.catalogo_hoja || <span className="text-texto2">hoja por defecto</span>}</dd>
      </dl>

      {!canal.activo && (
        <p className="mt-2 rounded bg-panel2 px-2 py-1 text-[11px] text-texto2">
          Desactivado: sus conversaciones se siguen viendo, pero no se puede enviar por él.
        </p>
      )}
    </div>
  )
}

function Formulario({ inicial, guardando, error, onGuardar, onCancelar }: {
  inicial: Partial<Canal>
  guardando: boolean
  error: string | null
  onGuardar: (c: Partial<Canal>) => void
  onCancelar: () => void
}) {
  const [v, setV] = useState<Partial<Canal>>(inicial)
  const set = <K extends keyof Canal>(k: K, valor: Canal[K]) => setV((x) => ({ ...x, [k]: valor }))

  const faltan = !String(v.nombre ?? '').trim() || !String(v.identificador ?? '').trim()

  return (
    <div className="space-y-3 rounded-lg border border-acento/40 bg-panel p-3">
      <Campo etiqueta="Nombre" ayuda="Como lo verás en el selector: «México — principal», «España».">
        <input value={v.nombre ?? ''} onChange={(e) => set('nombre', e.target.value)}
               placeholder="México — principal" className={ENTRADA} />
      </Campo>

      <Campo etiqueta="Tipo">
        <select value={v.tipo ?? 'whatsapp_cloud'} onChange={(e) => set('tipo', e.target.value)} className={ENTRADA}>
          {TIPOS_CANAL.map((t) => (
            <option key={t.id} value={t.id}>{t.nombre}{t.listo ? '' : ' — todavía no'}</option>
          ))}
        </select>
      </Campo>

      <Campo etiqueta="Phone Number ID" ayuda="El de Meta. Es la llave por la que se reconoce cada mensaje entrante.">
        <input value={v.identificador ?? ''} onChange={(e) => set('identificador', e.target.value)}
               placeholder="1050242784838044" className={ENTRADA + ' font-mono'} />
      </Campo>

      <Campo etiqueta="WABA ID">
        <input value={v.waba_id ?? ''} onChange={(e) => set('waba_id', e.target.value)}
               placeholder="1686689748986716" className={ENTRADA + ' font-mono'} />
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="País">
          <input value={v.pais ?? ''} onChange={(e) => set('pais', e.target.value)}
                 placeholder="MX" maxLength={4} className={ENTRADA} />
        </Campo>
        <Campo etiqueta="Ventana (horas)" ayuda="0 = sin ventana.">
          <input type="number" min={0} max={168} value={v.ventana_horas ?? 24}
                 onChange={(e) => set('ventana_horas', Number(e.target.value))} className={ENTRADA} />
        </Campo>
      </div>

      <div className="flex gap-4">
        <Interruptor puesto={!!v.soporta_media} onCambio={(b) => set('soporta_media', b)} texto="Soporta media" />
        <Interruptor puesto={!!v.soporta_plantillas} onCambio={(b) => set('soporta_plantillas', b)} texto="Soporta plantillas" />
      </div>

      <Campo
        etiqueta="Prompt del canal (opcional)"
        ayuda="Doc con lo que SOLO vale para este canal: moneda, entrega, saludo. Las reglas de María van en el prompt común, nunca aquí."
      >
        <input value={v.prompt_url ?? ''} onChange={(e) => set('prompt_url', e.target.value)}
               placeholder="https://docs.google.com/document/d/…" className={ENTRADA} />
      </Campo>

      <Campo etiqueta="Hoja del catálogo (opcional)" ayuda="Pestaña del Sheet. Vacío = la de siempre.">
        <input value={v.catalogo_hoja ?? ''} onChange={(e) => set('catalogo_hoja', e.target.value)}
               placeholder="Productos" className={ENTRADA} />
      </Campo>

      <Interruptor puesto={!!v.activo} onCambio={(b) => set('activo', b)} texto="Activo" />

      {error && <p className="rounded bg-alerta/10 px-3 py-2 text-xs text-alerta">{error}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancelar} className="rounded-lg px-3 py-2 text-sm text-texto2 hover:bg-panel2">
          Cancelar
        </button>
        <button
          onClick={() => onGuardar(v)}
          disabled={faltan || guardando}
          className="flex items-center gap-2 rounded-lg bg-acento px-3 py-2 text-sm font-medium text-fondo disabled:opacity-40"
        >
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Guardar
        </button>
      </div>
    </div>
  )
}

const ENTRADA = 'w-full rounded-lg bg-panel2 px-3 py-2 text-sm outline-none placeholder:text-texto2'

function Campo({ etiqueta, ayuda, children }: {
  etiqueta: string; ayuda?: string; children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium">{etiqueta}</span>
      {children}
      {ayuda && <span className="mt-0.5 block text-[11px] text-texto2">{ayuda}</span>}
    </label>
  )
}

function Interruptor({ puesto, onCambio, texto }: {
  puesto: boolean; onCambio: (b: boolean) => void; texto: string
}) {
  return (
    <button
      onClick={() => onCambio(!puesto)}
      className="flex items-center gap-2 text-sm"
      aria-pressed={puesto}
    >
      <span className={['flex h-5 w-5 items-center justify-center rounded border',
        puesto ? 'border-acento bg-acento text-fondo' : 'border-borde'].join(' ')}>
        {puesto ? <Check className="h-3.5 w-3.5" /> : <X className="h-3 w-3 opacity-40" />}
      </span>
      {texto}
    </button>
  )
}
