# LumaBot — Lado Luminoso

Bot de ventas por WhatsApp ("María") para un negocio de dropshipping en México,
pago contra entrega. Los clientes entran desde anuncios de Facebook (click-to-WhatsApp).

**Estamos migrando de Evolution API (baneada por WhatsApp) a WhatsApp Cloud API + Supabase.**

El plan completo está en `PLAN-MAESTRO-LumaBot.md`. Léelo antes de proponer nada.

---

## ⚠️ ESTO ES PRODUCCIÓN

Hay clientes reales y dinero real en juego. Antes de cualquier acción:

- **NO reinicies, pares ni modifiques `bot-postgres-1`** sin pedirme permiso explícito
- **NO modifiques el workflow activo de n8n**. Trabaja sobre copias
- **NO borres nada.** Ni tablas, ni filas, ni contenedores, ni archivos
- **NO toques `docker-compose.yml`** sin enseñarme el diff antes
- Cualquier comando destructivo (`DROP`, `DELETE`, `rm -rf`, `docker down`): **pregunta primero**
- Antes de tocar la base de datos, comprueba que hay un backup reciente

Si dudas de si algo es destructivo, pregunta. Prefiero una pregunta de más.

---

## Infraestructura

| Qué | Dónde |
|---|---|
| VPS | Hetzner Ubuntu 24.04, **4 GB RAM**, IP `116.203.17.128` |
| Todo el stack | `/opt/bot`, Docker Compose |
| n8n | `https://plekso.duckdns.org` |
| Postgres | contenedor `bot-postgres-1`, user `admin`, db `appdb` |
| Caddy | reverse proxy, HTTPS por DuckDNS |
| Evolution API | v2.3.1, instancia `plekso` — **en retirada** |
| WhatsApp Cloud API | webhook `https://plekso.duckdns.org/webhook/wa-cloud` (GET verificación + POST mensajes, misma ruta) |
| Modelo | `gpt-5.6-sol`, maxTokens 500 |

**4 GB de RAM es un límite real.** Supabase autoalojado NO cabe: usamos Supabase Cloud.

### Workflows de n8n
| ID | Nombre | Estado |
|---|---|---|
| `TlNYwTxmZP9K9tKE` | LumaBot IA v3 | **activo, producción** — no tocar |
| `pSzeGNsQXDTMFGs3` | LumaBot Cloud API — Fase 1 (recepción) | activo, la nueva vía |

El resto de workflows del listado son copias históricas, todas inactivas.

### Secretos: `/opt/bot/wa.env`
Fichero con permisos `600`, montado en el contenedor de n8n con `env_file`.
**Ningún secreto va escrito dentro de un nodo.** Variables:

`WA_VERIFY_TOKEN` · `WA_APP_SECRET` · `WA_PHONE_NUMBER_ID` ·
`WA_WABA_ID` · `WA_TOKEN` · `WA_API_VERSION`

Al cambiar cualquiera hay que recrear el contenedor:
`cd /opt/bot && docker compose up -d --no-deps n8n` (~10 s de corte, Postgres no se toca).

### Tablas actuales
`buffer_mensajes` · `contexto_cliente` · `alias_lid` · `pausados` · `pedidos` ·
`fichas_enviadas` · `atribucion` · `n8n_chat_histories`

### Ficheros externos
- Prompt en Google Doc (se lee con `/export?format=txt`)
- Catálogo en Google Sheet, pestaña `Productos` + pestaña `Incidencias`

---

## Estado del plan

- [x] **Fase 0** — backup verificado (dump restaurado en BD temporal, 8/8 tablas
      con las filas exactas), cron diario `15 9 * * *` = 03:15 hora de México
      (el servidor va en UTC), script endurecido contra dumps truncados.
      *Falta: snapshot de Hetzner — los backups siguen en el mismo disco que la BD*
- [x] **Fase 1** — WhatsApp Cloud API funcionando de punta a punta: envío
      (`hello_world`), verificación del webhook, validación de firma y
      **recepción de un mensaje real** (ejecución 3035, firma válida, payload
      normalizado correctamente).
      *Falta, pero solo administrativo: publicar la app (sigue en Unpublished)
      y la verificación del negocio — tarda días, lánzala cuanto antes*
