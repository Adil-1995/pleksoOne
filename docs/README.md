# Manual del sistema

`manual.html` — ábrelo en el navegador. Los diagramas son Mermaid en texto
dentro del propio HTML, no imágenes: se editan como código.

## Cómo está montado

Se genera. **No lo edites a mano**, se sobrescribe.

| Fichero | Qué es | ¿Se edita? |
|---|---|---|
| `manual.html` | El manual | ❌ generado |
| `manual/narrativa.mjs` | Las explicaciones | ✅ **este y solo este** |
| `manual/generar.mjs` | El generador | ✅ si cambia el formato |
| `manual/instantanea.json` | Volcado saneado de los 4 workflows vivos | ❌ generado |
| `manual/inventario.json` | id/nombre/estado de los 51 workflows | ❌ generado |

## Regenerarlo

```bash
# baja los workflows de n8n y reescribe el manual
N8N_API_KEY=… node docs/manual/generar.mjs --fetch

# solo comprueba si se ha quedado viejo; no escribe nada, sale != 0 si hay deriva
node docs/manual/generar.mjs --check
```

La clave sale de `/opt/bot/wa.env` o de la tabla `user_api_keys` del servidor.
Tiene que tener `audience = public-api`; la del servidor MCP da 401.

## Por qué no se pudre

El CLAUDE.md mintió durante meses porque tenía IDs escritos a mano que nadie
actualizó. Aquí eso no puede pasar en silencio:

1. **Anclas.** Cada bloque de `narrativa.mjs` declara los nodos de los que
   habla. Si renombras un nodo, el generador falla y no escribe el HTML.
2. **Cobertura.** Cada nodo que se traga errores tiene que estar analizado en
   la tabla de riesgo. Si aparece uno nuevo, falla.
3. **Vivos.** Si un workflow declarado como vivo deja de estar activo, falla.
4. **Sello.** El HTML lleva fecha y número de nodos. Si es viejo, se ve.
5. **Diff.** `instantanea.json` está en el repo a propósito: `git diff` enseña
   qué cambió en producción entre dos regeneraciones.

El generador **aborta** si detecta algo con pinta de secreto, y quita
`credentials`, `activeVersion` y `pinData` antes de escribir nada.
