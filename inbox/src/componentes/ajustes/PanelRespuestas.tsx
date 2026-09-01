import { useRef, useState } from 'react'
import { Plus, Trash2, Check, X, Loader2, ImagePlus } from 'lucide-react'
import { useRespuestas, useGestionRespuestas } from '@/hooks/datos'
import {
  ATAJO_VALIDO, normalizarAtajo, subirImagenRespuesta, borrarImagenRespuesta,
  urlImagenRespuesta, type ImagenRespuesta,
} from '@/lib/respuestas'
import { revisar, comprimirImagen } from '@/lib/media'
import { pesoLegible } from '@/lib/formato'
import { Confirmacion } from '../Confirmacion'
import type { RespuestaRapida } from '@/tipos'

/** Lo que la imagen ocupa en el formulario mientras aún no se ha guardado. */
interface ImagenEnCurso {
  /** Ya subida al Storage: esto es lo que irá a la fila. */
  datos: ImagenRespuesta
  /** Para la previsualización, sin volver a bajarla. */
  vista: string
}

/**
 * El trozo de formulario que gestiona la imagen. Se comparte entre crear y
 * editar porque las reglas son las mismas, y cuando estaban duplicadas la
 * compresión solo se aplicaba al crear: una imagen cambiada desde la edición
 * se subía a pelo y podía pasarse del límite de Meta sin que nadie avisara.
 *
 * La imagen se sube AL ELEGIRLA, no al guardar la respuesta. Así la barra de
 * espera está donde el usuario acaba de pulsar, y al darle a Guardar solo
 * queda una escritura de una fila. El precio es que si cierras sin guardar
 * queda un fichero huérfano en el bucket; a cambio, guardar nunca se queda
 * colgado subiendo megas y la imagen ya se ve antes de confirmar nada.
 */