- [ ] **Fase 2** — Supabase Cloud + esquema (`01-esquema-inbox.sql`)
- [ ] **Fase 3** — migrar el flujo de n8n
- [ ] **Fase 4** — inbox propio (Vite + React + Supabase Realtime).
      **🔒 BLOQUEA LA FASE 6: no hay corte a producción sin inbox.**
      Al migrar a Cloud API se perdió la única forma de pausar el bot a mano
      (se pedía escribiendo en el grupo de WhatsApp, y la Cloud API no tiene
      grupos). Mientras no exista el botón, la red de seguridad es un `curl`
      a mano — ver «Pausar o reactivar el bot a mano» más arriba.
      **Orden de construcción:** el botón de pausa es lo PRIMERO de la mitad
      de escritura, no lo último. Antes que enviar mensajes, antes que subir
      imágenes. Es lo que permite que un humano recupere una conversación
      cuando María se equivoca, y sin eso el corte no se hace.
- [ ] **Fase 5** — reducir incidencias (audio, ficha técnica, FAQ)
- [ ] **Fase 6** — corte a producción

**Trabaja una fase cada vez. No pases a la siguiente sin que yo verifique la anterior.**

---

## Las cinco reglas de arquitectura

1. **Todo mensaje se guarda antes de decidir nada.** Primer nodo tras el webhook.
   Entre o salga, del bot o de un humano, sea ficha o texto. Sin excepciones.
2. **Un único punto de salida a WhatsApp.** Hoy la apikey está repetida en 10 nodos.
3. **La identidad no depende del canal.** `cliente_id` (= `wa_id`), nunca el teléfono ni el LID.
4. **Campo `canal` en todas las tablas** desde el principio, para poder convivir con
   dos proveedores durante una migración.
5. **Las decisiones de negocio van en el flujo, no en el prompt.** El modelo desobedece
   reglas rígidas aunque estén escritas con contraejemplos. Todo lo crítico es determinista.

---

## Lecciones aprendidas (cuestan caro, no las repitas)

**n8n**
- `delay` de Evolution debe ser `={{ 3000 }}`, no `=3000` — si no, da 400
- `queryReplacement` de Postgres debe ser array `={{ [a, b] }}`
- Los nodos de Google Sheets necesitan `authentication: serviceAccount` explícito
- `$json` se rompe al insertar nodos: referencia la fuente por nombre,
  `$('Nodo').item.json.campo`
- n8n **bloquea el módulo `crypto`** en su sandbox: el SHA-256 del CAPI está en JS puro
- n8n **2.0 bloquea `$env` dentro de los nodos por defecto**. Sin
  `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` en el compose, las expresiones fallan con
  *«access to env vars denied»*. Ojo: la comprobación es `!== 'false'`, o sea que
  tiene que valer exactamente la cadena `"false"`; no basta con dejarla sin definir
- Un mismo `path` de webhook admite **GET y POST a la vez** en dos nodos distintos:
  la clave primaria de `webhook_entity` es (`webhookPath`, `method`)
- **⚠️ Los subflujos tienen que estar publicados ANTES que quien los llama.**
  n8n 2.x rechaza el publish con *«references workflow X which is not published»*.
  Y lo peligroso: **un `PUT` sobre un subflujo lo despublica**, así que actualizar
  el subflujo de salida tumba en cascada a todo lo que lo referencia — nos dejó
  `/webhook/wa-cloud` devolviendo **404 sin un solo error en el log**.
  **Orden obligatorio tras tocar el subflujo:**
  1. `POST /api/v1/workflows/fUnaKZ51BWB2qJ7U/activate`  ← el subflujo primero
  2. `POST /api/v1/workflows/4uK8Dpsi8JA9GGaA/activate`  ← después los que lo llaman
  3. Comprobar que responde de verdad, no fiarse del 200 del activate:
     `curl "https://plekso.duckdns.org/webhook/wa-cloud?hub.mode=subscribe&hub.verify_token=...&hub.challenge=1234"`
     tiene que devolver `1234`. Si da 404, el webhook no está registrado
