BEGIN;

UPDATE health_facilities
SET code = UPPER(BTRIM(code))
WHERE code IS NOT NULL;

UPDATE health_facilities
SET code = NULL
WHERE code = '';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM health_facilities
        WHERE code IS NOT NULL
        GROUP BY code
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Cannot enforce unique health facility codes: duplicate normalized codes already exist in health_facilities';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_health_facilities_code
ON health_facilities(code)
WHERE code IS NOT NULL;

COMMIT;
