-- =====================================================================
--  LumaBot — Pausar María por canal
--  Pegar entero en el SQL Editor de Supabase y pulsar Run. Idempotente.
-- =====================================================================
--
--  `bot_activo` NO es lo mismo que `activo`, y mezclarlos sería el error:
--
--    activo = false      El canal está retirado. No se envía NADA por él,
--                        ni María ni tú. Sus conversaciones se siguen
--                        viendo, pero el número está fuera de servicio.
--
--    bot_activo = false  El canal funciona perfectamente y TÚ puedes
--                        escribir. Lo único que pasa es que María se calla
--                        con todos los clientes de ese número.
--
--  Son dos preguntas distintas —"¿este número sirve?" y "¿quién atiende
--  aquí?"— y por eso son dos columnas. Con una sola, apagar el bot un rato
--  te dejaría además sin poder escribir tú.
-- =====================================================================


ALTER TABLE canales ADD COLUMN IF NOT EXISTS bot_activo BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE canales ADD COLUMN IF NOT EXISTS pausado_por UUID
  REFERENCES auth.users (id) ON DELETE SET NULL;
ALTER TABLE canales ADD COLUMN IF NOT EXISTS pausado_en TIMESTAMPTZ;

COMMENT ON COLUMN canales.bot_activo IS
  'Interruptor maestro de María para este número. false = se calla con TODOS sus clientes; los mensajes siguen entrando y guardándose, y tú puedes escribir. Distinto de `activo`, que retira el canal entero.';
COMMENT ON COLUMN canales.pausado_por IS
  'Quién movió el interruptor la última vez. NULL = nadie lo ha tocado nunca.';


-- ---------------------------------------------------------------------
-- EL TRIGGER
--
--    `pausado_por` sale de auth.uid(), no del navegador: si lo mandara el
--    cliente, cualquiera podría decir que la pausa la puso otro.
--
--    Solo se reescribe cuando el interruptor CAMBIA de verdad. Editar el
--    nombre del canal no puede borrar quién lo pausó ni cuándo, que es
--    justo el dato que hace falta cuando alguien pregunta "¿desde cuándo
--    lleva este número sin contestar?".
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tocar_pausa_canal()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.bot_activo IS DISTINCT FROM OLD.bot_activo THEN
    NEW.pausado_por = auth.uid();
    NEW.pausado_en  = NOW();
  ELSE
    NEW.pausado_por = OLD.pausado_por;
    NEW.pausado_en  = OLD.pausado_en;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pausa_canal ON canales;
CREATE TRIGGER trg_pausa_canal
  BEFORE INSERT OR UPDATE ON canales
  FOR EACH ROW EXECUTE FUNCTION tocar_pausa_canal();


-- ---------------------------------------------------------------------
-- COMPROBACIÓN
-- ---------------------------------------------------------------------
SELECT id, nombre,
       activo      AS "canal en servicio",
       bot_activo  AS "María responde",
       pausado_en  AS "último cambio del interruptor"
FROM canales ORDER BY orden, id;
