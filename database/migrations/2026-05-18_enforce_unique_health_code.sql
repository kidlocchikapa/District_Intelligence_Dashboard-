BEGIN;

UPDATE health_facilities
SET code = UPPER(BTRIM(code))
WHERE code IS NOT NULL;

UPDATE health_facilities
SET code = NULL
WHERE code = '';

DROP INDEX IF EXISTS uq_health_facilities_code;
CREATE INDEX IF NOT EXISTS idx_health_facilities_code
ON health_facilities(code)
WHERE code IS NOT NULL;

COMMIT;
