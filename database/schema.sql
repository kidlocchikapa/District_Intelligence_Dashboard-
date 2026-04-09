-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Administrative Units (Wards/Districts)
CREATE TABLE IF NOT EXISTS administrative_units (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50), -- e.g., 'Ward', 'District'
    parent_id INTEGER REFERENCES administrative_units(id),
    source VARCHAR(255),
    level VARCHAR(50),
    population_total INTEGER DEFAULT 0,
    population_density FLOAT,
    area_sq_km DOUBLE PRECISION,
    metadata JSONB DEFAULT '{}'::jsonb,
    centroid GEOMETRY(Point, 4326),
    simplified_geom GEOMETRY(MultiPolygon, 4326),
    geom GEOMETRY(MultiPolygon, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Education Facilities / Schools
CREATE TABLE IF NOT EXISTS education_facilities (
    school_id SERIAL PRIMARY KEY NOT NULL,
    name VARCHAR(225),
    "name:en" VARCHAR(225),
    amenity VARCHAR(100),
    building VARCHAR(100),
    "operator:type" VARCHAR(100),
    "capacity:persons" INTEGER,
    "addr:full" TEXT,
    "addr:city" VARCHAR(225),
    source VARCHAR(225),
    "name:ny" VARCHAR(225),
    source_school_id BIGINT,
    source_gid BIGINT,
    status VARCHAR(100),
    comments TEXT,
    student_enrollment TEXT,
    student_enrollment_total INTEGER,
    teacher_distribution TEXT,
    teacher_count INTEGER,
    osm_id BIGINT UNIQUE,
    osm_type VARCHAR(100),
    ward_id INTEGER REFERENCES administrative_units(id),
    district_id INTEGER REFERENCES administrative_units(id),
    geom GEOMETRY(Point, 4326) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Health Facilities
CREATE TABLE IF NOT EXISTS health_facilities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    "name:en" VARCHAR(225),
    amenity VARCHAR(100),
    building VARCHAR(100),
    type VARCHAR(50), -- e.g., 'Clinic', 'Hospital'
    healthcare VARCHAR(100),
    "healthcare:speciality" VARCHAR(225),
    "operator:type" VARCHAR(100),
    "capacity:persons" INTEGER,
    "addr:full" TEXT,
    "addr:city" VARCHAR(225),
    source VARCHAR(225),
    "name:ny" VARCHAR(225),
    beds_count INTEGER,
    patient_visits_total INTEGER,
    services_offered TEXT[],
    osm_id BIGINT UNIQUE,
    osm_type VARCHAR(100),
    ward_id INTEGER REFERENCES administrative_units(id),
    district_id INTEGER REFERENCES administrative_units(id),
    geom GEOMETRY(Point, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Welfare Beneficiaries
CREATE TABLE IF NOT EXISTS welfare_beneficiaries (
    id SERIAL PRIMARY KEY,
    program_name VARCHAR(100),
    beneficiary_count INTEGER,
    ward_id INTEGER REFERENCES administrative_units(id),
    geom GEOMETRY(Point, 4326), -- Approximate location or center of cluster
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Disaster Zones
CREATE TABLE IF NOT EXISTS disaster_zones (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(100), -- e.g., 'Flood', 'Drought'
    risk_level VARCHAR(20), -- 'Low', 'Medium', 'High'
    population_at_risk INTEGER,
    geom GEOMETRY(MultiPolygon, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Master Gazetteer used to normalize district / ward / village names across sources
CREATE TABLE IF NOT EXISTS master_gazetteer (
    id SERIAL PRIMARY KEY,
    geo_code VARCHAR(100) UNIQUE,
    district_name VARCHAR(255) NOT NULL,
    ward_name VARCHAR(255),
    village_name VARCHAR(255),
    normalized_district_name VARCHAR(255) NOT NULL,
    normalized_ward_name VARCHAR(255),
    normalized_village_name VARCHAR(255),
    geom GEOMETRY(MultiPolygon, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unified indicators derived from harmonized datasets
CREATE TABLE IF NOT EXISTS unified_indicators (
    id SERIAL PRIMARY KEY,
    dataset_type VARCHAR(100) NOT NULL,
    indicator_name VARCHAR(150) NOT NULL,
    geographic_level VARCHAR(50) NOT NULL,
    geographic_name VARCHAR(255) NOT NULL,
    geographic_code VARCHAR(100),
    indicator_value DOUBLE PRECISION NOT NULL,
    source_filename VARCHAR(255),
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- WorldPop age-sex responses stored per administrative unit and class for direct querying
CREATE TABLE IF NOT EXISTS worldpop_age_sex (
    id SERIAL PRIMARY KEY,
    admin_unit_id INTEGER NOT NULL REFERENCES administrative_units(id) ON DELETE CASCADE,
    admin_unit_code VARCHAR(100),
    admin_unit_name VARCHAR(255) NOT NULL,
    admin_unit_type VARCHAR(50) NOT NULL,
    worldpop_year INTEGER NOT NULL,
    dataset_name VARCHAR(50) NOT NULL DEFAULT 'wpgpas',
    age_class VARCHAR(20) NOT NULL,
    age_label VARCHAR(100),
    male_population DOUBLE PRECISION DEFAULT 0,
    female_population DOUBLE PRECISION DEFAULT 0,
    total_population DOUBLE PRECISION DEFAULT 0,
    task_id VARCHAR(100),
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    execution_time DOUBLE PRECISION,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Spatial analysis outputs derived from canonical boundary and facility layers
CREATE TABLE IF NOT EXISTS analysis_results (
    id SERIAL PRIMARY KEY,
    analysis_type VARCHAR(100) NOT NULL,
    admin_unit_id INTEGER NOT NULL REFERENCES administrative_units(id) ON DELETE CASCADE,
    admin_unit_code VARCHAR(100),
    admin_unit_name VARCHAR(255) NOT NULL,
    admin_unit_type VARCHAR(50) NOT NULL,
    metric_name VARCHAR(150) NOT NULL,
    metric_value DOUBLE PRECISION NOT NULL,
    metric_unit VARCHAR(50),
    geom GEOMETRY(MultiPolygon, 4326),
    metadata JSONB DEFAULT '{}'::jsonb,
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Application users for backend authentication and role-based access
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'user' CHECK (role IN ('super_admin', 'admin', 'analyst', 'user')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- ETL Logging
CREATE TABLE IF NOT EXISTS data_load_log (
    id SERIAL PRIMARY KEY,
    source_filename VARCHAR(255),
    source_type VARCHAR(50),
    dataset_type VARCHAR(100),
    table_name VARCHAR(100),
    rows_read INTEGER DEFAULT 0,
    rows_processed INTEGER,
    rows_loaded INTEGER DEFAULT 0,
    rows_flagged INTEGER DEFAULT 0,
    status VARCHAR(50), -- 'Success', 'Failed'
    error_message TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    run_metadata JSONB DEFAULT '{}'::jsonb,
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE administrative_units ADD COLUMN IF NOT EXISTS code VARCHAR(100) UNIQUE;
ALTER TABLE administrative_units ADD COLUMN IF NOT EXISTS source VARCHAR(255);
ALTER TABLE administrative_units ADD COLUMN IF NOT EXISTS level VARCHAR(50);
ALTER TABLE administrative_units ADD COLUMN IF NOT EXISTS area_sq_km DOUBLE PRECISION;
ALTER TABLE administrative_units ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE administrative_units ADD COLUMN IF NOT EXISTS centroid GEOMETRY(Point, 4326);
ALTER TABLE administrative_units ADD COLUMN IF NOT EXISTS simplified_geom GEOMETRY(MultiPolygon, 4326);
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS student_enrollment_total INTEGER;
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS teacher_count INTEGER;
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS district_id INTEGER REFERENCES administrative_units(id);
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS source_school_id BIGINT;
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS source_gid BIGINT;
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS status VARCHAR(100);
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS comments TEXT;
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS osm_id BIGINT;
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS osm_type VARCHAR(100);
ALTER TABLE education_facilities ALTER COLUMN osm_id DROP NOT NULL;
ALTER TABLE education_facilities ALTER COLUMN osm_type DROP NOT NULL;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS patient_visits_total INTEGER;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS district_id INTEGER REFERENCES administrative_units(id);
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS "name:en" VARCHAR(225);
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS amenity VARCHAR(100);
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS building VARCHAR(100);
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS healthcare VARCHAR(100);
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS "healthcare:speciality" VARCHAR(225);
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS "operator:type" VARCHAR(100);
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS "capacity:persons" INTEGER;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS "addr:full" TEXT;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS "addr:city" VARCHAR(225);
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS source VARCHAR(225);
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS "name:ny" VARCHAR(225);
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS osm_id BIGINT UNIQUE;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS osm_type VARCHAR(100);

ALTER TABLE data_load_log ADD COLUMN IF NOT EXISTS source_type VARCHAR(50);
ALTER TABLE data_load_log ADD COLUMN IF NOT EXISTS dataset_type VARCHAR(100);
ALTER TABLE data_load_log ADD COLUMN IF NOT EXISTS rows_read INTEGER DEFAULT 0;
ALTER TABLE data_load_log ADD COLUMN IF NOT EXISTS rows_loaded INTEGER DEFAULT 0;
ALTER TABLE data_load_log ADD COLUMN IF NOT EXISTS rows_flagged INTEGER DEFAULT 0;
ALTER TABLE data_load_log ADD COLUMN IF NOT EXISTS started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE data_load_log ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
ALTER TABLE data_load_log ADD COLUMN IF NOT EXISTS run_metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE worldpop_age_sex ADD COLUMN IF NOT EXISTS admin_unit_id INTEGER REFERENCES administrative_units(id) ON DELETE CASCADE;
ALTER TABLE worldpop_age_sex ADD COLUMN IF NOT EXISTS admin_unit_code VARCHAR(100);
ALTER TABLE worldpop_age_sex ADD COLUMN IF NOT EXISTS admin_unit_name VARCHAR(255);
ALTER TABLE worldpop_age_sex ADD COLUMN IF NOT EXISTS admin_unit_type VARCHAR(50);
ALTER TABLE worldpop_age_sex ADD COLUMN IF NOT EXISTS worldpop_year INTEGER;
ALTER TABLE worldpop_age_sex ADD COLUMN IF NOT EXISTS dataset_name VARCHAR(50) DEFAULT 'wpgpas';
ALTER TABLE worldpop_age_sex ADD COLUMN IF NOT EXISTS age_class VARCHAR(20);
ALTER TABLE worldpop_age_sex ADD COLUMN IF NOT EXISTS age_label VARCHAR(100);
ALTER TABLE worldpop_age_sex ADD COLUMN IF NOT EXISTS male_population DOUBLE PRECISION DEFAULT 0;
ALTER TABLE worldpop_age_sex ADD COLUMN IF NOT EXISTS female_population DOUBLE PRECISION DEFAULT 0;
ALTER TABLE worldpop_age_sex ADD COLUMN IF NOT EXISTS total_population DOUBLE PRECISION DEFAULT 0;
ALTER TABLE worldpop_age_sex ADD COLUMN IF NOT EXISTS task_id VARCHAR(100);
ALTER TABLE worldpop_age_sex ADD COLUMN IF NOT EXISTS start_time TIMESTAMP;
ALTER TABLE worldpop_age_sex ADD COLUMN IF NOT EXISTS end_time TIMESTAMP;
ALTER TABLE worldpop_age_sex ADD COLUMN IF NOT EXISTS execution_time DOUBLE PRECISION;
ALTER TABLE worldpop_age_sex ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE welfare_beneficiaries ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE welfare_beneficiaries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE disaster_zones ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE disaster_zones ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS admin_data_edits (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    record_id BIGINT NOT NULL,
    action VARCHAR(50) NOT NULL,
    changed_by_user_id INTEGER REFERENCES users(id),
    before_data JSONB,
    after_data JSONB,
    changed_fields JSONB DEFAULT '[]'::jsonb,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Spatial Indexes
CREATE INDEX IF NOT EXISTS idx_admin_units_geom ON administrative_units USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_admin_units_centroid ON administrative_units USING GIST(centroid);
CREATE INDEX IF NOT EXISTS idx_admin_units_simplified_geom ON administrative_units USING GIST(simplified_geom);
CREATE INDEX IF NOT EXISTS idx_edu_facilities_geom ON education_facilities USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_edu_facilities_ward_id ON education_facilities(ward_id);
CREATE INDEX IF NOT EXISTS idx_edu_facilities_district_id ON education_facilities(district_id);
CREATE INDEX IF NOT EXISTS idx_edu_facilities_is_active ON education_facilities(is_active);
CREATE INDEX IF NOT EXISTS idx_health_facilities_geom ON health_facilities USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_health_facilities_ward_id ON health_facilities(ward_id);
CREATE INDEX IF NOT EXISTS idx_health_facilities_district_id ON health_facilities(district_id);
CREATE INDEX IF NOT EXISTS idx_health_facilities_is_active ON health_facilities(is_active);
CREATE INDEX IF NOT EXISTS idx_welfare_geom ON welfare_beneficiaries USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_welfare_is_active ON welfare_beneficiaries(is_active);
CREATE INDEX IF NOT EXISTS idx_disaster_zones_geom ON disaster_zones USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_disaster_zones_is_active ON disaster_zones(is_active);
CREATE INDEX IF NOT EXISTS idx_master_gazetteer_geom ON master_gazetteer USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_admin_units_code ON administrative_units(code);
CREATE INDEX IF NOT EXISTS idx_master_gazetteer_names ON master_gazetteer(normalized_district_name, normalized_ward_name, normalized_village_name);
CREATE INDEX IF NOT EXISTS idx_unified_indicators_lookup ON unified_indicators(dataset_type, indicator_name, geographic_level, geographic_name);
CREATE INDEX IF NOT EXISTS idx_worldpop_age_sex_lookup ON worldpop_age_sex(admin_unit_id, worldpop_year, age_class);
CREATE INDEX IF NOT EXISTS idx_analysis_results_lookup ON analysis_results(analysis_type, metric_name, admin_unit_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_geom ON analysis_results USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_admin_data_edits_lookup ON admin_data_edits(table_name, record_id, changed_at DESC);