- El `active` de la BD puede decir `t` justo después de un activate y estar en `f`
  minutos después. **La única prueba fiable es que `webhook_entity` tenga filas y
  que la URL conteste.**
- La API pública de n8n necesita una clave con `audience = public-api`. La del
  servidor MCP (`audience = mcp-server-api`) da `401 unauthorized`

**Ejecución en verde, corte mudo — los tres fallos del 22 de agosto**
Los tres se disfrazaron igual: la ejecución sale `success`, no hay error en el
log, y algo no ha pasado. Costaron una tarde entera. **Una ejecución verde no
prueba nada: hay que mirar la SALIDA de los nodos, no su color.**

1. **Referenciar un nodo que en esa rama no se ha ejecutado.**
   `Marcar como leído` usaba el `phone_id` de `Número de salida`, pero colgaba
   de la rama corta del IF, que no pasa por ese nodo. La expresión devolvía
   `{"error":"Node 'Número de salida' hasn't been executed"}` y el nodo se lo
   tragaba por `onError: continueRegularOutput` + `neverError: true`. Ni check
   azul ni «escribiendo», y en los DOS canales.
   → Si un nodo referencia otro por nombre, comprueba que ese otro está en
     **todas** las ramas que llegan hasta él. Y `neverError` sobre una API
     externa es apagar la alarma de incendios.

2. **Un campo que no se manda y un validador que no lo exige.**
   `Preparar: leído + escribiendo` construía la petición sin `cliente_id`, y
   `Validar petición` lo exigía para todo **menos** `marcar_leido` (estaba en
   un `else`). Con el número a fuego daba igual; al resolver el canal leyendo
   la conversación del cliente, un `cliente_id` vacío devuelve cero filas y
   **cae al número por defecto sin decir nada**. Como el número por defecto es
   el del canal 1, el canal 1 «funcionaba» por casualidad.
   → Una caída a un valor por defecto tiene que AVISAR. Con un canal acierta;
     con dos, ese acierto es azar.

3. **Una rama terminal paralela le roba el retorno al subflujo.**
   Un subflujo devuelve al padre **lo que salga del último nodo ejecutado**
   (`lastNodeExecuted`). Al colgar un aviso como rama paralela, ese IF pasó a
   ejecutar el último y su salida estaba vacía: el padre recibió **cero items**
   y la rama murió ahí, en verde y sin error. Lo peor: apareció al ARREGLAR el
   fallo 2 — mientras el nodo fallaba, la rama de error devolvía item y el
   flujo seguía.
   → En un subflujo, deja el grafo **lineal**: que las ramas de aviso vuelvan
     al camino y que cada camino termine SIEMPRE en el mismo nodo. Si añades
     una rama, mira `lastNodeExecuted` en una ejecución real.

**Y la red de seguridad también falla en silencio.**
Los dos avisos a Telegram puestos para cazar el fallo 2 devolvían
`{"error":"invalid syntax"}`: la expresión llevaba saltos de línea reales
dentro de la cadena en vez de la secuencia escapada. Saltaban y morían al
formatear, así que no llegó ninguno.
→ Una alerta sin probar no es una alerta. Pruébala provocando el caso.

**WhatsApp Cloud API**
- Responde **200 a Meta antes de procesar nada**. Si tardas, Meta reintenta y acaba
  desactivando el webhook
- La firma `X-Hub-Signature-256` se valida sobre el **cuerpo crudo** (opción `Raw Body`
  del nodo Webhook, que lo deja en `$binary.data`), **nunca** sobre
  `JSON.stringify($json.body)`: al reserializar, emojis y tildes cambian y la firma
  deja de cuadrar en mensajes reales
- Verificar el webhook **no basta**, y suscribirse al campo `messages` **tampoco**.
  Hay un tercer nivel que no aparece en el panel: la **WABA tiene que estar suscrita
  a tu app**. Compruébalo con `GET /v23.0/{WABA_ID}/subscribed_apps`.
  Nos pasó: la WABA estaba suscrita solo a *«WA DevX Webhook Events 1P App»* y no a
  la nuestra. Se arregla con `POST` a esa misma ruta.
  **El síntoma es engañoso**: el botón de test del panel entrega correctamente
  (va directo a la URL), pero los mensajes reales no llegan nunca, porque esos sí
  pasan por el enrutado de la WABA. Si test sí y real no, mira `subscribed_apps`
  antes de tocar una sola línea del webhook
