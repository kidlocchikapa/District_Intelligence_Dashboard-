-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pgrouting;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'pgRouting extension is not available in this database environment. Skipping pgRouting installation.';
END $$;

-- Normalized boundary tables for non-destructive incremental uploads
CREATE TABLE IF NOT EXISTS districts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100) UNIQUE,
    valid_on DATE,
    boundary_version VARCHAR(100),
    reference_name VARCHAR(255),
    population_total INTEGER DEFAULT 0,
    population_density FLOAT DEFAULT 0,
    area_sq_km DOUBLE PRECISION,
    metadata JSONB DEFAULT '{}'::jsonb,
    geom GEOMETRY(MultiPolygon, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin3_units (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100) UNIQUE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('TA', 'Village', 'Admin3')),
    district_id INTEGER REFERENCES districts(id) ON DELETE SET NULL,
    valid_on DATE,
    boundary_version VARCHAR(100),
    reference_name VARCHAR(255),
    population_total INTEGER DEFAULT 0,
    population_density FLOAT DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    geom GEOMETRY(MultiPolygon, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS districts DROP COLUMN IF EXISTS source;
ALTER TABLE IF EXISTS admin3_units DROP COLUMN IF EXISTS source;
ALTER TABLE IF EXISTS admin3_units ADD COLUMN IF NOT EXISTS population_total INTEGER DEFAULT 0;
ALTER TABLE IF EXISTS admin3_units ADD COLUMN IF NOT EXISTS population_density FLOAT DEFAULT 0;

UPDATE admin3_units
SET type = 'TA'
WHERE LOWER(type) = 'ward';

ALTER TABLE IF EXISTS admin3_units
DROP CONSTRAINT IF EXISTS admin3_units_type_check;

ALTER TABLE IF EXISTS admin3_units
ADD CONSTRAINT admin3_units_type_check
CHECK (type IN ('TA', 'Village', 'Admin3'));

-- Education Facilities / Schools
CREATE TABLE IF NOT EXISTS education_facilities (
    school_id SERIAL PRIMARY KEY NOT NULL,
    school_name VARCHAR(225),
    district VARCHAR(255),
    operator VARCHAR(100),
    status VARCHAR(100),
    student_enrollment_total INTEGER,
    student_classroom_ratio DOUBLE PRECISION,
    special_needs_students INTEGER,
    teacher_distribution INTEGER,
    teacher_count INTEGER,
    blocks_count INTEGER,
    water_equipment_facility_count INTEGER,
    toilets_count INTEGER,
    classroom_pressure DOUBLE PRECISION,
    teacher_pressure DOUBLE PRECISION,
    x_coordinate DOUBLE PRECISION,
    y_coordinate DOUBLE PRECISION,
    ta_id INTEGER REFERENCES admin3_units(id),
    district_id INTEGER REFERENCES districts(id),
    geom GEOMETRY(Point, 4326) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS education_facilities DROP CONSTRAINT IF EXISTS education_facilities_osm_id_key;
ALTER TABLE IF EXISTS education_facilities DROP COLUMN IF EXISTS osm_id;
ALTER TABLE IF EXISTS education_facilities DROP COLUMN IF EXISTS osm_type;

-- Health Facilities
CREATE TABLE IF NOT EXISTS health_facilities (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    common_name VARCHAR(255),
    type VARCHAR(50), -- e.g., 'Clinic', 'Hospital'
    ownership VARCHAR(100),
    "capacity:persons" INTEGER,
    zone VARCHAR(100),
    district VARCHAR(255),
    status VARCHAR(100),
    doctor_count INTEGER,
    nurse_midwife_count INTEGER,
    bed_capacity INTEGER,
    beds_count INTEGER,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    patient_visits_total INTEGER,
    services_offered TEXT[],
    ta_id INTEGER REFERENCES admin3_units(id),
    district_id INTEGER REFERENCES districts(id),
    geom GEOMETRY(Point, 4326),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS health_facilities DROP CONSTRAINT IF EXISTS health_facilities_osm_id_key;
ALTER TABLE IF EXISTS health_facilities DROP COLUMN IF EXISTS "operator:type";
ALTER TABLE IF EXISTS health_facilities DROP COLUMN IF EXISTS osm_id;
ALTER TABLE IF EXISTS health_facilities DROP COLUMN IF EXISTS osm_type;
UPDATE health_facilities
SET code = UPPER(BTRIM(code))
WHERE code IS NOT NULL;
UPDATE health_facilities
SET code = NULL
WHERE code = '';
CREATE INDEX IF NOT EXISTS idx_health_facilities_code
ON health_facilities(code)
WHERE code IS NOT NULL;

-- Welfare Beneficiaries (Aggregate)
CREATE TABLE IF NOT EXISTS welfare_beneficiaries (
    id SERIAL PRIMARY KEY,
    program_name VARCHAR(100),
    beneficiary_count INTEGER,
    ta_id INTEGER REFERENCES admin3_units(id),
    geom GEOMETRY(Point, 4326), -- Approximate location or center of cluster
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Welfare Programs
CREATE TABLE IF NOT EXISTS welfare_programs (
    program_id SERIAL PRIMARY KEY,
    program_name VARCHAR(255) NOT NULL UNIQUE,
    department VARCHAR(100),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Individual Welfare Beneficiaries
CREATE TABLE IF NOT EXISTS welfare_beneficiary (
    id SERIAL PRIMARY KEY,
    program_id INTEGER REFERENCES welfare_programs(program_id) ON DELETE SET NULL,
    firstname VARCHAR(100),
    lastname VARCHAR(100),
    gender VARCHAR(20),
    age INTEGER,
    district_id INTEGER REFERENCES districts(id) ON DELETE SET NULL,
    ta_id INTEGER REFERENCES admin3_units(id) ON DELETE SET NULL,
    household_size INTEGER,
    status VARCHAR(50),
    start_date DATE,
    end_date DATE,
    area_sqkm DOUBLE PRECISION,
    center_lat DOUBLE PRECISION,
    center_long DOUBLE PRECISION,
    geom GEOMETRY(Point, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Welfare Beneficiary Indicators
CREATE TABLE IF NOT EXISTS welfare_beneficiary_indicators (
    id SERIAL PRIMARY KEY,
    beneficiary_id INTEGER REFERENCES welfare_beneficiary(id) ON DELETE CASCADE,
    program_id INTEGER REFERENCES welfare_programs(program_id) ON DELETE CASCADE,
    ta_id INTEGER REFERENCES admin3_units(id) ON DELETE SET NULL,
    district_id INTEGER REFERENCES districts(id) ON DELETE SET NULL,
    affected_by_flood BOOLEAN DEFAULT FALSE,
    has_school_access BOOLEAN DEFAULT FALSE,
    has_health_facility_access BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Disaster zones maintained from admin stewardship edits
CREATE TABLE IF NOT EXISTS disaster_zones (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(120),
    risk_level VARCHAR(60),
    population_at_risk INTEGER,
    geom GEOMETRY(MultiPolygon, 4326),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Road network used by pgRouting travel-time analysis
CREATE TABLE IF NOT EXISTS road_vertices (
    id BIGSERIAL PRIMARY KEY,
    snap_key VARCHAR(80) UNIQUE NOT NULL,
    geom GEOMETRY(Point, 4326) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS road_segments (
    id BIGSERIAL PRIMARY KEY,
    road_name VARCHAR(255),
    road_class VARCHAR(100),
    surface VARCHAR(100),
    speed_kmh DOUBLE PRECISION NOT NULL DEFAULT 30,
    oneway BOOLEAN NOT NULL DEFAULT FALSE,
    source BIGINT REFERENCES road_vertices(id),
    target BIGINT REFERENCES road_vertices(id),
    length_m DOUBLE PRECISION NOT NULL DEFAULT 0,
    cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    reverse_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    source_filename VARCHAR(255),
    geom GEOMETRY(LineString, 4326) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS beneficiary_facility_travel (
    id BIGSERIAL PRIMARY KEY,
    beneficiary_id INTEGER NOT NULL REFERENCES welfare_beneficiary(id) ON DELETE CASCADE,
    facility_type VARCHAR(50) NOT NULL,
    facility_id BIGINT,
    facility_name VARCHAR(255),
    beneficiary_node BIGINT REFERENCES road_vertices(id),
    facility_node BIGINT REFERENCES road_vertices(id),
    network_distance_km DOUBLE PRECISION,
    travel_time_min DOUBLE PRECISION,
    straight_line_distance_km DOUBLE PRECISION,
    snap_distance_m DOUBLE PRECISION,
    facility_snap_distance_m DOUBLE PRECISION,
    routing_status VARCHAR(50) NOT NULL DEFAULT 'unroutable',
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb,
    UNIQUE (beneficiary_id, facility_type)
);

-- Flood exposure outputs for district and TA units
CREATE TABLE IF NOT EXISTS flood_zones (
    id SERIAL PRIMARY KEY,
    district_id INTEGER NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
    district_name VARCHAR(255) NOT NULL,
    ta_id INTEGER NOT NULL DEFAULT 0,
    ta_name VARCHAR(255) NOT NULL,
    total_population DOUBLE PRECISION NOT NULL DEFAULT 0,
    exposed_population DOUBLE PRECISION NOT NULL DEFAULT 0,
    low_risk_population DOUBLE PRECISION NOT NULL DEFAULT 0,
    medium_risk_population DOUBLE PRECISION NOT NULL DEFAULT 0,
    high_risk_population DOUBLE PRECISION NOT NULL DEFAULT 0,
    exposed_area_sq_km DOUBLE PRECISION NOT NULL DEFAULT 0,
    analysis_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (district_id, ta_id, analysis_date)
);

CREATE TABLE IF NOT EXISTS flood_risk_polygons (
    id SERIAL PRIMARY KEY,
    analysis_date DATE NOT NULL,
    risk_level VARCHAR(20) NOT NULL,
    source_raster VARCHAR(255),
    geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_flood_risk_polygons_date
    ON flood_risk_polygons (analysis_date);

CREATE INDEX IF NOT EXISTS idx_flood_risk_polygons_risk
    ON flood_risk_polygons (risk_level);

CREATE INDEX IF NOT EXISTS idx_flood_risk_polygons_geom
    ON flood_risk_polygons USING GIST (geom);

CREATE TABLE IF NOT EXISTS flood_facility_exposure (
    id SERIAL PRIMARY KEY,
    analysis_date DATE NOT NULL,
    district_id INTEGER NOT NULL,
    district_name VARCHAR(255) NOT NULL,
    ta_id INTEGER NOT NULL DEFAULT 0,
    ta_name VARCHAR(255) NOT NULL,
    facility_type VARCHAR(20) NOT NULL,
    facility_id BIGINT NOT NULL,
    facility_name VARCHAR(255),
    flood_value DOUBLE PRECISION,
    risk_class VARCHAR(20) NOT NULL,
    is_exposed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (analysis_date, facility_type, facility_id)
);

CREATE TABLE IF NOT EXISTS flood_facility_exposure_summary (
    id SERIAL PRIMARY KEY,
    analysis_date DATE NOT NULL,
    district_id INTEGER NOT NULL,
    district_name VARCHAR(255) NOT NULL,
    ta_id INTEGER NOT NULL DEFAULT 0,
    ta_name VARCHAR(255) NOT NULL,
    facility_type VARCHAR(20) NOT NULL,
    total_facilities INTEGER NOT NULL DEFAULT 0,
    exposed_facilities INTEGER NOT NULL DEFAULT 0,
    low_risk_count INTEGER NOT NULL DEFAULT 0,
    medium_risk_count INTEGER NOT NULL DEFAULT 0,
    high_risk_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (analysis_date, district_id, ta_id, facility_type)
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
    admin_unit_id INTEGER NOT NULL,
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
    admin_unit_id INTEGER NOT NULL,
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
    role VARCHAR(50) NOT NULL DEFAULT 'department_admin' CHECK (role IN ('super_admin', 'admin', 'education_admin', 'health_admin', 'disaster_admin', 'welfare_admin', 'department_admin', 'analyst', 'user')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_department_permissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department VARCHAR(50) NOT NULL CHECK (department IN ('education', 'health', 'welfare', 'disaster')),
    can_read BOOLEAN NOT NULL DEFAULT TRUE,
    can_write BOOLEAN NOT NULL DEFAULT FALSE,
    can_recompute BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, department)
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_user_department_permissions_user_id ON user_department_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_department_permissions_department ON user_department_permissions(department);

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


CREATE TABLE IF NOT EXISTS admin_data_edits (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    record_id BIGINT,
    action VARCHAR(50) NOT NULL,
    changed_by_user_id INTEGER REFERENCES users(id),
    before_data JSONB,
    after_data JSONB,
    changed_fields JSONB DEFAULT '[]'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'approved',
    request_payload JSONB,
    reviewed_by_user_id INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP,
    review_notes TEXT,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS admin_data_edits ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'approved';
ALTER TABLE IF EXISTS admin_data_edits ADD COLUMN IF NOT EXISTS request_payload JSONB;
ALTER TABLE IF EXISTS admin_data_edits ADD COLUMN IF NOT EXISTS reviewed_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE IF EXISTS admin_data_edits ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
ALTER TABLE IF EXISTS admin_data_edits ADD COLUMN IF NOT EXISTS review_notes TEXT;
ALTER TABLE IF EXISTS admin_data_edits ALTER COLUMN record_id DROP NOT NULL;

-- Spatial Indexes
CREATE INDEX IF NOT EXISTS idx_districts_geom ON districts USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_districts_name ON districts(name);
CREATE INDEX IF NOT EXISTS idx_admin3_units_geom ON admin3_units USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_admin3_units_district_id ON admin3_units(district_id);
CREATE INDEX IF NOT EXISTS idx_edu_facilities_geom ON education_facilities USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_edu_facilities_district_id ON education_facilities(district_id);
CREATE INDEX IF NOT EXISTS idx_health_facilities_geom ON health_facilities USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_health_facilities_district_id ON health_facilities(district_id);
CREATE INDEX IF NOT EXISTS idx_health_facilities_is_active ON health_facilities(is_active);
CREATE INDEX IF NOT EXISTS idx_welfare_geom ON welfare_beneficiaries USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_welfare_is_active ON welfare_beneficiaries(is_active);
CREATE INDEX IF NOT EXISTS idx_welfare_beneficiary_geom ON welfare_beneficiary USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_welfare_beneficiary_program_id ON welfare_beneficiary(program_id);
CREATE INDEX IF NOT EXISTS idx_welfare_beneficiary_district_id ON welfare_beneficiary(district_id);
CREATE INDEX IF NOT EXISTS idx_welfare_beneficiary_ta_id ON welfare_beneficiary(ta_id);
CREATE INDEX IF NOT EXISTS idx_welfare_indicators_beneficiary_id ON welfare_beneficiary_indicators(beneficiary_id);
CREATE INDEX IF NOT EXISTS idx_welfare_indicators_lookup ON welfare_beneficiary_indicators(program_id, district_id, ta_id);
CREATE INDEX IF NOT EXISTS idx_road_vertices_geom ON road_vertices USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_road_segments_geom ON road_segments USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_road_segments_source ON road_segments(source);
CREATE INDEX IF NOT EXISTS idx_road_segments_target ON road_segments(target);
CREATE INDEX IF NOT EXISTS idx_beneficiary_facility_travel_lookup ON beneficiary_facility_travel(beneficiary_id, facility_type);
CREATE INDEX IF NOT EXISTS idx_beneficiary_facility_travel_facility ON beneficiary_facility_travel(facility_type, facility_id);
CREATE INDEX IF NOT EXISTS idx_flood_zones_analysis_date ON flood_zones(analysis_date);
CREATE INDEX IF NOT EXISTS idx_flood_facility_exposure_lookup ON flood_facility_exposure(analysis_date, facility_type, district_id, ta_id);
CREATE INDEX IF NOT EXISTS idx_flood_facility_exposure_summary_lookup ON flood_facility_exposure_summary(analysis_date, facility_type, district_id, ta_id);
CREATE INDEX IF NOT EXISTS idx_master_gazetteer_geom ON master_gazetteer USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_master_gazetteer_names ON master_gazetteer(normalized_district_name, normalized_ward_name, normalized_village_name);
CREATE INDEX IF NOT EXISTS idx_unified_indicators_lookup ON unified_indicators(dataset_type, indicator_name, geographic_level, geographic_name);
CREATE INDEX IF NOT EXISTS idx_worldpop_age_sex_lookup ON worldpop_age_sex(admin_unit_id, worldpop_year, age_class);
CREATE INDEX IF NOT EXISTS idx_analysis_results_lookup ON analysis_results(analysis_type, metric_name, admin_unit_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_geom ON analysis_results USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_admin_data_edits_lookup ON admin_data_edits(table_name, record_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_data_edits_status_lookup ON admin_data_edits(status, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_edu_facilities_is_active ON education_facilities(is_active);
CREATE INDEX IF NOT EXISTS idx_disaster_zones_is_active ON disaster_zones(is_active);

-- Compatibility indexes for environments that may have legacy/newer table variants.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'education_facilities' AND column_name = 'ta_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_edu_facilities_ta_id ON education_facilities(ta_id);
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'education_facilities' AND column_name = 'ward_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_edu_facilities_ward_id ON education_facilities(ward_id);
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'education_facilities' AND column_name = 'is_active'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_edu_facilities_is_active ON education_facilities(is_active);
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'health_facilities' AND column_name = 'ta_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_health_facilities_ta_id ON health_facilities(ta_id);
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'health_facilities' AND column_name = 'ward_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_health_facilities_ward_id ON health_facilities(ward_id);
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'health_facilities' AND column_name = 'is_active'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_health_facilities_is_active ON health_facilities(is_active);
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'welfare_beneficiaries' AND column_name = 'ta_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_welfare_ta_id ON welfare_beneficiaries(ta_id);
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'welfare_beneficiaries' AND column_name = 'ward_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_welfare_ward_id ON welfare_beneficiaries(ward_id);
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'welfare_beneficiaries' AND column_name = 'is_active'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_welfare_is_active ON welfare_beneficiaries(is_active);
    END IF;

END $$;

DROP TABLE IF EXISTS administrative_units CASCADE;
