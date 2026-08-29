-- G1 protected-column format counts.
-- Only prefix/shape classification and row counts. Never SELECT, log, or return
-- column values. Run as a privileged migrator role (bypasses RLS) so the
-- baseline is a full-table count, not the current owner slice.
--
-- Classes:
--   enc2_wellformed  enc2:<keyId>:<positiveVersion>:<standard-padded-base64>
--   enc2_malformed   starts with enc2: but is not the well-formed write shape
--   enc1             starts with enc1:
--   unrecognized     starts with enc but is neither enc1: nor enc2:
--   unprefixed       non-null and not an enc* prefix (legacy plaintext, or
--                    emergency_contact's current unprefixed AES-GCM envelope)
--   null_value       NULL (export payload may be null before seal)

WITH classified AS (
    SELECT 'vc.message'::text AS table_name,
           'content'::text AS column_name,
           'rest_field_cipher_enc2'::text AS expected_current_write,
           CASE
               WHEN content IS NULL THEN 'null_value'
               WHEN content ~ '^enc2:[a-z][a-z0-9-]{0,31}:[1-9][0-9]*:[A-Za-z0-9+/]+={0,2}$'
                   THEN 'enc2_wellformed'
               WHEN content LIKE 'enc2:%' THEN 'enc2_malformed'
               WHEN content LIKE 'enc1:%' THEN 'enc1'
               WHEN content LIKE 'enc%' THEN 'unrecognized'
               ELSE 'unprefixed'
           END AS format_class
    FROM vc.message
    UNION ALL
    SELECT 'vc.conversation_summary', 'summary', 'rest_field_cipher_enc2',
           CASE
               WHEN summary IS NULL THEN 'null_value'
               WHEN summary ~ '^enc2:[a-z][a-z0-9-]{0,31}:[1-9][0-9]*:[A-Za-z0-9+/]+={0,2}$'
                   THEN 'enc2_wellformed'
               WHEN summary LIKE 'enc2:%' THEN 'enc2_malformed'
               WHEN summary LIKE 'enc1:%' THEN 'enc1'
               WHEN summary LIKE 'enc%' THEN 'unrecognized'
               ELSE 'unprefixed'
           END
    FROM vc.conversation_summary
    UNION ALL
    SELECT 'vc.memory_item', 'summary', 'rest_field_cipher_enc2',
           CASE
               WHEN summary IS NULL THEN 'null_value'
               WHEN summary ~ '^enc2:[a-z][a-z0-9-]{0,31}:[1-9][0-9]*:[A-Za-z0-9+/]+={0,2}$'
                   THEN 'enc2_wellformed'
               WHEN summary LIKE 'enc2:%' THEN 'enc2_malformed'
               WHEN summary LIKE 'enc1:%' THEN 'enc1'
               WHEN summary LIKE 'enc%' THEN 'unrecognized'
               ELSE 'unprefixed'
           END
    FROM vc.memory_item
    UNION ALL
    SELECT 'vc.generation_candidate', 'content', 'rest_field_cipher_enc2',
           CASE
               WHEN content IS NULL THEN 'null_value'
               WHEN content ~ '^enc2:[a-z][a-z0-9-]{0,31}:[1-9][0-9]*:[A-Za-z0-9+/]+={0,2}$'
                   THEN 'enc2_wellformed'
               WHEN content LIKE 'enc2:%' THEN 'enc2_malformed'
               WHEN content LIKE 'enc1:%' THEN 'enc1'
               WHEN content LIKE 'enc%' THEN 'unrecognized'
               ELSE 'unprefixed'
           END
    FROM vc.generation_candidate
    UNION ALL
    SELECT 'vc.export_request', 'payload', 'rest_field_cipher_enc2',
           CASE
               WHEN payload IS NULL THEN 'null_value'
               WHEN payload ~ '^enc2:[a-z][a-z0-9-]{0,31}:[1-9][0-9]*:[A-Za-z0-9+/]+={0,2}$'
                   THEN 'enc2_wellformed'
               WHEN payload LIKE 'enc2:%' THEN 'enc2_malformed'
               WHEN payload LIKE 'enc1:%' THEN 'enc1'
               WHEN payload LIKE 'enc%' THEN 'unrecognized'
               ELSE 'unprefixed'
           END
    FROM vc.export_request
    UNION ALL
    SELECT 'vc.emergency_contact', 'contact_cipher', 'unprefixed_aes_gcm_envelope',
           CASE
               WHEN contact_cipher IS NULL THEN 'null_value'
               WHEN contact_cipher ~ '^enc2:[a-z][a-z0-9-]{0,31}:[1-9][0-9]*:[A-Za-z0-9+/]+={0,2}$'
                   THEN 'enc2_wellformed'
               WHEN contact_cipher LIKE 'enc2:%' THEN 'enc2_malformed'
               WHEN contact_cipher LIKE 'enc1:%' THEN 'enc1'
               WHEN contact_cipher LIKE 'enc%' THEN 'unrecognized'
               ELSE 'unprefixed'
           END
    FROM vc.emergency_contact
),
rolled AS (
    SELECT table_name,
           column_name,
           expected_current_write,
           count(*) FILTER (WHERE format_class = 'enc2_wellformed') AS enc2_wellformed,
           count(*) FILTER (WHERE format_class = 'enc2_malformed') AS enc2_malformed,
           count(*) FILTER (WHERE format_class = 'enc1') AS enc1,
           count(*) FILTER (WHERE format_class = 'unprefixed') AS unprefixed,
           count(*) FILTER (WHERE format_class = 'unrecognized') AS unrecognized,
           count(*) FILTER (WHERE format_class = 'null_value') AS null_value,
           count(*) AS row_count
    FROM classified
    GROUP BY table_name, column_name, expected_current_write
)
SELECT COALESCE(json_agg(to_jsonb(rolled) ORDER BY table_name, column_name), '[]'::json)
FROM rolled;
