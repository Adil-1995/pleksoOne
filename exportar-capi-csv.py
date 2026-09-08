#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Una fila por venta reportada al CAPI, para contrastar contra el Administrador
de eventos de Meta.

TODO SALE DE DONDE YA ESTABA. No hay tabla nueva ni escritura nueva: se
juntan `conversacion_productos` (fechas, producto, importe, cerrojo),
`conversaciones` (ad_id, ctwa_clid) y `canales` (nombre, dataset). El
`event_id` no se guarda en ningún sitio y no hace falta: se deriva con la
MISMA fórmula del flujo, 'pedido-<conversacion>-<min(ids)>'.

EL ÚNICO HUECO: fbtrace_id y events_received.
Meta los devuelve en la respuesta del POST y HOY no se guardan en la base.
Solo existen en dos sitios, y los dos son temporales:
  - el log de ejecuciones de n8n, que se poda (hoy solo llega al 31/8)
  - recuperacion-capi.jsonl, que cubre las 32 recuperadas el 3/9/2026
Por eso este script los lee del .jsonl. Para las ventas NUEVAS habrá que
guardarlos en la fila; mientras no se haga, esas dos columnas saldrán vacías
y la columna `origen` dice de dónde vino cada fila.

USO
    python3 exportar-capi-csv.py                    # todo lo reportado
    python3 exportar-capi-csv.py --desde 2026-08-27 # desde una fecha
    python3 exportar-capi-csv.py --sin-nombres      # sin llamar a la Graph API

