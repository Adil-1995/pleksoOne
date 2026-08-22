# CONTEXTO — Migración LumaBot a WhatsApp Cloud API

Copia todo esto al inicio del chat nuevo.

---

## Qué estamos haciendo

Migrando **LumaBot / María**, un bot de ventas por WhatsApp para **Lado Luminoso**
(dropshipping en México, pago contra entrega), desde **Evolution API** (canal no
autorizado, provocó un ban de WhatsApp) a **WhatsApp Cloud API + Supabase**.

Trabajo con **Claude Code** en la terminal (tiene SSH al VPS, acceso a la carpeta
local y API key de n8n). Yo voy pasando capturas de lo que hace y necesito que me
las interpretes y me digas qué contestarle.

## Principio que gobierna todo

> WhatsApp es un tubo intercambiable. Los datos son míos y viven en mi base de datos.

### Las cinco reglas de arquitectura

1. **Todo mensaje se guarda antes de decidir nada** — primer nodo tras el webhook,
   entre o salga, del bot o de un humano, sea ficha o texto
2. **Un único punto de salida a WhatsApp**
3. **La identidad no depende del canal** — `cliente_id` (= `wa_id`), nunca teléfono ni LID
4. **Campo `canal` en todas las tablas** para convivir con dos proveedores
5. **Las decisiones de negocio van en el flujo, no en el prompt**

---

## Infraestructura

| Qué | Dónde |
|---|---|
| VPS | Hetzner Ubuntu 24.04, **4 GB RAM**, `116.203.17.128`, todo en `/opt/bot` |
| n8n | `https://plekso.duckdns.org` (v2.34.6) |
| Postgres viejo | contenedor `bot-postgres-1`, user `admin`, db `appdb` |
| Supabase | proyecto `lumabot-inbox`, `https://kiiiwtuwuauhomadmplv.supabase.co`, región West EU |
| Variables | `/opt/bot/wa.env` (12 variables) |
| Modelo | `gpt-5.6-sol`, maxTokens 500 |

### WhatsApp Cloud API
- App **WTSP API**, ID `1477240634012233`, **publicada**
- Número de pruebas `+1 (555) 635-0023`
- **Phone Number ID:** `1050242784838044`
- **WABA ID:** `1686689748986716`
- Webhook: `https://plekso.duckdns.org/webhook/wa-cloud`
- Verificación del negocio: **Unverified** — necesita RFC mexicano

### Telegram (sustituye a los grupos de WhatsApp)
- Pedidos MX → chat_id `-5264622293`
- Incidencias MX → chat_id `-5266825033`

---

## Estado del plan

```
Fase 0  ✅ Backups (pg_dump nocturno 03:15 MX, restauración probada)
           ⬜ falta: snapshot de Hetzner
Fase 1  ✅ Cloud API enviando y recibiendo, firma HMAC validada
Fase 2  ✅ Supabase: conversaciones, mensajes, trigger, RLS, storage, realtime
Fase 3  🟡 Migrar el flujo
          ├─ Tanda 1 ✅ Persistencia — guarda en Supabase
          ├─ Tanda 2 ✅ Punto único de salida — subflujo probado
          ├─ Tanda 3a 🟡 Identidad y pausa
          │    ├─ Datos migrados: 180 conversaciones, 80 pausadas, 105 con ctwa_clid
          │    └─ FALTA: que el flujo lea conversaciones.bot_activo en vez de pausados
          ├─ Tanda 3b ⬜ Reconectar los 10 puntos de salida del v3
          └─ Tanda 4  ⬜ Media a Storage + alertas a Telegram
Fase 4  ⬜ Inbox propio (Vite + React + Supabase Realtime, servido por Caddy)
Fase 5  ⬜ Reducir incidencias (de ~60/día a 5-8)
Fase 6  ⬜ Corte a producción
```

### Workflows en n8n
- `4uK8Dpsi8JA9GGaA` [activo] Fase 3 tanda 1 (persistencia)
- `fUnaKZ51BWB2qJ7U` [activo] Salida WhatsApp (punto único)
- v3 antiguo: **apagado**, no se toca
- Fase 1 recepción: apagada, es la marcha atrás

---

## Lecciones aprendidas (caras, no repetir)

**WhatsApp / Meta**
- **Suscribir la app a la WABA es distinto de suscribirse al campo `messages`.**
  La WABA estaba suscrita solo a "WA DevX Webhook Events 1P App" (app interna de
  Meta) y los mensajes reales nunca llegaban. Se comprueba con
  `GET /{WABA_ID}/subscribed_apps` y se arregla con POST a esa misma ruta.
  Síntoma engañoso: el test manual del panel sí llega, los mensajes reales no.
- El número hay que **registrarlo** con `POST /{PHONE_ID}/register` y un PIN antes
  de poder enviar. Si no: error `133010 Account not registered`.
- El token necesita **el activo WABA asignado** en Usuarios del sistema, no basta
  con los permisos.
- **`wa_id` mexicano viene CON el 1**: `5214426020912` (13 dígitos). Coincide con
  el formato viejo de Evolution.

**Supabase / PostgREST**
- **PostgREST no acepta índices parciales (`WHERE ...`) para `ON CONFLICT`.**
  Error `42P10`. Hay que crear el índice único sin el `where`.
- No se puede lanzar DDL con la service_role: `ALTER TABLE` va en el SQL Editor.

**n8n**
- n8n 2.0 bloquea `$env` en los nodos: hace falta `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`
- En n8n 2.x un subflujo **tiene que estar publicado** para que otro lo referencie
- `$('Nodo').item` no resuelve el emparejamiento tras un nodo HTTP intermedio → usar `.first()`
- `delay` de Evolution: `={{ 3000 }}` no `=3000`
- `queryReplacement` de Postgres: array `={{ [a, b] }}`
- Google Sheets necesita `authentication: serviceAccount` explícito

**Negocio (del v3, siguen vigentes)**
- `palabras_clave` del Sheet = SOLO nombres de producto
- Nunca enumerar el catálogo: 2+ productos en una respuesta → se descarta
- Silencio total tras recibir los datos del pedido

---

## Pendientes que no dependen del código

- ⬜ **Snapshot de Hetzner** — único agujero serio abierto
- ⬜ **Verificación del negocio en Meta** — necesita RFC mexicano, tarda días,
  **marca el ritmo de todo lo demás**
- ⬜ Rotar tres secretos que pasaron por el chat: App Secret, service_role, token de Meta
- ⬜ Borrar workflow "TEMP — lanzador de pruebas"
- ⬜ Probar la rama de error de la tanda 2

---

## Cómo quiero que me ayudes

- Te paso **capturas de Claude Code** y me dices qué está haciendo y qué contestarle
- **Dime siempre dónde exactamente** hay que pinchar: menú, submenú, botón
- Español, directo, sin rodeos
- Si algo huele mal, dilo aunque yo diga lo contrario
- Verifica antes de afirmar; si no lo sabes, dilo
