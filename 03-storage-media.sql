-- =====================================================================
--  LumaBot — Acceso del inbox al bucket media-whatsapp
--  Pegar en el SQL Editor de Supabase y pulsar Run. Idempotente.
-- =====================================================================
--
--  EL PROBLEMA QUE RESUELVE
--  El bucket `media-whatsapp` es PRIVADO a propósito: son audios y fotos
--  de clientes reales y no deben quedar accesibles por URL a cualquiera.
--
--  Pero sin una policy de SELECT, el navegador (anon key + sesión) no puede
--  ni siquiera firmar una URL: Supabase responde
--      {"error":"not_found","message":"Object not found"}
--  aunque el fichero exista. RLS no da un 403, oculta la fila. Comprobado:
--  con service_role la misma firma funciona y descarga los 8608 bytes.
-- =====================================================================

DROP POLICY IF EXISTS wa_media_lee_equipo   ON storage.objects;
DROP POLICY IF EXISTS wa_media_sube_equipo  ON storage.objects;

-- Leer: cualquier miembro del equipo autenticado. NO hay acceso anónimo:
-- sin sesión iniciada no se ve nada, ni siquiera con la URL.
CREATE POLICY wa_media_lee_equipo ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'media-whatsapp');

-- Subir: para lo que el inbox envía. Lo entrante lo sube n8n con la
-- service_role, que se salta RLS y no necesita esta policy.
CREATE POLICY wa_media_sube_equipo ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media-whatsapp');


-- ---------------------------------------------------------------------
-- COMPROBACIÓN
-- ---------------------------------------------------------------------
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname LIKE 'wa_media%'
ORDER BY policyname;

-- Después de ejecutarlo, en el inbox el audio del mensaje 72 tiene que
-- reproducirse. Si sigue sin verse, el problema ya no es de permisos.
