-- Patch to add id SERIAL PRIMARY KEY to flood tables

-- 1. flood_zones
ALTER TABLE flood_zones DROP CONSTRAINT IF EXISTS flood_zones_pkey;
ALTER TABLE flood_zones ADD COLUMN IF NOT EXISTS id SERIAL PRIMARY KEY;
ALTER TABLE flood_zones DROP CONSTRAINT IF EXISTS flood_zones_district_id_ta_id_analysis_date_key;
ALTER TABLE flood_zones ADD CONSTRAINT flood_zones_district_id_ta_id_analysis_date_key UNIQUE (district_id, ta_id, analysis_date);

-- 2. flood_facility_exposure
ALTER TABLE flood_facility_exposure DROP CONSTRAINT IF EXISTS flood_facility_exposure_pkey;
ALTER TABLE flood_facility_exposure ADD COLUMN IF NOT EXISTS id SERIAL PRIMARY KEY;
ALTER TABLE flood_facility_exposure DROP CONSTRAINT IF EXISTS flood_facility_exposure_analysis_date_facility_type_faci_key;
ALTER TABLE flood_facility_exposure ADD CONSTRAINT flood_facility_exposure_analysis_date_facility_type_faci_key UNIQUE (analysis_date, facility_type, facility_id);

-- 3. flood_facility_exposure_summary
ALTER TABLE flood_facility_exposure_summary DROP CONSTRAINT IF EXISTS flood_facility_exposure_summary_pkey;
ALTER TABLE flood_facility_exposure_summary ADD COLUMN IF NOT EXISTS id SERIAL PRIMARY KEY;
ALTER TABLE flood_facility_exposure_summary DROP CONSTRAINT IF EXISTS flood_facility_exposure_summary_analysis_date_district_id__key;
ALTER TABLE flood_facility_exposure_summary ADD CONSTRAINT flood_facility_exposure_summary_analysis_date_district_id__key UNIQUE (analysis_date, district_id, ta_id, facility_type);

-- Also add exposed_area_sq_km to flood_zones if it doesn't exist
ALTER TABLE flood_zones ADD COLUMN IF NOT EXISTS exposed_area_sq_km DOUBLE PRECISION NOT NULL DEFAULT 0;
