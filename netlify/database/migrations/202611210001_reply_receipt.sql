-- Commit a chat revision after a signed delivery receipt, never store message text.
CREATE OR REPLACE FUNCTION maumzip_gate(op text, keys text[], args text[]) RETURNS integer
LANGUAGE plpgsql VOLATILE SET lock_timeout = '3s' AS $$
DECLARE
  vals text[];
  i integer;
  expected_keys integer;
  expected_args integer;
BEGIN
  CASE op
    WHEN 'admit' THEN expected_keys := 6; expected_args := 5;
    WHEN 'extra' THEN expected_keys := 2; expected_args := 2;
    WHEN 'finish' THEN expected_keys := 2; expected_args := 2;
    WHEN 'survey_admit' THEN expected_keys := 6; expected_args := 2;
    WHEN 'survey_finish' THEN expected_keys := 2; expected_args := 2;
    WHEN 'stage_reply' THEN expected_keys := 3; expected_args := 2;
    WHEN 'ack_reply' THEN expected_keys := 3; expected_args := 2;
    ELSE RAISE EXCEPTION 'Unknown gate operation';
  END CASE;
  IF cardinality(keys) <> expected_keys OR cardinality(args) <> expected_args THEN
    RAISE EXCEPTION 'Invalid gate parameters';
  END IF;
  PERFORM id FROM maumzip_gate_mutex WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gate mutex missing'; END IF;
  DELETE FROM maumzip_gate_values WHERE expires_at <= clock_timestamp();
  SELECT array_agg(v.value ORDER BY k.position) INTO vals
  FROM unnest(keys) WITH ORDINALITY AS k(key, position)
  LEFT JOIN maumzip_gate_values v ON v.key = k.key;

  CASE op
    WHEN 'admit' THEN
      IF vals[1] IS NOT NULL THEN RETURN 2; END IF;
      IF vals[2] IS NOT NULL THEN RETURN 3; END IF;
      IF coalesce(vals[6], '0')::integer <> args[4]::integer THEN RETURN 4; END IF;
      FOR i IN 3..5 LOOP
        IF coalesce(vals[i], '0')::integer >= args[i-2]::integer THEN RETURN 1; END IF;
      END LOOP;
      PERFORM maumzip_gate_put(keys[1], args[5], 86400);
      PERFORM maumzip_gate_put(keys[2], args[5], 180);
      FOR i IN 3..5 LOOP
        PERFORM maumzip_gate_put(keys[i], (coalesce(vals[i], '0')::integer + 1)::text,
          CASE WHEN i = 3 THEN 65 ELSE 90000 END);
      END LOOP;
    WHEN 'extra' THEN
      IF vals[1] IS DISTINCT FROM args[1] THEN RETURN 3; END IF;
      IF coalesce(vals[2], '0')::integer >= args[2]::integer THEN RETURN 1; END IF;
      PERFORM maumzip_gate_put(keys[2], (coalesce(vals[2], '0')::integer + 1)::text, 90000);
    WHEN 'finish' THEN
      IF vals[1] IS DISTINCT FROM args[1] THEN RETURN 3; END IF;
      IF args[2] <> '' THEN PERFORM maumzip_gate_put(keys[2], args[2], 86400); END IF;
      DELETE FROM maumzip_gate_values WHERE key = keys[1];
    WHEN 'stage_reply' THEN
      IF vals[1] IS DISTINCT FROM args[1] THEN RETURN 3; END IF;
      IF coalesce(vals[2], '0')::integer <> args[2]::integer - 1 THEN RETURN 4; END IF;
      PERFORM maumzip_gate_put(keys[3], args[2], 7200);
      DELETE FROM maumzip_gate_values WHERE key = keys[1];
    WHEN 'ack_reply' THEN
      IF coalesce(vals[2], '0')::integer = args[2]::integer AND vals[3] = args[1] THEN RETURN 0; END IF;
      IF vals[1] IS DISTINCT FROM args[2] OR coalesce(vals[2], '0')::integer <> args[2]::integer - 1 THEN RETURN 4; END IF;
      PERFORM maumzip_gate_put(keys[2], args[2], 86400);
      PERFORM maumzip_gate_put(keys[3], args[1], 7200);
      DELETE FROM maumzip_gate_values WHERE key = keys[1];
    WHEN 'survey_admit' THEN
      IF vals[3] IS NOT NULL THEN
        IF vals[1] = args[1] THEN RETURN 2; ELSE RETURN 3; END IF;
      END IF;
      IF vals[1] IS NOT NULL AND vals[1] <> args[1] THEN RETURN 4; END IF;
      IF vals[2] IS NOT NULL THEN RETURN 5; END IF;
      IF coalesce(vals[6], '0')::integer >= 1 THEN RETURN 6; END IF;
      IF vals[1] IS NULL THEN
        IF coalesce(vals[4], '0')::integer >= 3 OR
          coalesce(vals[5], '0')::integer >= args[2]::integer THEN RETURN 1; END IF;
        PERFORM maumzip_gate_put(keys[1], args[1], 7200);
        FOR i IN 4..5 LOOP
          PERFORM maumzip_gate_put(keys[i], (coalesce(vals[i], '0')::integer + 1)::text, 90000);
        END LOOP;
      END IF;
      PERFORM maumzip_gate_put(keys[6], (coalesce(vals[6], '0')::integer + 1)::text, 7200);
      PERFORM maumzip_gate_put(keys[2], args[1], 30);
    WHEN 'survey_finish' THEN
      IF vals[1] IS DISTINCT FROM args[1] THEN RETURN 5; END IF;
      IF args[2] = 'done' THEN PERFORM maumzip_gate_put(keys[2], '1', 7200); END IF;
      DELETE FROM maumzip_gate_values WHERE key = keys[1];
  END CASE;
  RETURN 0;
END;
$$;