Escribe ventas-capi.csv (UTF-8 con BOM, para que Excel y Sheets no rompan
las tildes) y lo resume por pantalla.
"""

import calendar
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ENV = "/opt/bot/wa.env"
BITACORA = "recuperacion-capi.jsonl"
SALIDA = "ventas-capi.csv"

# La línea 2141 se reportó por el FLUJO el 3/9 (ejecución 27508), no por la
# recuperación, así que no está en el .jsonl. Su fbtrace se saca de esa
# ejecución, mientras siga en el log de n8n. Es exactamente el hueco que
# describe la cabecera: en cuanto se guarden en la fila, esto sobra.
DE_EJECUCIONES = {
    2141: {"fbtrace_id": "AtXt6ACYQtlBQR6D0qStd1w", "events_received": 1,
           "origen": "flujo (ejec. 27508)"},
}


def cargar_env(ruta):
    v = {}
    with open(ruta, encoding="utf-8") as f:
        for l in f:
            l = l.strip()
            if l and not l.startswith("#") and "=" in l:
                k, _, val = l.partition("=")
                v[k.strip()] = val.strip().strip('"').strip("'")
    return v


E = cargar_env(ENV)
SB = E["SUPABASE_URL"].rstrip("/")
SR = E["SUPABASE_SERVICE_ROLE"]
TOK = E.get("CAPI_TOKEN", "")
VER = E.get("WA_API_VERSION", "v23.0")


def pedir(url, cab):
    req = urllib.request.Request(url)
    for k, v in cab.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as ex:
        try:
            return json.loads(ex.read().decode("utf-8") or "null")
        except Exception:
            return None


def sb(ruta):
    return pedir(SB + ruta, {"apikey": SR, "Authorization": "Bearer " + SR})


def nombre_anuncio(ad_id, cache):
    """Resuelve ad_id -> nombre del anuncio y de la campaña.

    Es una consulta VIVA a Meta: si un anuncio se borra, el nombre desaparece
    y solo queda el id. Por eso el id va SIEMPRE en su columna: es el dato,
    el nombre es un adorno que puede faltar."""
    if ad_id in cache:
        return cache[ad_id]
    r = {}
    if TOK:
        q = urllib.parse.urlencode({
            "fields": "id,name,adset{name},campaign{name},effective_status",
            "access_token": TOK})
        d = pedir("https://graph.facebook.com/%s/%s?%s" % (VER, ad_id, q), {}) or {}
        if "error" not in d:
            r = {"anuncio": d.get("name", ""),
                 "conjunto": (d.get("adset") or {}).get("name", ""),
                 "campana": (d.get("campaign") or {}).get("name", ""),
                 "estado_anuncio": d.get("effective_status", "")}
    cache[ad_id] = r
    return r


def main():
    desde = "2026-01-01"
    if "--desde" in sys.argv:
        desde = sys.argv[sys.argv.index("--desde") + 1]
    sin_nombres = "--sin-nombres" in sys.argv

    # fbtrace / events_received de la recuperación
    extra = dict(DE_EJECUCIONES)
    if os.path.exists(BITACORA):
        for l in open(BITACORA, encoding="utf-8"):
            r = json.loads(l)
            if r.get("resultado") != "aceptada":
                continue
            for lid in r["lineas"]:
                extra[lid] = {"fbtrace_id": r.get("fbtrace_id"),
                              "events_received": r.get("events_received"),
                              "origen": "recuperacion %s" % r["cuando"][:10]}

    campos = ("id,conversacion_id,producto,precio,cantidad,validado_en,validado_por,"
              "capi_enviado_en,capi_intentos,"
              "conversaciones(cliente_id,nombre,ad_id,ctwa_clid,canal_id,"
              "canales(nombre,waba_id,dataset_id))")
    filas = sb("/rest/v1/conversacion_productos?capi_enviado_en=not.is.null"
               "&capi_error=is.null&validado_en=gte.%s&select=%s&order=validado_en"
               % (desde, campos)) or []

    # El event_id usa el MENOR id de las líneas tomadas juntas en esa
    # conversación, igual que el flujo. Con una línea por conversación
    # coincide con su propio id, pero se calcula bien por si algún día no.
    minimo = {}
    for f in filas:
        c = f["conversacion_id"]
        minimo[c] = min(minimo.get(c, f["id"]), f["id"])

    cache = {}
    out = []
    for f in filas:
        cv = f["conversaciones"] or {}
        ca = cv.get("canales") or {}
        ad = cv.get("ad_id") or ""
        n = {} if (sin_nombres or not ad) else nombre_anuncio(ad, cache)
        x = extra.get(f["id"], {})
        imp = (float(f["precio"]) * int(f["cantidad"] or 1)) if f["precio"] is not None else None
        out.append({
            "validado_en": f["validado_en"][:19].replace("T", " "),
            "enviado_a_meta": (f["capi_enviado_en"] or "")[:19].replace("T", " "),
            "event_id": "pedido-%s-%s" % (f["conversacion_id"], minimo[f["conversacion_id"]]),
            "ad_id": ad,
            "anuncio": n.get("anuncio", ""),
            "campana": n.get("campana", ""),
            "producto": f["producto"],
            "cantidad": f["cantidad"],
            "importe_mxn": ("%.2f" % imp) if imp is not None else "",
            "canal": ca.get("nombre", ""),
            "dataset_id": ca.get("dataset_id", ""),
            "ctwa_clid": cv.get("ctwa_clid", ""),
            "fbtrace_id": x.get("fbtrace_id", "") or "",
            "events_received": x.get("events_received", "") if x.get("events_received") is not None else "",
            "origen": x.get("origen", "flujo (sin registro guardado)"),
            "cliente_id": cv.get("cliente_id", ""),
            "linea_id": f["id"],
            "conversacion_id": f["conversacion_id"],
        })

    cols = list(out[0].keys()) if out else []
    # BOM para que Excel/Sheets no destrocen las tildes al abrirlo.
    with open(SALIDA, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(out)

    tot = sum(float(r["importe_mxn"]) for r in out if r["importe_mxn"])
    print("filas: %d  ->  %s" % (len(out), SALIDA))
    print("importe: %.2f MXN" % tot)
    print("con fbtrace_id: %d  |  sin: %d"
          % (len([r for r in out if r["fbtrace_id"]]),
             len([r for r in out if not r["fbtrace_id"]])))
    if out:
        print("rango validado_en: %s  ->  %s" % (out[0]["validado_en"], out[-1]["validado_en"]))
    from collections import Counter
    print("por campana:")
    for k, v in Counter(r["campana"] or "(sin nombre)" for r in out).most_common():
        print("  %-52s %2d" % (k[:52], v))


if __name__ == "__main__":
    main()