- El `ctwa_clid` (atribución del anuncio) llega en `messages[0].referral` y **solo en el
  primer mensaje** del cliente. Si no se captura ahí, el pedido queda sin atribuir
- **NO hay foto de perfil del cliente, y no la va a haber.** El webhook trae
  `contacts[].profile` con **un solo campo, `name`**. Y no hay endpoint que la sirva:
  un `wa_id` ni siquiera es un objeto del grafo (`GET /v23.0/{wa_id}` → *«Object with
  ID ... does not exist»*, code 100 subcode 33; `/{wa_id}/picture` → *«nonexisting
  field (picture)»*). El `profile_picture_url` que sí existe es el de
  `whatsapp_business_profile`, o sea **el tuyo**, no el del cliente.
  Comprobado contra la API el 23/8/2026, no deducido de la documentación.
  Lo que devuelven whapi.cloud, wasenderapi y compañía sale de WhatsApp Web
  ingeniería inversa — **el mismo camino que nos costó el ban**. No es una opción.
  → El avatar es y seguirá siendo iniciales sobre color. El color sale del NÚMERO
    (`colorAvatar` en `inbox/src/lib/formato.ts`), nunca del nombre: el nombre lo
    edita el cliente cuando quiere y el avatar cambiaría de color con él

**Supabase / PostgREST**
- El índice único para `ON CONFLICT` **no puede ser parcial**. Postgres solo usa un
  índice con `WHERE` si el predicado viaja en la inferencia del conflicto, y PostgREST
  no lo manda: el upsert devuelve **409** en vez de ignorar el duplicado.
  Créalo sin `WHERE`. El `WHERE ... is not null` además sobra, porque en un índice
  único los `NULL` ya cuentan como distintos entre sí:
  `create unique index uq_mensajes_canal_msgid on mensajes (canal, msg_id_canal);`
- Para que PostgREST use la vía de upsert hay que mandar **las dos cosas**:
  `?on_conflict=col1,col2` en la URL y `Prefer: resolution=ignore-duplicates`.
  Solo con la cabecera, no funciona
- **No uses `Accept: application/vnd.pgrst.object+json` desde un nodo HTTP de n8n.**
  PostgREST responde con ese mismo `Content-Type`, n8n **no lo reconoce como JSON**
  y deja el cuerpo como **cadena de texto**. Entonces `body.campo` es `undefined`,
  la condición que lo comprueba falla y el flujo se va por la rama por defecto
  **sin dar ningún error**. Nos pasó leyendo `bot_activo`: el bot habría respondido
  a un cliente pausado y la ejecución salía en verde.
  Usa JSON normal y trabaja con el array: `[]` = 0 filas, `[x]` = 1, `[x,y]` = duplicados.
  Es además más robusto que `PGRST116`, que no distingue 0 filas de N.
- Al leer una respuesta HTTP en un nodo Code, **parsea si viene como cadena**:
  `if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) {} }`
- Los `CHECK` se evalúan **antes** que las claves foráneas. Eso permite sondear qué
  valores acepta una columna sin ensuciar la tabla: manda la fila con un `cliente_id`
  inexistente — si el error cambia de `_check` a clave foránea (23503), el valor es
  válido y no se ha insertado nada
- Valores admitidos: `estado` = pendiente·enviado·entregado·leido·**fallido** ·
  `direccion` = in·out · `autor` = cliente·bot·humano·sistema · `tipo` =
  text·image·audio·video·document·sticker·location.
  **`recibido` NO existe**: un mensaje entrante se guarda como `entregado`

**Negocio**
- `palabras_clave` del Sheet = SOLO nombres del producto. Nunca "precio", "info", "cuanto":
  si se repiten en todos los productos, todo empata y no se identifica nada
