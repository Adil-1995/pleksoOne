#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Recuperación de Purchases al CAPI que se perdieron por el error 2804132.

Del 27/8 al 3/9/2026 el nodo `Enviar a Meta CAPI` mandaba TODOS los eventos a
un dataset global ($env.CAPI_DATASET = 2044273926400221) que no tiene ninguna
WABA vinculada. Meta los rechazaba con 100/2804132 y la ejecución salía verde.
Arreglado el 3/9 con `canales.dataset_id` (15-dataset-por-canal.sql), quedan
32 ventas reales sin reportar.

POR QUÉ UN SCRIPT Y NO EL INBOX
-------------------------------
Revalidar desde el inbox REESCRIBE `validado_en` — medido con la línea 2141,
que pasó de 07:18:04.807 a 09:49:24.968. Recuperar así reportaría las 32 con
fecha de hoy y destruiría la fecha real de cada venta, que es lo único
irreversible de todo esto. Y el webhook `capi-purchase` exige una sesión de
usuario contra /auth/v1/user, que la service_role no puede fabricar.

QUÉ HACE, Y POR QUÉ ES LA MISMA SECUENCIA DEL FLUJO
---------------------------------------------------
Por cada conversación: capi_tomar -> POST a Meta -> capi_cerrar. Son las
MISMAS RPC que usa el workflow, con la misma semántica de cerrojo. No se
inventa ninguna escritura nueva: el cerrojo lo pone y lo quita quien ya lo
hacía. `capi_tomar` no toca `validado_en`, así que cada venta se reporta con
su fecha de verdad.

LAS DOS CONDICIONES, PUESTAS EN EL CÓDIGO
-----------------------------------------
1. NUNCA escribe en `validado_en`. No es una promesa: `_pedir()` rechaza
   cualquier cuerpo que mencione ese campo, y al final se relee y se compara
   contra lo leído al principio. Si algo lo hubiera movido, sale por pantalla.
2. La guarda de 7 días se reevalúa por línea JUSTO ANTES de tomar el cerrojo.
   Una línea que caduque a mitad del lote se SALTA y se dice — no se toca, no
   se le escribe error, se queda exactamente como estaba. Mejor un hueco que
   una venta atribuida al día equivocado.

USO
    python3 recuperar-capi.py 4966                 # una conversación
    python3 recuperar-capi.py 4966 5192 5340       # un lote
    python3 recuperar-capi.py --seco 4966          # sin mandar ni escribir nada

