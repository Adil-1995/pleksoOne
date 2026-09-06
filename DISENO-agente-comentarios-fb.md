# Agente de comentarios de Facebook

Responde comentarios en los **anuncios** de Facebook. Independiente del agente
de WhatsApp: workflows nuevos, app nueva, token propio. **Sin ninguna tabla en
Supabase**: el estado lo guarda Facebook y el mapeo vive en el Google Sheet.

**Estado: MONTADO Y DESPLEGADO, con producción APAGADA.**
Todo comprobado contra la API real el 6/9/2026.

---

## Qué hay creado

| Workflow | ID | Estado | Qué hace |
|---|---|---|---|
| `Comentarios FB — Salida` | `Q0SbyLxmPVTkhxR7` | **activo** | Subflujo. Único sitio que publica |
| `Comentarios FB — Ensayo` | `0itXzj97deBmKy5E` | **activo** | Ciclo en seco. **No tiene ningún nodo que publique** |
| `Comentarios FB — PROD` | `9qad3FmOkinhJdDM` | **INACTIVO** | El de verdad, cron 10 min |

App `Comments Responder` (`1058512673559996`), credencial n8n
`FB Comments Responder` (`YgujJZ0vLNoXfBrz`), token en `/opt/bot/fb.env` (600).

Nada de esto toca los cuatro workflows de WhatsApp. Comprobado en
`webhook_entity` al terminar: `wa-cloud-multi` (GET+POST), `inbox-enviar` y
`capi-purchase` intactos; solo se ha añadido `fb-ensayo`.

---

## Por qué no hay tablas

| Lo que haría falta guardar | Dónde vive en su lugar |
|---|---|
| ¿Ya contesté a este comentario? | **Facebook**: la respuesta es un comentario hijo con `from.id` = la página |
| ¿Cuántas llevo en la última hora? | **Facebook**: se cuentan esas mismas respuestas por `created_time` |
| Fecha de corte | **No hace falta**: ventana rodante de 48 h |
| Marca de agua del sondeo | **No hace falta**: la idempotencia la da Facebook |
| `ad_id → producto` | **Sheet**, pestaña `FB_Anuncios` |
| Qué páginas están encendidas | **Sheet**, pestaña `FB_Paginas` |
| Auditoría de lo publicado | **Sheet**, pestaña `FB_Log` |

Medido: **`from` viene vacío en los comentarios de personas y con valor cuando
comenta una Página.** De 100 comentarios reales, 44 eran de «Lado Luminoso»
(nuestras propias respuestas manuales) y se identifican al 100 %. La ausencia
de identidad, que es un incordio para todo lo demás, es lo que hace que la
idempotencia no necesite tabla — y de paso es el detector de spam más fiable
que hay (el spam en chino venía de una Página).

**Lo que se pierde:** no se cumple la regla 1 («todo mensaje se guarda antes de
decidir»). No hay registro local de lo que se vio y se descartó. Lo tapa la
pestaña `FB_Log`, pero no es lo mismo: si un día hace falta auditar de verdad,
esto es lo primero que habría que revisar.

---

## El flujo

```
CRON 10 min
  → Leer FB_Paginas          solo las marcadas SI
  → Leer FB_Anuncios         solo activo=SI y de una página encendida
  → Ciclo                    valida producto_id, wa_destino, story_id
  → Token de página          uno por página, acuñado al vuelo
  → Anuncios con token       DEDUPE por story_id  ← varios anuncios, un post
  → Leer comentarios         filter=toplevel, limit=100
  → Juntar comentarios       casa por el ID, NUNCA por el índice
  → Leer Catálogo            Sheet Productos
  → Filtro de entrada        determinista + límite por anuncio
  → ¿Hay algo?  ─sí→ Clasificar (modelo)  → Decidir y filtrar
                └no→──────────────────────────────┐
  → ¿Publica?   ─sí→ Esperar 3-10 min → SUBFLUJO SALIDA ─┤
                └no→─────────────────────────────────────┤
  → Avisar (Telegram) → Fin
```

### Dos fallos que el ciclo en seco destapó, y que habrían sido caros

**1. Varios anuncios comparten el MISMO post oscuro.** Medido: 12 anuncios
daban solo **10 posts distintos**. Tres copias del mismo creativo apuntaban al
mismo `effective_object_story_id`. Sin deduplicar, al mismo comentario se le
contestaba dos y tres veces.

