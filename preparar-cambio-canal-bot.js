const fs=require("fs");
const d=JSON.parse(fs.readFileSync("backup-multicanal-VIVO-20260822-preBotActivo.json","utf8"));
const tocados=[];

function edit(nombre, de, a){
  const n=d.nodes.find(x=>x.name===nombre);
  if(!n) throw new Error("no existe el nodo: "+nombre);
  if(!n.parameters.jsCode.includes(de)) throw new Error("patron no encontrado en: "+nombre);
  n.parameters.jsCode=n.parameters.jsCode.replace(de,a);
  tocados.push(nombre);
}

// ---- 1. Resolver canal: sacar el interruptor del canal ----
edit("Resolver canal",
`  canal_activo:    fila ? fila.activo !== false : false,`,
`  canal_activo:    fila ? fila.activo !== false : false,
  // Interruptor de Maria PARA ESTE NUMERO (canales.bot_activo). Distinto
  // de \`activo\`: el canal sigue en servicio y un humano puede escribir;
  // lo unico que se calla es Maria. Sin fila -> true, porque un numero
  // desconocido ya se corta antes por canal_desconocido.
  canal_bot_activo: fila ? fila.bot_activo !== false : true,`);

// ---- 2. Interpretar estado: la decision pasa a ser conversacion Y canal ----
edit("Interpretar estado",
`  } else if (fila.bloqueada === true) {`,
`  } else if ($('Resolver canal').first().json.canal_bot_activo === false) {
    // Maria pausada en ESTE numero desde el inbox. El canal sigue en
    // servicio: entra, se guarda, se ve y un humano puede contestar.
    // Lo unico que no pasa es que responda ella.
    bot_activo = false;
    motivo = 'Maria pausada en este canal';
  } else if (fila.bloqueada === true) {`);

// ---- 3. Las cuatro re-comprobaciones de mitad de flujo ----
const VIEJO=`const activo = fila ? fila.bot_activo !== false : true;
return [{ json: { pausado: activo ? 0 : 1 } }];`;
const NUEVO=`const activo = fila ? fila.bot_activo !== false : true;
// Y ademas el interruptor del canal: pausar un numero tiene que callar a
// Maria tambien a mitad de flujo, no solo en la puerta de entrada.
const canalOk = $('Resolver canal').first().json.canal_bot_activo !== false;
return [{ json: { pausado: (activo && canalOk) ? 0 : 1 } }];`;
for(const nm of ["¿Sigue activo? (adaptar)","Check ficha (adaptar)","Check oferta (adaptar)","Check final (adaptar)"])
  edit(nm, VIEJO, NUEVO);

// ---- 4. La del audio, que tiene otra forma ----
edit("AUDIO ilegible: ¿sigue activo? (adaptar)",
`return [{ json: { pausado: activo ? 0 : 1, callar: callar ? 'si' : 'no' } }];`,
`const canalOk = $('Resolver canal').first().json.canal_bot_activo !== false;
return [{ json: { pausado: (activo && canalOk) ? 0 : 1, callar: callar ? 'si' : 'no' } }];`);

fs.writeFileSync("fase8-multicanal-pausa-canal.json", JSON.stringify({
  name:d.name, nodes:d.nodes, connections:d.connections, settings:d.settings||{}
}, null, 2));
console.log("NODOS TOCADOS ("+tocados.length+"):");
tocados.forEach(t=>console.log("  - "+t));
console.log("\nnodos totales: "+d.nodes.length+" (sin cambios en el numero)");
