// Réplica EXACTA de la máquina de estados del gesto de ListaConversaciones.tsx.
// Si esto y el .tsx dejan de coincidir, la prueba no vale: se copia a mano.
const ANCHO = 76

function fila(abiertaInicial = false) {
  let arrastre = null
  let gesto = null
  let arrastrado = false
  let abierta = abiertaInicial
  let capturado = false
  const eventos = []

  const onDeslizar = (d) => { abierta = d; eventos.push('deslizar:' + d) }
  const onClick = () => eventos.push('ABRIR CONVERSACION')

  return {
    get abierta() { return abierta },
    get x() { return arrastre ?? (abierta ? -ANCHO : 0) },
    get capturado() { return capturado },
    eventos,

    down(x, y) {
      arrastrado = false
      gesto = { x, y, eje: '?' }
    },
    move(x, y) {
      const g = gesto
      if (!g) return
      const dx = x - g.x, dy = y - g.y
      if (g.eje === '?') {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        if (Math.abs(dy) >= Math.abs(dx)) { gesto = null; return }
        g.eje = 'x'
        arrastrado = true
        capturado = true
      }
      const base = abierta ? -ANCHO : 0
      arrastre = Math.max(-ANCHO, Math.min(0, base + dx))
    },
    up() {
      const g = gesto
      gesto = null
      if (g?.eje === 'x') {
        capturado = false
        onDeslizar((arrastre ?? 0) < -ANCHO / 2)
      }
      arrastre = null
    },
    cancel() {
      const g = gesto
      gesto = null
      if (g?.eje === 'x') capturado = false
      arrastre = null
    },
    // El navegador dispara `click` después de un down/up sobre el mismo sitio.
    click() {
      if (arrastrado) { arrastrado = false; return }
      if (abierta) { onDeslizar(false); return }
      onClick()
    },
  }
}

let fallos = 0
function comprueba(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado)
  if (!ok) fallos++
  console.log((ok ? '  ok   ' : '  FALLO') + '  ' + nombre +
    (ok ? '' : '\n         esperado ' + JSON.stringify(esperado) + '\n         real     ' + JSON.stringify(real)))
}

console.log('GESTO DE DESLIZAR')

// 1. Un toque limpio abre la conversación.
{ const f = fila(); f.down(100, 300); f.up(); f.click()
  comprueba('toque -> abre la conversación', f.eventos, ['ABRIR CONVERSACION']) }

// 2. Scroll vertical: el gesto se abandona, la fila NO se mueve y NO abre.
{ const f = fila(); f.down(100, 300); f.move(103, 260); f.move(105, 180)
  const x = f.x; f.up(); f.click()
  comprueba('scroll vertical -> la fila no se mueve', x, 0)
  comprueba('scroll vertical -> no captura el puntero', f.capturado, false)
  comprueba('scroll vertical -> abre al soltar (fue un toque, no un arrastre)', f.eventos, ['ABRIR CONVERSACION']) }

// 3. Deslizar entero: destapa el botón y NO abre la conversación.
{ const f = fila(); f.down(300, 300); f.move(280, 302); f.move(220, 304)
  const x = f.x; f.up(); f.click()
  comprueba('deslizar entero -> tope en -76', x, -76)
  comprueba('deslizar entero -> queda destapada', f.eventos, ['deslizar:true'])
  comprueba('deslizar entero -> no abre la conversación', f.eventos.includes('ABRIR CONVERSACION'), false) }

// 4. Deslizar poco: vuelve a su sitio.
{ const f = fila(); f.down(300, 300); f.move(285, 301); f.up(); f.click()
  comprueba('deslizar poco -> vuelve a cerrarse', f.eventos, ['deslizar:false'])
  comprueba('deslizar poco -> sigue cerrada', f.abierta, false) }

// 5. Con el panel destapado, tocar la fila lo cierra en vez de abrir el hilo.
{ const f = fila(true); f.down(100, 300); f.up(); f.click()
  comprueba('tocar con el panel abierto -> lo cierra', f.eventos, ['deslizar:false'])
  comprueba('tocar con el panel abierto -> no abre el hilo', f.eventos.includes('ABRIR CONVERSACION'), false) }

// 6. EL FALLO QUE ACABO DE ARREGLAR: un pointercancel a mitad de arrastre no
//    dispara `click`, así que la bandera se quedaba puesta y se comía el
//    SIGUIENTE toque, que era legítimo.
{ const f = fila(); f.down(300, 300); f.move(240, 302); f.cancel()   // sin click
  f.eventos.length = 0
  f.down(100, 300); f.up(); f.click()
  comprueba('toque después de un arrastre cancelado -> abre igual', f.eventos, ['ABRIR CONVERSACION']) }

// 7. Deslizar hacia la derecha no destapa nada: el panel está a la derecha.
{ const f = fila(); f.down(100, 300); f.move(160, 302)
  comprueba('deslizar a la derecha -> la fila no se mueve', f.x, 0) }

// 8. Desde abierta, deslizar hacia la derecha la vuelve a tapar.
{ const f = fila(true); f.down(100, 300); f.move(170, 302); f.up()
  comprueba('desde abierta, arrastrar a la derecha -> se cierra', f.abierta, false) }

console.log('\nTELÉFONO LEGIBLE')
function telefonoLegible(clienteId) {
  const d = String(clienteId ?? '').replace(/\D/g, '')
  if (!d) return ''
  if (d.length === 13 && d.startsWith('521')) return `+52 1 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`
  if (d.length === 12 && d.startsWith('52')) return `+52 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`
  if (d.length === 11 && d.startsWith('34')) return `+34 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`
  return '+' + d
}
comprueba('mexicano (13 dígitos)', telefonoLegible('5215591937975'), '+52 1 559 193 7975')
comprueba('mexicano sin el 1 (12)', telefonoLegible('525591937975'), '+52 559 193 7975')
comprueba('español (11)', telefonoLegible('34641691299'), '+34 641 691 299')
comprueba('desconocido: se devuelve entero', telefonoLegible('12345'), '+12345')
comprueba('vacío no revienta', telefonoLegible(''), '')
comprueba('null no revienta', telefonoLegible(null), '')
comprueba('ya venía con formato', telefonoLegible('+52 1 559 193 7975'), '+52 1 559 193 7975')

console.log('\nBÚSQUEDA POR NÚMERO (aplicarFiltros)')
function casa(clienteId, nombre, texto, busqueda) {
  const q = busqueda.trim().toLowerCase()
  const digitos = q.replace(/\D/g, '')
  const porNumero = digitos.length >= 3
  return (nombre ?? '').toLowerCase().includes(q) ||
         clienteId.includes(q) ||
         (porNumero && clienteId.includes(digitos)) ||
         (texto ?? '').toLowerCase().includes(q)
}
comprueba('pegar el número formateado encuentra la fila',
  casa('5215591937975', 'Alejandra', 'hola', '+52 1 559 193 7975'), true)
comprueba('trozo con espacios', casa('5215591937975', 'Alejandra', 'hola', '559 193'), true)
comprueba('sigue buscando por nombre', casa('5215591937975', 'Alejandra', 'hola', 'alejan'), true)
comprueba('con menos de 3 dígitos la vía nueva no ensancha nada',
  casa('5215591937975', 'Alejandra', 'hola', '5 2'), false)
comprueba('número de otro cliente no casa',
  casa('5215591937975', 'Alejandra', 'hola', '+52 1 222 323 4147'), false)

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLOS')
process.exit(fallos ? 1 : 0)