**2. n8n NO devuelve las respuestas HTTP en el orden de entrada.** Casábamos
`respuesta[i]` con `anuncio[i]` y un anuncio recibió los comentarios del post
de otro, con la ejecución en verde y sin un solo error. En producción eso es
**mandarle a un cliente el enlace de un producto que no ha preguntado**.
Ahora se casa por el prefijo del `comment_id` —que es el sufijo del post— y si
algo no cuadra, **se para**.

Los dos son de la familia «ejecución en verde, corte mudo». Ninguno se habría
visto sin el ensayo.

---

## Lo que el agente puede y no puede decir

**Nunca el precio.** Ni con símbolo, ni el número suelto, ni la palabra. Aunque
el equipo lo dé a mano en los comentarios (comprobado: 44 respuestas manuales,
varias con «está en oferta a $995»), el agente no.

**Plantillas fijas.** El modelo **solo clasifica**; no escribe ni una palabra de
lo que se publica. El filtro de salida **re-renderiza la plantilla desde cero y
exige que el texto sea idéntico**: si alguien mete texto libre por cualquier
vía, muere ahí.

| Clase | Qué hace |
|---|---|
| `precio` | Plantilla + enlace `wa.me`. Sin precio |
| `duda_producto` | **Solo Telegram al principio.** Es el único caso donde afirmaría algo |
| `queja` | **Solo Telegram.** Nunca se discute en público |
| `otro` | Nada |

El enlace `wa.me` lleva un mensaje prefijado con una **`palabra_clave` del
producto**, o la ficha no se dispara al llegar a WhatsApp: como esto no es un
click-to-WhatsApp, no hay `referral` y la ficha depende al 100 % de ese texto.
`palabras_clave` viaja **solo por el flujo**, nunca al prompt.

Cuando a `duda_producto` se le suelte la correa, el modelo elegirá **qué campo**
de una lista cerrada (`medidas`, `colores`, `garantia`, `vida_util`, `entrega`)
y **el flujo pondrá el valor** del catálogo. Nunca puede inventarse una
garantía porque nunca escribe el valor.

### El catálogo que ve
Lista negra **propia**, y el bloque de precio **borrado entero**, no filtrado.
La del receptor de WhatsApp tiene `precio` en el `Set` solo porque lo imprime
aparte tres líneas después (`catalogo += 'Precio: $' + p.precio`): reutilizarla
habría metido el precio en el prompt de un agente que habla en público.

---

## Frenos

| Freno | Valor |
|---|---|
| Ventana | 48 h. Nada más viejo se toca |
| Por anuncio y hora | 5 |
| Por anuncio y día | 20 |
| Retraso antes de publicar | aleatorio 3–10 min |
| Longitud máxima | 400 caracteres |

Al pasarse el límite el comentario se **aplaza**, no se descarta: descartarlo
perdería justo los del anuncio que funciona. La distribución medida es 124,
124, 109, 109, 76… y **cero en cinco anuncios**, así que un límite global no
serviría de nada.

---

## Ficheros

```
fb/logica-comentarios.js    la lógica. FUENTE ÚNICA
fb/pruebas-logica.mjs       53 comprobaciones. node fb/pruebas-logica.mjs
fb/proponer-mapeo.js        siembra el Sheet la primera vez
fb/FB_Anuncios.tsv          198 filas para pegar
fb/FB_Paginas.tsv           5 filas para pegar
fb/ensayo-resultado.csv     el ciclo en seco
construir-comentarios-fb.js emite los 3 workflows
workflows/comentarios-fb-*.json
```

La lógica **no se escribe en los nodos**: se lee de `fb/logica-comentarios.js`
y se incrusta al construir. Si el ensayo y producción se escribieran dos veces,
el CSV que apruebas no probaría nada sobre lo que el agente hará después.

---

## Para encenderlo

1. Rellenar `wa_destino` en `FB_Anuncios` y revisar los `producto_id` vacíos.
2. Poner `activo = SI` en los anuncios que quieras.
3. Poner `activo = SI` en **una** página de `FB_Paginas` (empieza por Plekso).
4. Activar `Comentarios FB — PROD` — el subflujo de salida ya está activo.

Marcha atrás: `activo = no` en la página, o desactivar el workflow. Los
comentarios ya publicados se borran a mano; su `comment_id` y su texto exacto
están en `FB_Log`.