- Nunca enumerar el catálogo: si una respuesta menciona 2+ productos, se descarta
- Silencio total tras recibir los datos del pedido: solo aviso interno, cero mensajes
  al cliente. **Desde el 23/8/2026 es literal**: se quitaron `Preparar: gracias` y
  `ENVIAR gracias` del receptor, y `Guardar pedido` engancha directamente con
  `Apagar tras el pedido`. Se guarda el pedido, se avisa a Telegram, sale el carrito
  y el bot se apaga — sin decirle nada al cliente.
  *Pendiente, si molesta:* el indicador de «escribiendo…» se manda mucho antes, en
  `Añadir contexto`, cuando todavía no se sabe si esto va a ser un pedido. Así que
  el cliente ve el doble check azul y «escribiendo…», y luego nada. El indicador
  caduca solo a los ~25 s. Para quitarlo habría que mover esa rama por detrás de
  `¿Pedido completo?`, y eso retrasa el check azul en TODOS los mensajes normales
- **El producto NUNCA sale de una regex sobre el texto del modelo.** Sale de emparejar
  contra las `palabras_clave` del catálogo, igual que `Decidir ficha`. `Preparar pedido`
  lo sacaba con una expresión regular del bloque `[PEDIDO]` y fallaba en **33 de 40**
  filas: dejaba `"Mini Luces LED ... cantidad: 12 precio: $995"` entero en
  `pedidos.producto`, y por eso la tabla tenía 11 «productos» con un catálogo de 4.
  El texto del modelo vale como PISTA, nunca como dato
- **Un empate al emparejar es una duda, y una duda no se rellena.** Si dos productos
  encajan igual de bien, `producto_id` se queda a `null` y no se marca nada. Un hueco
  se ve y se investiga; un producto inventado se cuela en los filtros y nadie lo nota

**Estados de negocio: solo los deterministas**
- `conversacion_productos.estado` tiene **dos** valores y no cuatro:
  `interesado` (lo pone `Decidir ficha`) y `comprado` (lo pone `Guardar pedido`).
  Los dos salen de un evento del flujo, sin pasar por el modelo
- **"negociando" y "descartado" NO se pueden deducir.** Lo más parecido que hay es el
  nodo `¿Esperando datos?`, que busca **tres cadenas literales** dentro del texto libre
  del modelo (`'%para preparar el env%'`...). Si María lo dice de otra forma, falla en
  silencio. Eso vale para una decisión de un turno —fallar cuesta un paso saltado que
  se corrige solo al mensaje siguiente— y **no vale como estado guardado**: el mismo
  fallo aparca al cliente en el cajón equivocado para siempre y nadie se entera.
  La asimetría es esa: lo transitorio se autocorrige, lo guardado se pudre
- **"frío" se calcula, no se guarda.** Sale de `conversaciones.ultimo_del_cliente` en el
  inbox. Guardado sería mentira al día siguiente
- Antes de añadir un campo que alguien lea, comprueba que alguien lo escribe.
  `conversaciones.producto_activo` se leía en cuatro sitios y no se escribía en ninguno:
  siempre `null`, y los cuatro eran pass-through. Ya se han quitado las lecturas

**Bugs ya corregidos en la v4 — no los reintroduzcas**
- `Decidir ficha` excluía de la BÚSQUEDA los productos con ficha ya enviada, así que
  al turno siguiente no identificaba nada y María preguntaba "¿Qué producto le interesa?"
  justo después de mandar la ficha. Identificar y enviar son decisiones distintas.
- `Filtro Seguridad` contaba como firma cualquier palabra de 5+ letras del nombre.
  "carga" está en dos productos, así que bloqueaba respuestas correctas.
  Ahora solo cuentan las palabras exclusivas de un producto, por palabra completa.
- Al reutilizar el emparejador de `Decidir ficha` en `Preparar pedido`, **no copies el
  filtro de fichas ya enviadas**. Ahí excluir tiene sentido (no repetir una ficha);
  en un pedido es al revés: que el cliente que compra ya tuviera la ficha es el caso
  NORMAL, y excluirlo dejaría sin identificar justo los pedidos buenos. Es el mismo
  error de arriba con el signo cambiado.

---

## Cómo quiero trabajar

