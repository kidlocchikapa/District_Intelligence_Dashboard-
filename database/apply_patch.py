import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    print("DATABASE_URL not found in environment.")
    exit(1)

# Normalize connection string
DATABASE_URL = DATABASE_URL.replace('?sslmode=require&channel_binding=require', '?sslmode=require')

print(f"Connecting to: {DATABASE_URL}")
engine = create_engine(DATABASE_URL)

patch_sql = """
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
"""

try:
    with engine.begin() as conn:
        for statement in patch_sql.split(';'):
            if statement.strip():
                print(f"Executing: {statement.strip()[:50]}...")
                conn.execute(text(statement))
    print("Patch applied successfully.")
except Exception as e:
    print(f"Error applying patch: {e}")
