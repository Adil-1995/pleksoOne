#!/usr/bin/env node
/**
 * Repara el texto doblemente codificado en UTF-8.
 *
 * QUÉ PASÓ: `Set-Content -Encoding UTF8` de PowerShell leyó ficheros que ya
 * eran UTF-8 tratando cada byte como un carácter, y los volvió a codificar.
 * Así «María» se convirtió en «MarÃ­a». Estuvo VIVO en producción: el
 * tooltip de la barra decía «MarÃ­a se callÃ³ y dejÃ³ la conversaciÃ³n».
 *
 * CÓMO SE DESHACE, sin romper lo que está bien. El fichero está MEZCLADO:
 * lo que se editó después de la corrupción es UTF-8 correcto. Así que NO se
 * puede aplicar la transformación inversa al fichero entero.
 *
 * En vez de eso se buscan RACHAS de caracteres que solo puede haber puesto
 * ahí una decodificación en CP1252 (el rango 0080–00FF más los "tipográficos"
 * que CP1252 mete en 80–9F). Cada racha se vuelve a convertir en bytes con
 * CP1252 y se intenta leer como UTF-8:
 *
 *   · si sale texto válido, era mojibake y se sustituye
 *   · si no, era texto correcto y NO SE TOCA
 *
 * Por eso «P» (U+00AB U+0050 U+00BB) sobrevive: la racha «AB» sola no es
 * UTF-8 válido. Y «Ã­» (U+00C3 U+00AD) sí se arregla: sus bytes C3 AD sí lo
 * son. Los emojis también, que son cuatro bytes: «ðŸ§¾» vuelve a ser 🧾.
 *
 *   node reparar-codificacion.js <fichero...>          (ensayo)
 *   node reparar-codificacion.js --aplicar <fichero...>
 */
const fs = require('fs')

// Lo que CP1252 pone en 80–9F, que en Latin-1 no existe.
const CP1252 = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
  0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
  0x017E: 0x9E, 0x0178: 0x9F,
}
const aByte = (c) => {
  const p = c.codePointAt(0)
  if (p >= 0x00A0 && p <= 0x00FF) return p
  if (CP1252[p] !== undefined) return CP1252[p]
  // Los huecos que CP1252 deja SIN DEFINIR (81, 8D, 8F, 90, 9D) sobreviven
  // como caracteres de control invisibles, y valen por su propio byte igual
  // que en Latin-1. Sin esto, «Í» (C3 8D) se queda a medias: la racha se
  // parte en «Ã» + un invisible, «Ã» sola no es UTF-8 válido, y la palabra
  // se queda como «LÃNEA» para siempre.
  if (p >= 0x0080 && p <= 0x009F) return p
  return null
}

function reparar(texto) {
  let fuera = ''
  let i = 0
  let arreglos = 0
  while (i < texto.length) {
    // ¿empieza aquí una racha de caracteres "sospechosos"?
    let j = i
    const bytes = []
    while (j < texto.length) {
      const b = aByte(texto[j])
      if (b === null) break
      bytes.push(b)
      j++
    }
    if (bytes.length === 0) { fuera += texto[i]; i++; continue }

    const crudo = Buffer.from(bytes)
    // Se lee como UTF-8 EXIGIENDO que no aparezca el carácter de reemplazo:
    // si aparece, no era UTF-8 y por tanto no era mojibake.
    const leido = new TextDecoder('utf-8', { fatal: false }).decode(crudo)
    if (!leido.includes('�') && leido !== texto.slice(i, j)) {
      fuera += leido
      arreglos++
    } else {
      fuera += texto.slice(i, j)
    }
    i = j
  }
  return { texto: fuera, arreglos }
}

const aplicar = process.argv.includes('--aplicar')
const ficheros = process.argv.slice(2).filter((a) => a !== '--aplicar')
if (!ficheros.length) { console.error('uso: node reparar-codificacion.js [--aplicar] <fichero...>'); process.exit(1) }

let total = 0
for (const f of ficheros) {
  const antes = fs.readFileSync(f, 'utf8')
  const { texto, arreglos } = reparar(antes)
  total += arreglos
  console.log((arreglos ? '  ARREGLA ' : '  limpio  ') + f + '   rachas: ' + arreglos)
  if (arreglos && !aplicar) {
    // Una muestra, para poder mirarla antes de escribir nada
    const a = antes.split('\n'), b = texto.split('\n')
    let vistas = 0
    for (let k = 0; k < a.length && vistas < 3; k++) {
      if (a[k] !== b[k]) { console.log('      - ' + a[k].trim().slice(0, 80)); console.log('      + ' + b[k].trim().slice(0, 80)); vistas++ }
    }
  }
  if (arreglos && aplicar) fs.writeFileSync(f, texto, 'utf8')
}
console.log((aplicar ? '\nAplicado. ' : '\nENSAYO, nada escrito. ') + 'Rachas: ' + total)
