#!/usr/bin/env bash
# =====================================================================
#  LumaBot — corte a multicanal. Pasos 2..10.
#  Uso:  N8N_KEY='...' bash montar-multicanal.sh
#  Aborta a la primera puerta que no pase. No sigue a ciegas.
# =====================================================================
set -euo pipefail

N8N=https://plekso.duckdns.org
SUB=CYgKApb26ARGlhVZ     # subflujo salida multicanal
MULTI=qx1O54zpuyxzfW8V   # Fase 7 multicanal
ENVIO=YGqvrxFadgtdS7Lo   # webhook de envio del inbox
VIEJO=QHZLqwmQ4yq39CrU   # Fase 5 monocanal (el que sirve wa-cloud-4)
APP=1477240634012233
WABA=1100299049179241
SSHV="ssh -i $HOME/.ssh/lumabot_vps root@116.203.17.128"

: "${N8N_KEY:?Falta N8N_KEY}"
H=(-H "X-N8N-API-KEY: $N8N_KEY" -H "Content-Type: application/json")

echo "### 0. La key vale?"
curl -fsS "${H[@]}" "$N8N/api/v1/workflows?limit=1" >/dev/null \
  || { echo "KEY INVALIDA (audience debe ser public-api)"; exit 1; }
echo "ok"

echo "### 2a. PUBLICAR EL SUBFLUJO PRIMERO (n8n rechaza al que llama si no)"
curl -fsS -X POST "${H[@]}" "$N8N/api/v1/workflows/$SUB/activate" >/dev/null
echo "  subflujo $SUB publicado"

echo "### 2b. Subir el webhook de envio repuntado al subflujo multicanal"
node -e '
const fs=require("fs");
const d=JSON.parse(fs.readFileSync(process.env.HOME+"/lumabot/fase6-webhook-envio-bloqueo.json","utf8"));
if(JSON.stringify(d).includes("fUnaKZ51BWB2qJ7U")){console.error("AUN APUNTA AL SUBFLUJO VIEJO");process.exit(1);}
fs.writeFileSync(".envio-payload.json", JSON.stringify({
  name:d.name, nodes:d.nodes, connections:d.connections, settings:d.settings||{}
}));
console.log("payload listo, nodos:", d.nodes.length);
'
curl -fsS -X PUT "${H[@]}" "$N8N/api/v1/workflows/$ENVIO" --data @.envio-payload.json >/dev/null
echo "  subido (un PUT lo despublica; se reactiva abajo)"

echo "### 3. Publicar el resto EN ORDEN: multicanal -> envio"
for W in "$MULTI" "$ENVIO"; do
  curl -fsS -X POST "${H[@]}" "$N8N/api/v1/workflows/$W/activate" >/dev/null
  echo "  activate $W enviado"
done

echo "### 4. La lista ENTERA: quien quedo publicado de verdad"
curl -fsS "${H[@]}" "$N8N/api/v1/workflows?limit=250" \
 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
   const w=JSON.parse(s).data.filter(x=>x.active);
   console.log("ACTIVOS:"); w.forEach(x=>console.log("  "+x.id+"  "+x.name));
 })'
echo "--- webhooks REALMENTE registrados (la unica prueba fiable) ---"
$SSHV 'docker exec bot-postgres-1 psql -U admin -d appdb -t -A -F"|" -c "select \"webhookPath\",method,\"workflowId\" from webhook_entity order by 1;"'

echo "### 5. PUERTA: wa-cloud-multi tiene que devolver 1234"
R=$($SSHV 'set -a; . /opt/bot/wa.env; set +a; curl -s "https://plekso.duckdns.org/webhook/wa-cloud-multi?hub.mode=subscribe&hub.verify_token=$WA_VERIFY_TOKEN&hub.challenge=1234"')
echo "respuesta: $R"
[ "$R" = "1234" ] || { echo "NO responde. PARA AQUI. Meta sigue en wa-cloud-4 y produccion intacta."; exit 1; }

echo "### 7. Apuntar Meta a wa-cloud-multi"
$SSHV 'set -a; . /opt/bot/wa.env; set +a; \
 curl -s -X POST "https://graph.facebook.com/$WA_API_VERSION/'"$APP"'/subscriptions" \
  -d "object=whatsapp_business_account" \
  -d "callback_url=https://plekso.duckdns.org/webhook/wa-cloud-multi" \
  -d "verify_token=$WA_VERIFY_TOKEN" -d "fields=messages" \
  -d "access_token='"$APP"'|$WA_APP_SECRET"'
echo

echo "### 8. Parar el monocanal anterior (DESPUES de mover Meta, no antes)"
curl -fsS -X POST "${H[@]}" "$N8N/api/v1/workflows/$VIEJO/deactivate" >/dev/null && echo "  $VIEJO parado"

echo "### 9. Suscribir la app a la WABA nueva"
$SSHV 'set -a; . /opt/bot/wa.env; set +a; \
 curl -s -X POST "https://graph.facebook.com/$WA_API_VERSION/'"$WABA"'/subscribed_apps" -H "Authorization: Bearer $WA_TOKEN"'
echo
$SSHV 'set -a; . /opt/bot/wa.env; set +a; \
 curl -s -G "https://graph.facebook.com/$WA_API_VERSION/'"$WABA"'/subscribed_apps" --data-urlencode "access_token=$WA_TOKEN"'
echo

echo "### 10. Canal 2 activo"
$SSHV 'set -a; . /opt/bot/wa.env; set +a; \
 curl -s -X PATCH "$SUPABASE_URL/rest/v1/canales?id=eq.2" \
  -H "apikey: $SUPABASE_SERVICE_ROLE" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"activo\": true}"'
echo
echo "### LISTO. Ahora las pruebas a) b) c) d) con el movil."
