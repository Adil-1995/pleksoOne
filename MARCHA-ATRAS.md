# MARCHA ATRÁS — LumaBot multicanal

Estado verificado el **22 de agosto de 2026, 23:15 UTC**, contra el
servidor: no es de memoria, sale de `webhook_entity` y de la API de Meta.

---

## Estado bueno conocido

| Qué | Valor |
|---|---|
| Meta entrega en | `https://plekso.duckdns.org/webhook/wa-cloud-multi` |
| Receptor | `qx1O54zpuyxzfW8V` — activo, sirve `wa-cloud-multi` |
| Subflujo de salida | `CYgKApb26ARGlhVZ` — activo (punto único hacia WhatsApp) |
| Webhook de envío | `YGqvrxFadgtdS7Lo` — activo, sirve `inbox-enviar` |
| Persistencia | `4uK8Dpsi8JA9GGaA` — activo, sirve `wa-cloud` |
| Histórico 3b | `BtqTW7ZiLKIDD1nv` — activo, sirve `wa-cloud-3b`, sin tráfico |
| Salida monocanal vieja | `fUnaKZ51BWB2qJ7U` — activa, ya no la llama nadie |
| Canal 1 | phone_number_id `1050242784838044` (número de PRUEBAS de Meta) |
| Canal 2 | phone_number_id `1325415680645290`, WABA `1100299049179241` |

> ⚠️ **`wa-cloud-4` ya NO existe.** El workflow que lo servía
> (`QHZLqwmQ4yq39CrU`, Fase 5 monocanal) está parado desde el corte.
> La versión anterior de este documento mandaba volver ahí: era falso y
> habría dejado el webhook en 404.

---

## Qué significa aquí "marcha atrás"

**Ya no hay una URL anterior a la que volver.** El corte a multicanal
retiró el flujo monocanal, así que revertir es **restaurar las
definiciones de los workflows**, no cambiar el `callback_url` de Meta.

Las definiciones que están vivas ahora mismo están en `workflows/`,
exportadas del propio n8n:

```
workflows/receptor-multicanal.json    -> qx1O54zpuyxzfW8V
workflows/salida-whatsapp.json        -> CYgKApb26ARGlhVZ
workflows/inbox-webhook-envio.json    -> YGqvrxFadgtdS7Lo
```

---

## 1. Restaurar una definición

```bash
N8N=https://plekso.duckdns.org
KEY='...'          # Settings → n8n API (audience = public-api)

curl -X PUT -H "X-N8N-API-KEY: $KEY" -H "Content-Type: application/json" \
  "$N8N/api/v1/workflows/CYgKApb26ARGlhVZ" \
  --data @workflows/salida-whatsapp.json
```

## 2. Publicar EN ORDEN — el subflujo SIEMPRE primero

Un `PUT` despublica. Y n8n rechaza publicar a quien llama si el subflujo
no está publicado.

```bash
for W in CYgKApb26ARGlhVZ qx1O54zpuyxzfW8V YGqvrxFadgtdS7Lo; do
  curl -X POST -H "X-N8N-API-KEY: $KEY" "$N8N/api/v1/workflows/$W/activate"
done
```

## 3. La ÚNICA prueba que vale

No te fíes del `200` del activate ni del `active` de la base.

```bash
ssh root@116.203.17.128 'set -a; . /opt/bot/wa.env; set +a; \
curl -s "https://plekso.duckdns.org/webhook/wa-cloud-multi?hub.mode=subscribe&hub.verify_token=$WA_VERIFY_TOKEN&hub.challenge=1234"'
```

Tiene que imprimir `1234`. Si da 404, el webhook no está registrado.
Comprueba qué hay de verdad:

```bash
ssh root@116.203.17.128 'docker exec bot-postgres-1 psql -U admin -d appdb \
 -t -A -F"|" -c "select \"webhookPath\",method,\"workflowId\" from webhook_entity order by 1;"'
```

---

## Retirar el canal 2 sin tocar el canal 1

```bash
ssh root@116.203.17.128 'set -a; . /opt/bot/wa.env; set +a; \
curl -s -X PATCH "$SUPABASE_URL/rest/v1/canales?id=eq.2" \
 -H "apikey: $SUPABASE_SERVICE_ROLE" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE" \
 -H "Content-Type: application/json" -H "Prefer: return=representation" \
 -d "{\"activo\": false}"'
```

Y desuscribir su WABA, si hace falta cortar la entrada de raíz:

```bash
ssh root@116.203.17.128 'set -a; . /opt/bot/wa.env; set +a; \
curl -s -X DELETE "https://graph.facebook.com/$WA_API_VERSION/1100299049179241/subscribed_apps" \
 -H "Authorization: Bearer $WA_TOKEN"'
```

---

## Callar a María sin tocar workflows

- **Un cliente:** `conversaciones.bot_activo = false` (por `cliente_id`).
- **Un número entero:** `canales.bot_activo = false`, o el botón del inbox
  en Ajustes → Canales, que ya funciona.

Los comandos completos están en `CLAUDE.md`, sección
«Pausar o reactivar el bot a mano».
