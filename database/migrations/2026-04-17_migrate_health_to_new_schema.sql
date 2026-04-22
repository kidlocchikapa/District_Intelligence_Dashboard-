BEGIN;

-- Keep a one-time backup of the legacy health table before reshaping.
CREATE TABLE IF NOT EXISTS health_facilities_backup_20260417
AS TABLE health_facilities WITH DATA;

-- Add target columns from the new schema if missing.
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS code VARCHAR(100);
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS common_name VARCHAR(255);
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS ownership VARCHAR(100);
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS zone VARCHAR(100);
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS district VARCHAR(255);
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS status VARCHAR(100);
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS doctor_count INTEGER;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS nurse_midwife_count INTEGER;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS bed_capacity INTEGER;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS ta_id INTEGER;

-- Backfill new columns from legacy fields where possible.
UPDATE health_facilities
SET common_name = COALESCE(common_name, "name:en", "name:ny"),
    ownership = COALESCE(ownership, "operator:type"),
    zone = COALESCE(zone, "addr:city"),
    district = COALESCE(district, "addr:city"),
    ta_id = COALESCE(ta_id, ward_id),
    latitude = COALESCE(latitude, ST_Y(geom)),
    longitude = COALESCE(longitude, ST_X(geom));

-- Enforce target foreign keys.
ALTER TABLE health_facilities DROP CONSTRAINT IF EXISTS health_facilities_ward_id_fkey;
ALTER TABLE health_facilities DROP CONSTRAINT IF EXISTS health_facilities_ta_id_fkey;
ALTER TABLE health_facilities
ADD CONSTRAINT health_facilities_ta_id_fkey
FOREIGN KEY (ta_id) REFERENCES admin3_units(id);

ALTER TABLE health_facilities DROP CONSTRAINT IF EXISTS health_facilities_osm_id_key;

ALTER TABLE health_facilities DROP CONSTRAINT IF EXISTS health_facilities_district_id_fkey;
ALTER TABLE health_facilities
ADD CONSTRAINT health_facilities_district_id_fkey
FOREIGN KEY (district_id) REFERENCES districts(id);

-- Remove legacy-only columns to match the new schema shape.
ALTER TABLE health_facilities DROP COLUMN IF EXISTS "name:en";
ALTER TABLE health_facilities DROP COLUMN IF EXISTS amenity;
ALTER TABLE health_facilities DROP COLUMN IF EXISTS building;
ALTER TABLE health_facilities DROP COLUMN IF EXISTS healthcare;
ALTER TABLE health_facilities DROP COLUMN IF EXISTS "healthcare:speciality";
ALTER TABLE health_facilities DROP COLUMN IF EXISTS "addr:full";
ALTER TABLE health_facilities DROP COLUMN IF EXISTS "addr:city";
ALTER TABLE health_facilities DROP COLUMN IF EXISTS source;
ALTER TABLE health_facilities DROP COLUMN IF EXISTS "name:ny";
ALTER TABLE health_facilities DROP COLUMN IF EXISTS ward_id;
ALTER TABLE health_facilities DROP COLUMN IF EXISTS is_active;
ALTER TABLE health_facilities DROP COLUMN IF EXISTS updated_at;
ALTER TABLE health_facilities DROP COLUMN IF EXISTS "operator:type";
ALTER TABLE health_facilities DROP COLUMN IF EXISTS osm_id;
ALTER TABLE health_facilities DROP COLUMN IF EXISTS osm_type;

-- Align index set with the new schema shape.
DROP INDEX IF EXISTS idx_health_facilities_ward_id;
DROP INDEX IF EXISTS idx_health_facilities_is_active;
CREATE INDEX IF NOT EXISTS idx_health_facilities_ta_id ON health_facilities(ta_id);
CREATE INDEX IF NOT EXISTS idx_health_facilities_district_id ON health_facilities(district_id);
CREATE INDEX IF NOT EXISTS idx_health_facilities_geom ON health_facilities USING GIST(geom);

COMMIT;
