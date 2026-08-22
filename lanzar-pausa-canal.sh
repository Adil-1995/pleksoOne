#!/usr/bin/env bash
# =====================================================================
#  Cambio único: la pausa pasa a ser "conversación activa Y canal activo".
#  Uso:  N8N_KEY='...' bash lanzar-pausa-canal.sh
# =====================================================================
set -euo pipefail
N8N=https://plekso.duckdns.org
MULTI=qx1O54zpuyxzfW8V
SUB=CYgKApb26ARGlhVZ
SSHV="ssh -i $HOME/.ssh/lumabot_vps root@116.203.17.128"
: "${N8N_KEY:?Falta N8N_KEY}"
H=(-H "X-N8N-API-KEY: $N8N_KEY" -H "Content-Type: application/json")
cd "$HOME/lumabot"

echo "### 1. El subflujo sigue publicado? (si no, el PUT se rechaza)"
curl -fsS "${H[@]}" "$N8N/api/v1/workflows/$SUB" \
 | grep -q '"active":true' && echo "  ok, $SUB publicado" \
 || { echo "  $SUB NO publicado. Publicalo primero."; exit 1; }

echo "### 2. PUT del multicanal (aqui empieza la ventana de unos segundos)"
curl -fsS -X PUT "${H[@]}" "$N8N/api/v1/workflows/$MULTI" \
     --data @fase8-multicanal-pausa-canal.json >/dev/null
echo "### 3. Republicar YA"
curl -fsS -X POST "${H[@]}" "$N8N/api/v1/workflows/$MULTI/activate" >/dev/null
echo "  republicado"

echo "### 4. PUERTA: el webhook tiene que estar registrado y contestar"
$SSHV 'docker exec bot-postgres-1 psql -U admin -d appdb -t -A -F"|" -c "select \"webhookPath\",method,\"workflowId\" from webhook_entity order by 1;"'
R=$($SSHV 'set -a; . /opt/bot/wa.env; set +a; curl -s "https://plekso.duckdns.org/webhook/wa-cloud-multi?hub.mode=subscribe&hub.verify_token=$WA_VERIFY_TOKEN&hub.challenge=1234"')
echo "  hub.challenge -> $R"
[ "$R" = "1234" ] || { echo "  NO responde. Restaura:"; echo "  curl -X PUT ... --data @backup-multicanal-VIVO-20260822-preBotActivo.json  y vuelve a activar"; exit 1; }

echo "### 5. Comprobar que el campo nuevo viaja"
echo "  Pausa el canal 2 y escribe: Maria no debe contestar por ese numero."
echo "  Para revertir SOLO el codigo:"
echo "    curl -X PUT ... --data @backup-multicanal-VIVO-20260822-preBotActivo.json"
echo "### LISTO"
