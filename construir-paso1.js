// PASO 1 — Preparar Catálogo automático.
// Parte del workflow VIVO (backup del día), no de la copia del repo.
const fs = require('fs');
const SP = process.env.SP;

const vivo = JSON.parse(fs.readFileSync('backup-receptor-VIVO-preCatalogoAuto-20260829.json', 'utf8'));
const nuevo = fs.readFileSync(SP + '/preparar-catalogo-v2.js', 'utf8');

const nodo = vivo.nodes.find(n => n.name === 'Preparar Catálogo');
if (!nodo) throw new Error('no está el nodo Preparar Catálogo');
const antes = nodo.parameters.jsCode;
nodo.parameters.jsCode = nuevo;

// Solo se toca ese nodo. Nada más.
const cambiados = vivo.nodes.filter(n => n.name === 'Preparar Catálogo').length;
console.log('nodos totales      :', vivo.nodes.length);
console.log('nodos modificados  :', cambiados, '(solo Preparar Catálogo)');
console.log('jsCode antes/después:', antes.length, '->', nuevo.length, 'bytes');

fs.writeFileSync('paso1-catalogo-automatico.json', JSON.stringify({
  name: vivo.name,
  nodes: vivo.nodes,
  connections: vivo.connections,
  settings: vivo.settings || {},
  staticData: vivo.staticData || null
}, null, 2));
console.log('escrito: paso1-catalogo-automatico.json');
