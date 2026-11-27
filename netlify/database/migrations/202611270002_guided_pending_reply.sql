CREATE OR REPLACE FUNCTION maumzip_guided_admit(keys text[], args text[]) RETURNS integer
LANGUAGE plpgsql VOLATILE SET lock_timeout = '3s' AS $$
DECLARE
  vals text[];
BEGIN
  IF cardinality(keys) NOT IN (6, 7) OR cardinality(args) <> 4 THEN
    RAISE EXCEPTION 'Invalid guided gate parameters';
  END IF;
  PERFORM id FROM maumzip_gate_mutex WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gate mutex missing'; END IF;
  DELETE FROM maumzip_gate_values WHERE expires_at <= clock_timestamp();
  SELECT array_agg(v.value ORDER BY k.position) INTO vals
  FROM unnest(keys) WITH ORDINALITY AS k(key, position)
  LEFT JOIN maumzip_gate_values v ON v.key = k.key;

  IF vals[1] IS NOT NULL THEN RETURN 2; END IF;
  IF vals[2] IS NOT NULL THEN RETURN 3; END IF;
  IF coalesce(vals[3], '0')::integer <> args[3]::integer THEN RETURN 4; END IF;
  IF vals[7] = (args[3]::integer + 1)::text THEN RETURN 3; END IF;
  IF vals[4] IS NULL AND args[3] = '0' THEN
    IF coalesce(vals[5], '0')::integer >= args[1]::integer OR
       coalesce(vals[6], '0')::integer >= args[2]::integer THEN RETURN 1; END IF;
    PERFORM maumzip_gate_put(keys[4], '1', 90000);
    PERFORM maumzip_gate_put(keys[5], (coalesce(vals[5], '0')::integer + 1)::text, 65);
    PERFORM maumzip_gate_put(keys[6], (coalesce(vals[6], '0')::integer + 1)::text, 90000);
  END IF;
  PERFORM maumzip_gate_put(keys[1], args[4], 86400);
  PERFORM maumzip_gate_put(keys[2], args[4], 180);
  RETURN 0;
END;
$$;

-- Hold the same revision briefly while a generated reply is on its way to the browser.
-- Once the browser acknowledges, the next revision can proceed immediately.
CREATE OR REPLACE FUNCTION maumzip_guided_stage(keys text[], args text[]) RETURNS integer
LANGUAGE plpgsql VOLATILE SET lock_timeout = '3s' AS $$
DECLARE
  result integer;
BEGIN
  IF cardinality(keys) <> 4 OR cardinality(args) <> 2 THEN
    RAISE EXCEPTION 'Invalid guided reply parameters';
  END IF;
  result := maumzip_gate('stage_reply', keys[1:3], args);
  IF result = 0 THEN
    PERFORM maumzip_gate_put(keys[4], args[2], 15);
  END IF;
  RETURN result;
END;
$$;
