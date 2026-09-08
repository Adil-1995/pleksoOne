-- =====================================================================
--  LumaBot — Marca de ESCALADO en la conversación
--  Pegar entero en el SQL Editor de Supabase y pulsar Run.
--  Es idempotente: se puede volver a ejecutar sin romper nada.
-- =====================================================================
--
--  EL PROBLEMA QUE RESUELVE
--    Desde el commit "Si hay marcador de escalado, se calla. Punto", cuando
--    María emite [ESCALAR: ...] al cliente NO le llega nada. Eso es lo que
--    se quería, pero deja un agujero: el escalado solo se anuncia por
--    Telegram y por la pestaña Incidencias del Sheet. Si nadie mira el
--    Telegram, esa conversación se queda muerta y no hay forma de verlo
--    desde el inbox. Es dinero perdido, y perdido en silencio.
--
--  POR QUÉ UNA COLUMNA Y NO UNA ETIQUETA
--    04-esquema-favoritos-etiquetas.sql lo deja escrito: las etiquetas son
--    para lo que pone una PERSONA y no cabe en ningún otro sitio. Esto lo
--    escribe el flujo, es determinista y tiene un dueño único (regla 5).
--    Metido como etiqueta habría que fijar un id a fuego en el frontend y
--    en n8n, y cualquiera podría borrarla desde Ajustes sin enterarse de
--    que estaba apagando una alarma.
--
--  QUÉ NO HACE, A PROPÓSITO
--    NO pausa a María. La pausa automática va en su propia tanda: cambia
--    el comportamiento con clientes reales y esto solo pinta.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. COLUMNAS
--
--    Cuatro columnas y no un booleano `escalada`, por dos motivos:
--
--    a) HAY QUE PODER CERRARLA. Un aviso que no se apaga deja de ser un
--       aviso en dos días: el número solo sube y se aprende a ignorarlo.
--    b) UN BOOLEANO NO SABE REABRIR. Con `escalada = false` al resolver,
--       un cliente que vuelve a escalar necesitaría que alguien acordara
--       ponerlo a true otra vez. Con dos marcas de tiempo, la comparación
--       lo resuelve sola: si el escalado nuevo es POSTERIOR a la última
--       vez que se miró, vuelve a estar abierto sin que nadie haga nada.
-- ---------------------------------------------------------------------
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS escalada_en        TIMESTAMPTZ;
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS escalada_motivo    TEXT;
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS escalada_vista_en  TIMESTAMPTZ;
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS escalada_vista_por UUID;

COMMENT ON COLUMN conversaciones.escalada_en IS
  'Cuándo escaló María por última vez. Lo escribe el receptor de n8n con la service_role, nunca el navegador.';
COMMENT ON COLUMN conversaciones.escalada_motivo IS
  'Lo que María puso dentro de [ESCALAR: ...]. Es una PISTA escrita por el modelo, no un dato: sirve para el aviso, no para filtrar ni agrupar.';
COMMENT ON COLUMN conversaciones.escalada_vista_en IS
  'Cuándo lo dio por resuelto una persona. Abierto = escalada_en > escalada_vista_en, o vista_en NULL.';
COMMENT ON COLUMN conversaciones.escalada_vista_por IS
  'Quién lo resolvió. Sale de auth.uid() por trigger, nunca de lo que mande el navegador.';


-- ---------------------------------------------------------------------
-- 2. ÍNDICE
--
--    PARCIAL, igual que favorita/silenciada/bloqueada: la inmensa mayoría
--    de las filas nunca escalan y no hay por qué indexarlas.
--
--    El predicado lleva dentro la comparación de las dos fechas, o sea la
--    definición completa de "abierto". Así el índice sirve para la consulta
--    que de verdad se hace —el contador de la barra— y no solo para
--    "escaló alguna vez".
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_conv_escalada
  ON conversaciones (ultimo_en DESC)
  WHERE escalada_en IS NOT NULL
    AND (escalada_vista_en IS NULL OR escalada_vista_en < escalada_en);


-- ---------------------------------------------------------------------
-- 3. QUIÉN LO RESOLVIÓ: trigger, no el navegador
--
--    Mismo criterio que `marcas_revision.marcado_por` (11-marca-revision):
--    si el UUID lo mandara el cliente, cualquiera podría decir que lo
--    resolvió otro. Sale de auth.uid() y punto.
--
--    Solo se dispara cuando cambia `escalada_vista_en` A UN VALOR NO NULO.
--    n8n escribe `escalada_en` con la service_role, donde auth.uid() es
--    NULL: sin esta condición, cada escalado nuevo borraría de paso quién
--    resolvió el anterior.
--
--    La fecha también la pone el servidor. Un móvil con la hora mal puesta
--    podría marcar como visto un escalado del futuro y esconderlo para
--    siempre.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tocar_escalado()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.escalada_vista_en IS NOT NULL
     AND NEW.escalada_vista_en IS DISTINCT FROM OLD.escalada_vista_en THEN
    NEW.escalada_vista_por = auth.uid();
    NEW.escalada_vista_en  = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tocar_escalado ON conversaciones;
CREATE TRIGGER trg_tocar_escalado
  BEFORE UPDATE ON conversaciones
  FOR EACH ROW EXECUTE FUNCTION tocar_escalado();


-- ---------------------------------------------------------------------
-- 4. RLS
--    Nada que hacer, y conviene dejarlo dicho para que nadie lo busque:
--    `equipo_edita_conv` (01-esquema-inbox.sql) ya da UPDATE sobre la
--    tabla entera a `authenticated`, así que las columnas nuevas entran
--    solas. La service_role de n8n se salta RLS.
--
--    Realtime tampoco: `conversaciones` ya está en la publicación, y la
--    publicación es por TABLA, no por columna.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- COMPROBACIÓN
-- ---------------------------------------------------------------------
SELECT 'columnas nuevas' AS que,
       string_agg(column_name, ', ' ORDER BY column_name) AS detalle
FROM information_schema.columns
WHERE table_name = 'conversaciones'
  AND column_name IN ('escalada_en','escalada_motivo','escalada_vista_en','escalada_vista_por')

UNION ALL
SELECT 'indice', string_agg(indexname, ', ')
FROM pg_indexes WHERE tablename = 'conversaciones' AND indexname = 'idx_conv_escalada'

UNION ALL
SELECT 'trigger', string_agg(tgname, ', ')
FROM pg_trigger WHERE tgrelid = 'conversaciones'::regclass AND NOT tgisinternal

UNION ALL
SELECT 'escaladas abiertas ahora', count(*)::text
FROM conversaciones
WHERE escalada_en IS NOT NULL
  AND (escalada_vista_en IS NULL OR escalada_vista_en < escalada_en);