Deja rastro en recuperacion-capi.jsonl (una línea JSON por conversación).
"""

import calendar
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

LIMITE_DIAS = 7
ENV = "/opt/bot/wa.env"
BITACORA = "recuperacion-capi.jsonl"

# El único campo que no se puede tocar. Si aparece en un cuerpo de escritura,
# el script se para en seco en vez de mandarlo.
PROHIBIDO = "validado_en"


def cargar_env(ruta):
    v = {}
    with open(ruta, encoding="utf-8") as f:
        for l in f:
            l = l.strip()
            if not l or l.startswith("#") or "=" not in l:
                continue
            k, _, val = l.partition("=")
            v[k.strip()] = val.strip().strip('"').strip("'")
    return v


E = cargar_env(ENV)
SB = E["SUPABASE_URL"].rstrip("/")
SR = E["SUPABASE_SERVICE_ROLE"]
TOK = E["CAPI_TOKEN"]
VER = E.get("WA_API_VERSION", "v23.0")
SECO = "--seco" in sys.argv


def _pedir(url, metodo="GET", cuerpo=None, cabeceras=None):
    datos = None
    if cuerpo is not None:
        crudo = json.dumps(cuerpo)
        # Condición 1, aplicada de verdad: nada que mencione validado_en sale
        # de aquí, venga de donde venga.
        if PROHIBIDO in crudo:
            raise SystemExit("ABORTADO: un cuerpo de escritura menciona %r -> %s" % (PROHIBIDO, crudo[:300]))
        datos = crudo.encode("utf-8")
    req = urllib.request.Request(url, data=datos, method=metodo)
    for k, v in (cabeceras or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as ex:
        try:
            return ex.code, json.loads(ex.read().decode("utf-8") or "null")
        except Exception:
            return ex.code, None


def sb(ruta, metodo="GET", cuerpo=None):
    return _pedir(SB + ruta, metodo, cuerpo, {
        "apikey": SR,
        "Authorization": "Bearer " + SR,
        "Content-Type": "application/json",
    })


def epoch(iso):
    return calendar.timegm(time.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S"))


def sha256_tel(cliente_id):
    return hashlib.sha256("".join(c for c in str(cliente_id) if c.isdigit()).encode()).hexdigest()


def apuntar(fila):
    with open(BITACORA, "a", encoding="utf-8") as f:
        f.write(json.dumps(fila, ensure_ascii=False) + "\n")


def procesar(conv_id):
    marca = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # --- 1. Leer, ANTES de tomar nada -------------------------------------
    campos = ("id,producto,precio,cantidad,validado_en,capi_enviado_en,"
              "conversaciones(cliente_id,ctwa_clid,canales(nombre,waba_id,dataset_id))")
    st, filas = sb("/rest/v1/conversacion_productos?conversacion_id=eq.%d"
                   "&estado=eq.validado&capi_enviado_en=is.null&select=%s&order=id" % (conv_id, campos))
    if st != 200 or not filas:
        return {"conv": conv_id, "resultado": "sin_lineas", "detalle": "nada validado y sin reportar"}

    conv = filas[0]["conversaciones"] or {}
    canal = conv.get("canales") or {}
    # Se guarda para comparar al final (condición 1).
    antes = {f["id"]: f["validado_en"] for f in filas}

    # --- 2. Motivos para NO tocar nada ------------------------------------
    faltas = []
    if not (conv.get("ctwa_clid") or "").strip():
        faltas.append("sin ctwa_clid")
    if any(f["precio"] is None for f in filas):
        faltas.append("alguna linea sin precio del catalogo")
    if not canal.get("waba_id"):
        faltas.append("canal sin waba_id")
    if not canal.get("dataset_id"):
        faltas.append("canal sin dataset_id")

    event_time = min(epoch(f["validado_en"]) for f in filas)
    dias = (time.time() - event_time) / 86400.0
    # Condición 2: se reevalúa aquí, con el reloj de AHORA, no con el del
    # momento en que se planificó el lote.
    if dias > LIMITE_DIAS:
        faltas.append("fuera de la ventana de %d dias: %.2f dias" % (LIMITE_DIAS, dias))

    if faltas:
        # No se toma el cerrojo, no se escribe error, no se toca la fila.
        r = {"conv": conv_id, "resultado": "saltada", "detalle": " · ".join(faltas),
             "dias": round(dias, 2), "lineas": [f["id"] for f in filas], "cuando": marca}
        apuntar(r)
        return r

    if SECO:
        return {"conv": conv_id, "resultado": "seco", "dias": round(dias, 2),
                "lineas": [f["id"] for f in filas],
                "event_id": "pedido-%d-%d" % (conv_id, min(f["id"] for f in filas)),
                "event_time": event_time, "dataset": canal["dataset_id"]}

    # --- 3. Tomar el cerrojo (misma RPC que el flujo) ----------------------
    st, tomadas = sb("/rest/v1/rpc/capi_tomar", "POST", {"p_conversacion_id": conv_id})
    if st >= 300 or not tomadas:
        return {"conv": conv_id, "resultado": "no_se_pudo_tomar", "detalle": "http %s %s" % (st, tomadas)}

    ids = sorted(t["id"] for t in tomadas)
    event_id = "pedido-%d-%d" % (conv_id, min(ids))

    def soltar(motivo):
        sb("/rest/v1/rpc/capi_cerrar", "POST", {"p_ids": ids, "p_ok": False, "p_error": motivo})

    # Lo tomado tiene que ser exactamente lo leído. Si no, se suelta y se sale:
    # significa que algo cambió por debajo mientras trabajábamos.
    if ids != sorted(antes.keys()):
        soltar("el script leyo %s y capi_tomar devolvio %s" % (sorted(antes.keys()), ids))
        return {"conv": conv_id, "resultado": "descuadre", "detalle": "leido %s vs tomado %s" % (sorted(antes.keys()), ids)}

    try:
        valor = sum(float(f["precio"]) * int(f["cantidad"] or 1) for f in filas)
        unidades = sum(int(f["cantidad"] or 1) for f in filas)
        evento = {"data": [{
            "event_name": "Purchase",
            "event_time": event_time,
            "action_source": "business_messaging",
            "messaging_channel": "whatsapp",
            "event_id": event_id,
            "user_data": {
                "ctwa_clid": conv["ctwa_clid"],
                "whatsapp_business_account_id": canal["waba_id"],
                "ph": [sha256_tel(conv["cliente_id"])],
            },
            "custom_data": {
                "currency": "MXN",
                "value": round(valor, 2),
                "num_items": unidades,
                "content_name": " + ".join(f["producto"] for f in filas),
                "order_id": event_id,
            },
        }]}

        url = "https://graph.facebook.com/%s/%s/events?access_token=%s" % (VER, canal["dataset_id"], TOK)
        st, resp = _pedir(url, "POST", evento, {"Content-Type": "application/json"})
        recibidos = (resp or {}).get("events_received")
        fbtrace = (resp or {}).get("fbtrace_id")

        if st == 200 and recibidos and recibidos >= 1:
            sb("/rest/v1/rpc/capi_cerrar", "POST", {"p_ids": ids, "p_ok": True, "p_error": None})
            estado = "aceptada"
            motivo = None
        else:
            err = (resp or {}).get("error") or {}
            motivo = "Meta lo rechazo: %s (code %s%s)" % (
                err.get("error_user_msg") or err.get("message") or ("http %s" % st),
                err.get("code"), "/" + str(err["error_subcode"]) if err.get("error_subcode") else "")
            soltar(motivo)
            estado = "rechazada"
    except Exception as ex:
        soltar("el script fallo antes de leer la respuesta: %s" % ex)
        raise

    # --- 4. Comprobar que validado_en NO se movió (condición 1) ------------
    st2, despues = sb("/rest/v1/conversacion_productos?id=in.(%s)&select=id,validado_en,capi_enviado_en,capi_error"
                      % ",".join(str(i) for i in ids))
    movidas = [d["id"] for d in (despues or []) if antes.get(d["id"]) != d["validado_en"]]

    r = {"conv": conv_id, "resultado": estado, "lineas": ids, "event_id": event_id,
         "event_time": event_time,
         "event_time_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(event_time)),
         "dias": round(dias, 2), "valor": round(valor, 2), "unidades": unidades,
         "dataset": canal["dataset_id"], "canal": canal.get("nombre"),
         "http": st, "events_received": recibidos, "fbtrace_id": fbtrace,
         "motivo": motivo, "cuando": marca,
         "validado_en_intacto": not movidas,
         "capi_enviado_en": {d["id"]: d["capi_enviado_en"] for d in (despues or [])},
         "capi_error": {d["id"]: d["capi_error"] for d in (despues or [])}}
    apuntar(r)
    return r


def main():
    convs = [int(a) for a in sys.argv[1:] if not a.startswith("--")]
    if not convs:
        raise SystemExit("uso: recuperar-capi.py [--seco] <conversacion_id> [...]")
    print("modo: %s | limite: %d dias | %d conversacion(es)"
          % ("SECO (no manda ni escribe)" if SECO else "REAL", LIMITE_DIAS, len(convs)))
    res = []
    for c in convs:
        r = procesar(c)
        res.append(r)
        print(json.dumps(r, ensure_ascii=False, indent=2))
    print("\n=== RESUMEN ===")
    for k in ("aceptada", "rechazada", "saltada", "sin_lineas", "descuadre", "no_se_pudo_tomar", "seco"):
        n = [r for r in res if r.get("resultado") == k]
        if n:
            print("  %-18s %d  %s" % (k, len(n), [r["conv"] for r in n]))
    ok = [r for r in res if r.get("resultado") == "aceptada"]
    if ok:
        print("  importe aceptado : %.2f MXN" % sum(r["valor"] for r in ok))
    malas = [r for r in res if r.get("validado_en_intacto") is False]
    print("  validado_en intacto en todas: %s" % ("NO !!! " + str(malas) if malas else "sí"))


if __name__ == "__main__":
    main()
