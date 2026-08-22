const fs=require("fs");
const d=JSON.parse(fs.readFileSync("backup-receptor-VIVO-20260822-preFase8.json","utf8"));
const hechos=[];
function edit(nombre,de,a,etq){
  const n=d.nodes.find(x=>x.name===nombre);
  if(!n) throw new Error("no existe nodo: "+nombre);
  if(!n.parameters.jsCode.includes(de)) throw new Error("patrón no encontrado en "+nombre+": "+etq);
  n.parameters.jsCode=n.parameters.jsCode.replace(de,a); hechos.push(etq);
}

// ===== A. fase8: la pausa pasa a ser conversación Y canal =====
edit("Resolver canal",
`  canal_activo:    fila ? fila.activo !== false : false,`,
`  canal_activo:    fila ? fila.activo !== false : false,
  // Interruptor de Maria PARA ESTE NUMERO (canales.bot_activo). Distinto
  // de \`activo\`: el canal sigue en servicio y un humano puede escribir;
  // lo unico que se calla es Maria. Sin fila -> true, porque un numero
  // desconocido ya se corta antes por canal_desconocido.
  canal_bot_activo: fila ? fila.bot_activo !== false : true,`, "A1 Resolver canal: canal_bot_activo");

edit("Interpretar estado",
`  } else if (fila.bloqueada === true) {`,
`  } else if ($('Resolver canal').first().json.canal_bot_activo === false) {
    // Maria pausada en ESTE numero desde el inbox. El canal sigue en
    // servicio: entra, se guarda, se ve y un humano puede contestar.
    bot_activo = false;
    motivo = 'Maria pausada en este canal';
  } else if (fila.bloqueada === true) {`, "A2 Interpretar estado: rama de pausa por canal");

const V=`const activo = fila ? fila.bot_activo !== false : true;
return [{ json: { pausado: activo ? 0 : 1 } }];`;
const NU=`const activo = fila ? fila.bot_activo !== false : true;
// Y ademas el interruptor del canal: pausar un numero tiene que callar a
// Maria tambien a mitad de flujo, no solo en la puerta de entrada.
const canalOk = $('Resolver canal').first().json.canal_bot_activo !== false;
return [{ json: { pausado: (activo && canalOk) ? 0 : 1 } }];`;
for(const nm of ["¿Sigue activo? (adaptar)","Check ficha (adaptar)","Check oferta (adaptar)","Check final (adaptar)"])
  edit(nm,V,NU,"A3 "+nm);
edit("AUDIO ilegible: ¿sigue activo? (adaptar)",
`return [{ json: { pausado: activo ? 0 : 1, callar: callar ? 'si' : 'no' } }];`,
`const canalOk = $('Resolver canal').first().json.canal_bot_activo !== false;
return [{ json: { pausado: (activo && canalOk) ? 0 : 1, callar: callar ? 'si' : 'no' } }];`, "A3 AUDIO");

// ===== B. numero_propio: contra el canal resuelto, no contra el fijo =====
edit("Normalizar evento",
`const NUESTRO_NUMERO = $env.WA_PHONE_NUMBER_ID || '';`,
`// numero_propio ya NO se calcula aqui. Aqui todavia no sabemos que
// numeros son nuestros: compararlo con $env.WA_PHONE_NUMBER_ID daba
// false para TODO mensaje del canal 2. Se resuelve en 'Resolver canal',
// que es quien mira la tabla \`canales\`.`, "B1 Normalizar evento: fuera el número fijo");

edit("Normalizar evento",
`    const numeroPropio = !NUESTRO_NUMERO || meta.phone_number_id === NUESTRO_NUMERO;`,
`    const numeroPropio = null;   // lo rellena 'Resolver canal'`, "B2 Normalizar evento: numeroPropio a null");

edit("Resolver canal",
`  canal_desconocido: fila ? 'no' : 'si',`,
`  canal_desconocido: fila ? 'no' : 'si',
  // Nuestro es el numero que esta dado de alta en \`canales\`, punto.
  // Antes se comparaba contra $env.WA_PHONE_NUMBER_ID y el canal 2
  // salia siempre como ajeno.
  numero_propio: !!fila,`, "B3 Resolver canal: numero_propio real");

fs.writeFileSync("fase8-receptor-completo.json", JSON.stringify({
  name:d.name, nodes:d.nodes, connections:d.connections, settings:d.settings||{}
},null,2));
console.log("CAMBIOS ("+hechos.length+"):"); hechos.forEach(h=>console.log("  - "+h));
