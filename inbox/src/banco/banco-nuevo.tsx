/**
 * BANCO DE PRUEBAS de la tanda nueva.  http://localhost:5173/banco-nuevo.html
 *
 * Monta los componentes DE VERDAD —los mismos que usa el inbox— con datos
 * inventados, sin sesión y sin tocar Supabase. Es el mismo truco que
 * `banco-fila.tsx`: sirve para mirar el aspecto de casos que en producción
 * no coinciden nunca a la vez, y para poder enseñar una captura sin sacar
 * por pantalla la conversación de un cliente real.
 *
 * Las respuestas rápidas se meten a mano en la caché de react-query, así que
 * el desplegable de «/» funciona igual que en la app sin que haya que estar
 * autenticado ni exista la tabla.
 *
 * No entra en el build: Vite solo empaqueta lo que cuelga de index.html.
 */
import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { BurbujaAnuncio } from '@/componentes/BurbujaAnuncio'
import { Burbuja } from '@/componentes/Burbuja'
import { Redactor } from '@/componentes/Redactor'
import { claves } from '@/hooks/datos'
import type {
  AnuncioOrigen, Canal, Conversacion, Mensaje, RespuestaRapida,
} from '@/tipos'
import '@/index.css'

const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })

// Una imagen de mentira que no pide nada a la red: así la miniatura de la
// respuesta rápida se ve de verdad y no como el icono de imagen rota.
const FICHA =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
       <rect width="240" height="240" fill="#1f6f5c"/>
       <text x="120" y="104" text-anchor="middle" fill="#eaf5f1"
             font-family="sans-serif" font-size="26" font-weight="700">FICHA</text>
       <text x="120" y="142" text-anchor="middle" fill="#a9d6c8"
             font-family="sans-serif" font-size="20">Soporte imán</text>
     </svg>`,
  )

const CANAL: Canal = {
  id: 2, tipo: 'whatsapp_cloud', identificador: '1325415680645290', nombre: 'México',
  pais: 'mx', ventana_horas: 24, soporta_media: true, soporta_plantillas: true,
  activo: true, bot_activo: true,
} as Canal

const CONV: Conversacion = {
  id: 1, cliente_id: '521271246645', telefono: null, nombre: 'Ana',
  ultimo_texto: 'sí, me interesa', ultimo_en: '2026-09-01T13:34:00Z',
  ultimo_del_cliente: '2026-09-01T13:34:00Z', no_leidos: 0, bot_activo: false,
  ctwa_clid: 'ARBc0000', ad_id: '120210000000', creado: '2026-09-01T13:32:00Z',
  canal: 'whatsapp_cloud', canal_id: 2, favorita: false, fijada: false,
  silenciada: false, bloqueada: false, bloqueada_en: null, bloqueo_nota: null,
  etiquetas: [], conversacion_productos: [],
} as Conversacion

// El referral tal y como lo manda Meta, con el body ENTERO: es justo lo que
// dice de qué producto venía la conversación y lo que no se puede recortar.
const ANUNCIO: AnuncioOrigen = {
  titular: 'Soporte magnético para el coche',
  cuerpo:
    '¿Usas Waze o Google Maps prácticamente cada vez que manejas? Entonces ' +
    'esto te va a interesar: el soporte se pega al salpicadero, aguanta el ' +
    'teléfono en cualquier curva y se pone con una mano en dos segundos. ' +
    'Envío gratis a todo México y se paga al recibir.',
  enlace: 'https://fb.me/2Qk9anuncio',
  anuncioId: '120210000000',
  miniatura: null,
}

const msg = (m: Partial<Mensaje>): Mensaje => ({
  id: 1, cliente_id: CONV.cliente_id, direccion: 'in', autor: 'cliente',
  tipo: 'text', texto: null, media_url: null, transcripcion: null,
  estado: 'entregado', msg_id_canal: 'wamid.x', creado: '2026-09-01T13:32:42Z',
  canal: 'whatsapp_cloud', ...m,
})

const HILO: Mensaje[] = [
  msg({ id: 1, texto: 'Hola, me interesa', creado: '2026-09-01T13:32:42Z' }),
  msg({
    id: 2, direccion: 'out', autor: 'bot', estado: 'leido',
    texto: '¡Hola! 😊 El soporte magnético cuesta $349 con envío gratis a todo ' +
           'México y se paga en efectivo al recibir. ¿Le mando la ficha?',
    creado: '2026-09-01T13:33:10Z',
  }),
  msg({ id: 3, texto: 'sí, me interesa', creado: '2026-09-01T13:34:00Z' }),
]

const RESPUESTAS: RespuestaRapida[] = [
  {
    id: 1, atajo: 'ficha', orden: 10,
    texto: 'Le paso la ficha del producto con todas las medidas 👇',
    imagen_path: FICHA, imagen_nombre: 'ficha-soporte.png', imagen_tamano: 84213,
    creado_por: null, creado: '', actualizado: '',
  },
  {
    id: 2, atajo: 'envio', orden: 20,
    texto: 'El envío es GRATIS a todo México y llega en 2 a 6 días. Se paga en efectivo al recibir 😊',
    imagen_path: null, imagen_nombre: null, imagen_tamano: null,
    creado_por: null, creado: '', actualizado: '',
  },
  {
    id: 3, atajo: 'mapa', orden: 30,
    texto: '',
    imagen_path: FICHA, imagen_nombre: 'zona-reparto.png', imagen_tamano: 51204,
    creado_por: null, creado: '', actualizado: '',
  },
]

cliente.setQueryData(claves.respuestas, RESPUESTAS)
cliente.setQueryData(claves.canales, [CANAL])

/**
 * Deja el compositor en un estado concreto nada más cargar: `?abrir=emojis`,
 * `?abrir=barra` o `?abrir=imagen`.
 *
 * Existe para poder sacar la captura de un desplegable abierto sin que haya
 * nadie delante pulsando, y para volver a mirar ese mismo estado dentro de
 * seis meses sin tener que acordarse de cómo se llegaba. Es código de banco:
 * no entra en el build de la app.
 *
 * Al textarea se le escribe con el setter nativo y un evento `input`, y no
 * con `el.value = '/'`: React guarda su propio valor y una asignación directa
 * la ignora, así que el desplegable no se abriría.
 */
function useAbrirAlCargar() {
  useEffect(() => {
    const que = new URLSearchParams(location.search).get('abrir')
    if (!que) return

    const t = setTimeout(() => {
      if (que === 'emojis') {
        document.querySelector<HTMLButtonElement>('[aria-label="Emojis"]')?.click()
        return
      }

      // Un Ctrl+V de verdad: un DataTransfer con un fichero de imagen dentro,
      // que es exactamente lo que deja el portapapeles al copiar una captura.
      // Sin `text/plain` en `types`, igual que el portapapeles real cuando
      // solo lleva una imagen.
      if (que === 'pegar') {
        const campo = document.querySelector('textarea')
        if (!campo) return
        const lienzo = document.createElement('canvas')
        lienzo.width = 320; lienzo.height = 200
        const ctx = lienzo.getContext('2d')!
        ctx.fillStyle = '#1f6f5c'; ctx.fillRect(0, 0, 320, 200)
        ctx.fillStyle = '#eaf5f1'; ctx.font = 'bold 22px sans-serif'
        ctx.fillText('CAPTURA PEGADA', 40, 108)
        lienzo.toBlob((blob) => {
          if (!blob) return
          const dt = new DataTransfer()
          dt.items.add(new File([blob], 'captura.png', { type: 'image/png' }))
          campo.dispatchEvent(new ClipboardEvent('paste', {
            clipboardData: dt, bubbles: true, cancelable: true,
          }))
        }, 'image/png')
        return
      }

      const campo = document.querySelector('textarea')
      if (!campo) return
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value',
      )?.set
      setter?.call(campo, '/')
      campo.dispatchEvent(new Event('input', { bubbles: true }))

      if (que !== 'imagen') return
      // Elegir «/ficha» del desplegable. Va con mousedown porque es lo que
      // escucha la lista, y con un respiro para que ya esté pintada.
      setTimeout(() => {
        const opciones = document.querySelectorAll<HTMLElement>('[role="option"]')
        opciones[0]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      }, 120)
    }, 120)

    return () => clearTimeout(t)
  }, [])
}

function Banco() {
  useAbrirAlCargar()
  return (
    <div className="flex h-full flex-col bg-fondo text-texto">
      <div className="border-b border-borde px-4 py-2 text-xs text-texto2">
        Banco de pruebas · datos inventados, sin sesión y sin tocar Supabase
      </div>

      <div className="fondo-hilo flex flex-1 flex-col justify-end overflow-y-auto py-3">
        <div className="flex justify-center py-2">
          <span className="rounded-md bg-panel2/90 px-3 py-1 text-[11px] uppercase tracking-wide text-texto2">
            hoy
          </span>
        </div>
        {/* El anuncio va PRIMERO, antes del mensaje del cliente, que es el
            orden en que ocurrió. */}
        <div className="py-0.5"><BurbujaAnuncio a={ANUNCIO} creado={HILO[0].creado} /></div>
        {HILO.map((m) => (
          <div key={m.id} className="py-0.5"><Burbuja m={m} /></div>
        ))}
      </div>

      <Redactor conv={CONV} canal={CANAL} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={cliente}>
    <Banco />
  </QueryClientProvider>,
)