- **Verifica, no supongas.** Si dices que algo funciona, enséñame la salida del comando.
- **Explica en español**, directo y sin rodeos.
- **Un cambio cada vez.** No mezcles arreglos en la misma tanda.
- **Si algo huele mal, dilo**, aunque yo haya pedido lo contrario.
- Los cambios de n8n se entregan como JSON completo importable, sin quitar
  credenciales, apikeys ni el modelo configurado.


## Supabase

- Proyecto `lumabot-inbox` — https://kiiiwtuwuauhomadmplv.supabase.co
- Tablas: `conversaciones`, `mensajes`. Trigger `tocar_conversacion` y RLS activos.
- `marcas_revision` (11-marca-revision.sql) — la marca de «revisado hasta aquí».
  **UNA por canal, y eso lo impone la CLAVE PRIMARIA, no el frontend**: `canal_id`
  es la PK, así que marcar otra conversación del mismo número es un upsert que
  SUSTITUYE la fila, en una sola escritura. Con un booleano en `conversaciones`
  serían dos —quitar la vieja, poner la nueva— y entre ellas, o si una falla,
  quedarían dos marcas y nadie se enteraría hasta ver dos rayas amarillas.
  Por canal y no global porque la lista mezcla los dos números ordenados por
  fecha: sobre esa mezcla, una sola marca no significa nada. Compartida entre
  usuarios a propósito — es la marca del equipo; quién la puso va en `marcado_por`.
- NO borres tablas, columnas ni datos sin preguntarme antes.
- La `service_role` se salta RLS: solo en n8n y en el servidor. NUNCA en
  ficheros del frontend ni en el repo del inbox.
- El frontend usa la `anon` key y RLS. No tiene permiso de INSERT en
  `mensajes` a propósito: escribe llamando al webhook de n8n.

### 🚨 Pausar o reactivar el bot a mano

**Hasta que exista el botón del inbox (Fase 4), esta es la única forma de
callar al bot con un cliente.** Guárdalo donde lo tengas a mano en el móvil.

Desde el móvil por SSH — **preferida**, porque la clave no viaja ni se escribe
en ningún sitio: se lee de `/opt/bot/wa.env`, que ya está en el servidor.

```bash
ssh root@116.203.17.128 'set -a; . /opt/bot/wa.env; set +a; \
curl -s -X PATCH "$SUPABASE_URL/rest/v1/conversaciones?cliente_id=eq.34641691299" \
 -H "apikey: $SUPABASE_SERVICE_ROLE" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE" \
 -H "Content-Type: application/json" -H "Prefer: return=representation" \
 -d "{\"bot_activo\": false}"'
```

- `false` → **el bot se calla**, tú atiendes. `true` → vuelve a atender él.
- Cambia `34641691299` por el `cliente_id` del cliente, que es su número con
  código de país y **sin** `+` ni espacios. Un mexicano es `521` + 10 dígitos.
- Con `Prefer: return=representation` te devuelve la fila para que veas que
  cambió. Sin esa cabecera, un `204` mudo.
- **Ojo:** si te equivocas de `cliente_id` no da error, devuelve `[]`. Si la
  respuesta viene vacía, no has pausado a nadie.

Para ver cómo está antes de tocar nada:

```bash
ssh root@116.203.17.128 'set -a; . /opt/bot/wa.env; set +a; \
curl -s "$SUPABASE_URL/rest/v1/conversaciones?cliente_id=eq.34641691299&select=cliente_id,nombre,bot_activo,ultimo_texto" \
 -H "apikey: $SUPABASE_SERVICE_ROLE" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE"'
```

Y para listar a todos los que tienes pausados ahora mismo:

```bash
ssh root@116.203.17.128 'set -a; . /opt/bot/wa.env; set +a; \
curl -s "$SUPABASE_URL/rest/v1/conversaciones?bot_activo=is.false&select=cliente_id,nombre,ultimo_texto&order=ultimo_en.desc" \
 -H "apikey: $SUPABASE_SERVICE_ROLE" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE"'
```

La `service_role` **no se escribe aquí a propósito**: este fichero está en el
repo. Vive solo en `/opt/bot/wa.env` con permisos `600`.