function CampoImagen({
  imagen, onCambio, onAviso,
}: {
  imagen: ImagenEnCurso | null
  onCambio: (i: ImagenEnCurso | null) => void
  onAviso: (m: string | null) => void
}) {
  const [subiendo, setSubiendo] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  async function elegir(f: File | undefined) {
    if (!f) return
    onAviso(null)
    if (!f.type.startsWith('image/')) {
      onAviso('Solo imágenes. Un PDF o un vídeo se manda desde el clip del chat.')
      return
    }
    // Mismo criterio que el compositor: se comprime antes de subir, para que
    // no acabe en el bucket una foto que Meta va a rechazar al enviarla.
    const comprimida = await comprimirImagen(f)
    const rev = revisar(comprimida)
    if (!rev.ok) { onAviso(rev.motivo!); return }

    setSubiendo(true)
    try {
      // La anterior se borra DESPUÉS de que la nueva esté arriba: si el
      // orden fuera al revés y la subida fallase, te quedarías sin ninguna.
      const anterior = imagen?.datos.imagen_path
      const datos = await subirImagenRespuesta(comprimida)
      onCambio({ datos, vista: URL.createObjectURL(comprimida) })
      if (anterior) await borrarImagenRespuesta(anterior)
    } catch (e) {
      onAviso(e instanceof Error ? e.message : 'No se pudo subir la imagen')
    } finally {
      setSubiendo(false)
    }
  }

  if (imagen) {
    return (
      <div className="mt-2 flex items-center gap-3 rounded-lg bg-panel2 p-2">
        <img src={imagen.vista} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{imagen.datos.imagen_nombre}</div>
          <div className="text-xs text-texto2">
            {imagen.datos.imagen_tamano ? pesoLegible(imagen.datos.imagen_tamano) : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={async () => {
            const path = imagen.datos.imagen_path
            onCambio(null)
            if (path) await borrarImagenRespuesta(path)
          }}
          className="shrink-0 rounded p-1.5 text-texto2 hover:bg-alerta/15 hover:text-alerta"
          aria-label="Quitar la imagen"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <>
      <input
        ref={ref}
        type="file"
        hidden
        accept="image/*"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; elegir(f) }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={subiendo}
        className="mt-2 flex items-center gap-1.5 rounded-lg bg-panel2 px-3 py-2 text-sm text-texto2 hover:text-texto disabled:opacity-50"
      >
        {subiendo
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <ImagePlus className="h-4 w-4" />}
        {subiendo ? 'Subiendo…' : 'Añadir imagen'}
      </button>
    </>
  )
}

export function PanelRespuestas() {
  const { data: respuestas, isPending } = useRespuestas()
  const { crear, editar, borrar } = useGestionRespuestas()

  const [atajoNuevo, setAtajoNuevo] = useState('')
  const [textoNuevo, setTextoNuevo] = useState('')
  const [imagenNueva, setImagenNueva] = useState<ImagenEnCurso | null>(null)
  const [avisoNueva, setAvisoNueva] = useState<string | null>(null)
  const [editando, setEditando] = useState<number | null>(null)
  const [borrando, setBorrando] = useState<RespuestaRapida | null>(null)

  const errorCrear = crear.error instanceof Error ? crear.error.message : null
  const atajoLimpio = normalizarAtajo(atajoNuevo)
  const atajoMal = atajoLimpio.length > 0 && !ATAJO_VALIDO.test(atajoLimpio)
  // Texto O imagen, igual que el CHECK `contenido_no_vacio` de la base. Una
  // respuesta que es solo la ficha del producto es perfectamente legítima.
  const puedeCrear = atajoLimpio.length > 0 && !atajoMal
    && (textoNuevo.trim().length > 0 || imagenNueva !== null)

  async function anadir() {
    if (!puedeCrear) return
    try {
      await crear.mutateAsync({
        atajo: atajoLimpio, texto: textoNuevo, imagen: imagenNueva?.datos,
      })
      setAtajoNuevo(''); setTextoNuevo(''); setImagenNueva(null); setAvisoNueva(null)
    } catch { /* el error se pinta debajo */ }
  }

  return (
    <div>
      <p className="mb-4 text-sm text-texto2">
        Lo que escribes una y otra vez, guardado. En el campo de mensaje escribe{' '}
        <code className="text-texto">/</code> y sale la lista; sigue escribiendo para
        filtrar. Al elegir una, el texto <strong className="text-texto">se inserta</strong>{' '}
        para que puedas retocarlo — no se envía solo.
      </p>
      <p className="mb-4 text-sm text-texto2">
        Son del equipo: las ve y las edita todo el que entra al inbox. Dos personas
        atendiendo el mismo WhatsApp tienen que contestar lo mismo.
      </p>
      <p className="mb-4 text-sm text-texto2">
        Pueden llevar <strong className="text-texto">una imagen</strong> además del texto
        —la ficha de un producto, el mapa de reparto—. Al elegir la respuesta entran
        las dos cosas en el campo de mensaje y siguen siendo editables antes de enviar.
        Una respuesta puede ser solo imagen, sin texto.
      </p>

      {/* ── Crear ── */}
      <div className="mb-6 rounded-lg border border-borde bg-panel p-3">
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-mono text-sm text-texto2">/</span>
          <input
            value={atajoNuevo}
            onChange={(e) => setAtajoNuevo(e.target.value)}
            placeholder="envio"
            maxLength={24}
            className="min-w-0 flex-1 rounded-lg bg-panel2 px-3 py-2 font-mono text-sm outline-none placeholder:text-texto2"
          />
        </div>
        <textarea
          value={textoNuevo}
          onChange={(e) => setTextoNuevo(e.target.value)}
          placeholder="El texto que se insertará en el mensaje"
          rows={3}
          className="mt-2 w-full resize-y rounded-lg bg-panel2 px-3 py-2 text-sm outline-none placeholder:text-texto2"
        />
        <CampoImagen
          imagen={imagenNueva}
          onCambio={setImagenNueva}
          onAviso={setAvisoNueva}
        />
        {avisoNueva && <p className="mt-2 text-xs text-alerta">{avisoNueva}</p>}
        <div className="mt-2 flex items-center gap-2">
          {atajoMal && (
            <p className="flex-1 text-xs text-alerta">
              El atajo no puede llevar espacios ni barras.
            </p>
          )}
          <button
            onClick={anadir}
            disabled={!puedeCrear || crear.isPending}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-acento px-3 py-2 text-sm font-medium text-fondo disabled:opacity-40"
          >
            {crear.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Crear
          </button>
        </div>
        {errorCrear && <p className="mt-2 text-xs text-alerta">{errorCrear}</p>}
      </div>

      {/* ── Lista ── */}
      {isPending && <p className="text-sm text-texto2">Cargando…</p>}

      {!isPending && !(respuestas ?? []).length && (
        <p className="rounded-lg border border-dashed border-borde px-4 py-8 text-center text-sm text-texto2">
          Todavía no hay ninguna respuesta guardada.
        </p>
      )}

      <ul className="space-y-2">
        {(respuestas ?? []).map((r) => (
          <li key={r.id} className="rounded-lg border border-borde bg-panel p-3">
            {editando === r.id ? (
              <FilaEdicion
                respuesta={r}
                guardando={editar.isPending}
                error={editar.error instanceof Error ? editar.error.message : null}
                onGuardar={async (atajo, texto, imagen) => {
                  try {
                    await editar.mutateAsync({ id: r.id, atajo, texto, ...imagen })
                    setEditando(null)
                  } catch { /* se queda abierto con el error visible */ }
                }}
                onCancelar={() => setEditando(null)}
              />
            ) : (
              <div className="flex items-start gap-3">
                <button
                  onClick={() => setEditando(r.id)}
                  className="min-w-0 flex-1 text-left"
                  title="Cambiar el atajo o el texto"
                >
                  <span className="rounded bg-acento/15 px-1.5 py-0.5 font-mono text-xs text-acento">
                    /{r.atajo}
                  </span>
                  {urlImagenRespuesta(r.imagen_path) && (
                    <img
                      src={urlImagenRespuesta(r.imagen_path)!}
                      alt=""
                      loading="lazy"
                      className="mt-1.5 h-20 w-20 rounded object-cover"
                    />
                  )}
                  {/* whitespace-pre-wrap: una respuesta con saltos de línea
                      —la de pedir los datos del envío— se ve como se enviará,
                      no aplastada en una sola línea. */}
                  <span className="mt-1.5 block whitespace-pre-wrap break-words text-sm text-texto2">
                    {r.texto}
                  </span>
                </button>
                <button
                  onClick={() => setBorrando(r)}
                  className="shrink-0 rounded p-1.5 text-texto2 hover:bg-alerta/15 hover:text-alerta"
                  aria-label={'Borrar /' + r.atajo}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <Confirmacion
        abierto={borrando !== null}
        peligrosa
        titulo="¿Borrar esta respuesta?"
        detalle={borrando ? '/' + borrando.atajo : undefined}
        cuerpo={
          <>
            Deja de estar disponible con <code className="text-texto">/</code> para todo
            el equipo. No afecta a ningún mensaje ya enviado.
          </>
        }
        textoConfirmar="Sí, borrar"
        trabajando={borrar.isPending}
        error={borrar.error instanceof Error ? borrar.error.message : null}
        onConfirmar={async () => {
          if (!borrando) return
          try {
            await borrar.mutateAsync({ id: borrando.id, imagenPath: borrando.imagen_path })
            setBorrando(null)
          } catch { /* visible */ }
        }}
        onCancelar={() => setBorrando(null)}
      />
    </div>
  )
}

function FilaEdicion({
  respuesta, guardando, error, onGuardar, onCancelar,
}: {
  respuesta: RespuestaRapida
  guardando: boolean
  error: string | null
  onGuardar: (atajo: string, texto: string, imagen: ImagenRespuesta) => void
  onCancelar: () => void
}) {
  const [atajo, setAtajo] = useState(respuesta.atajo)
  const [texto, setTexto] = useState(respuesta.texto)
  const [aviso, setAviso] = useState<string | null>(null)
  // La que ya tiene, si tiene. La vista sale de la URL pública: no hace falta
  // bajar el fichero para enseñarlo.
  const [imagen, setImagen] = useState<ImagenEnCurso | null>(() => {
    const url = urlImagenRespuesta(respuesta.imagen_path)
    if (!url || !respuesta.imagen_path) return null
    return {
      datos: {
        imagen_path: respuesta.imagen_path,
        imagen_nombre: respuesta.imagen_nombre ?? null,
        imagen_tamano: respuesta.imagen_tamano ?? null,
      },
      vista: url,
    }
  })

  const limpio = normalizarAtajo(atajo)
  const mal = limpio.length > 0 && !ATAJO_VALIDO.test(limpio)
  const puede = limpio.length > 0 && !mal && (texto.trim().length > 0 || imagen !== null)

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-sm text-texto2">/</span>
        <input
          autoFocus
          value={atajo}
          onChange={(e) => setAtajo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancelar() }}
          maxLength={24}
          className="min-w-0 flex-1 rounded-lg bg-panel2 px-3 py-2 font-mono text-sm outline-none"
        />
        <button
          onClick={() => puede && onGuardar(limpio, texto, imagen?.datos ?? {
            // Quitar la imagen tiene que MANDAR los nulls: sin ellos el
            // update no toca esas columnas y la fila se quedaría apuntando
            // a un fichero que se acaba de borrar.
            imagen_path: null, imagen_nombre: null, imagen_tamano: null,
          })}
          disabled={!puede || guardando}
          className="shrink-0 rounded-lg bg-acento p-2 text-fondo disabled:opacity-40"
          aria-label="Guardar"
        >
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
        <button
          onClick={onCancelar}
          className="shrink-0 rounded-lg p-2 text-texto2 hover:bg-panel2"
          aria-label="Cancelar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* Sin «Enter guarda» a propósito: el texto lleva saltos de línea y
          Enter tiene que poder hacer su trabajo dentro del textarea. */}
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancelar() }}
        rows={4}
        className="mt-2 w-full resize-y rounded-lg bg-panel2 px-3 py-2 text-sm outline-none"
      />
      <CampoImagen imagen={imagen} onCambio={setImagen} onAviso={setAviso} />
      {mal && <p className="mt-2 text-xs text-alerta">El atajo no puede llevar espacios ni barras.</p>}
      {aviso && <p className="mt-2 text-xs text-alerta">{aviso}</p>}
      {error && <p className="mt-2 text-xs text-alerta">{error}</p>}
    </div>
  )
}
