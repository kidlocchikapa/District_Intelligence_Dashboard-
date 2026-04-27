BEGIN;

-- Keep a one-time backup of the legacy education table before reshaping.
CREATE TABLE IF NOT EXISTS education_facilities_backup_20260417
AS TABLE education_facilities WITH DATA;

-- Add the target columns from the new schema if they are missing.
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS school_name VARCHAR(225);
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS district VARCHAR(255);
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS operator VARCHAR(100);
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS student_classroom_ratio DOUBLE PRECISION;
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS special_needs_students INTEGER;
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS blocks_count INTEGER;
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS water_equipment_facility_count INTEGER;
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS toilets_count INTEGER;
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS classroom_pressure DOUBLE PRECISION;
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS teacher_pressure DOUBLE PRECISION;
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS x_coordinate DOUBLE PRECISION;
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS y_coordinate DOUBLE PRECISION;
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS ta_id INTEGER;

-- Backfill new columns from legacy fields when present.
UPDATE education_facilities
SET school_name = COALESCE(school_name, name, "name:en", "name:ny"),
    district = COALESCE(district, "addr:city"),
    operator = COALESCE(operator, "operator:type"),
    ta_id = COALESCE(ta_id, ward_id),
    x_coordinate = COALESCE(x_coordinate, ST_X(geom)),
    y_coordinate = COALESCE(y_coordinate, ST_Y(geom));

-- Convert teacher_distribution to integer to match the new schema.
ALTER TABLE education_facilities
ALTER COLUMN teacher_distribution TYPE INTEGER
USING (
    CASE
        WHEN teacher_distribution IS NULL THEN NULL
        WHEN NULLIF(regexp_replace(teacher_distribution::text, '[^0-9-]', '', 'g'), '') ~ '^-?[0-9]+$'
            THEN NULLIF(regexp_replace(teacher_distribution::text, '[^0-9-]', '', 'g'), '')::INTEGER
        ELSE NULL
    END
);

-- Enforce target foreign keys (drop stale ward-related constraint/index paths).
ALTER TABLE education_facilities DROP CONSTRAINT IF EXISTS education_facilities_ward_id_fkey;
ALTER TABLE education_facilities DROP CONSTRAINT IF EXISTS education_facilities_ta_id_fkey;
ALTER TABLE education_facilities
ADD CONSTRAINT education_facilities_ta_id_fkey
FOREIGN KEY (ta_id) REFERENCES admin3_units(id);

ALTER TABLE education_facilities DROP CONSTRAINT IF EXISTS education_facilities_osm_id_key;

ALTER TABLE education_facilities DROP CONSTRAINT IF EXISTS education_facilities_district_id_fkey;
ALTER TABLE education_facilities
ADD CONSTRAINT education_facilities_district_id_fkey
FOREIGN KEY (district_id) REFERENCES districts(id);

-- Remove legacy-only columns so the table matches the new schema shape.
ALTER TABLE education_facilities DROP COLUMN IF EXISTS name;
ALTER TABLE education_facilities DROP COLUMN IF EXISTS "name:en";
ALTER TABLE education_facilities DROP COLUMN IF EXISTS amenity;
ALTER TABLE education_facilities DROP COLUMN IF EXISTS building;
ALTER TABLE education_facilities DROP COLUMN IF EXISTS "operator:type";
ALTER TABLE education_facilities DROP COLUMN IF EXISTS "capacity:persons";
ALTER TABLE education_facilities DROP COLUMN IF EXISTS "addr:full";
ALTER TABLE education_facilities DROP COLUMN IF EXISTS "addr:city";
ALTER TABLE education_facilities DROP COLUMN IF EXISTS source;
ALTER TABLE education_facilities DROP COLUMN IF EXISTS "name:ny";
ALTER TABLE education_facilities DROP COLUMN IF EXISTS source_school_id;
ALTER TABLE education_facilities DROP COLUMN IF EXISTS source_gid;
ALTER TABLE education_facilities DROP COLUMN IF EXISTS comments;
ALTER TABLE education_facilities DROP COLUMN IF EXISTS student_enrollment;
ALTER TABLE education_facilities DROP COLUMN IF EXISTS ward_id;
ALTER TABLE education_facilities DROP COLUMN IF EXISTS is_active;
ALTER TABLE education_facilities DROP COLUMN IF EXISTS updated_at;
ALTER TABLE education_facilities DROP COLUMN IF EXISTS osm_id;
ALTER TABLE education_facilities DROP COLUMN IF EXISTS osm_type;

-- Keep index set aligned with the new schema.
DROP INDEX IF EXISTS idx_edu_facilities_ward_id;
DROP INDEX IF EXISTS idx_edu_facilities_is_active;
CREATE INDEX IF NOT EXISTS idx_edu_facilities_ta_id ON education_facilities(ta_id);
CREATE INDEX IF NOT EXISTS idx_edu_facilities_district_id ON education_facilities(district_id);
CREATE INDEX IF NOT EXISTS idx_edu_facilities_geom ON education_facilities USING GIST(geom);

COMMIT;
