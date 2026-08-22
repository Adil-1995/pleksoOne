#!/usr/bin/env bash
set -euo pipefail
N8N=https://plekso.duckdns.org
SUB=CYgKApb26ARGlhVZ; MULTI=qx1O54zpuyxzfW8V; ENVIO=YGqvrxFadgtdS7Lo
SSHV="ssh -i $HOME/.ssh/lumabot_vps root@116.203.17.128"
: "${N8N_KEY:?Falta N8N_KEY}"
H=(-H "X-N8N-API-KEY: $N8N_KEY" -H "Content-Type: application/json")
cd "$HOME/lumabot"

echo "### 1. SUBFLUJO: PUT + publicar (primero, siempre)"
curl -fsS -X PUT "${H[@]}" "$N8N/api/v1/workflows/$SUB" --data @fase8-salida-leido-multicanal.json >/dev/null
curl -fsS -X POST "${H[@]}" "$N8N/api/v1/workflows/$SUB/activate" >/dev/null
echo "  subflujo publicado"

echo "### 2. RECEPTOR: PUT + publicar"
curl -fsS -X PUT "${H[@]}" "$N8N/api/v1/workflows/$MULTI" --data @fase8-receptor-completo.json >/dev/null
curl -fsS -X POST "${H[@]}" "$N8N/api/v1/workflows/$MULTI/activate" >/dev/null
echo "  receptor publicado"

echo "### 3. WEBHOOK DE ENVÍO: republicar (la cascada lo tumbó)"
curl -fsS -X POST "${H[@]}" "$N8N/api/v1/workflows/$ENVIO/activate" >/dev/null
echo "  envío publicado"

echo "### 4. Lista ENTERA de activos"
curl -fsS "${H[@]}" "$N8N/api/v1/workflows?limit=250" \
 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const w=JSON.parse(s).data.filter(x=>x.active);
   console.log("  ACTIVOS ("+w.length+"):"); w.forEach(x=>console.log("    "+x.id+"  "+x.name));})'

echo "### 5. webhook_entity"
$SSHV 'docker exec bot-postgres-1 psql -U admin -d appdb -t -A -F"|" -c "select \"webhookPath\",method,\"workflowId\" from webhook_entity order by 1;"'

echo "### 6. PUERTA: hub.challenge"
R=$($SSHV 'set -a; . /opt/bot/wa.env; set +a; curl -s "https://plekso.duckdns.org/webhook/wa-cloud-multi?hub.mode=subscribe&hub.verify_token=$WA_VERIFY_TOKEN&hub.challenge=1234"')
echo "  wa-cloud-multi -> $R"
[ "$R" = "1234" ] || { echo "  NO responde. Restaura con los backups y reactiva subflujo->receptor->envio."; exit 1; }
echo "### LISTO"
