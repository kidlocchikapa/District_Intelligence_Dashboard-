CREATE EXTENSION IF NOT EXISTS postgis;
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pgrouting;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'pgRouting extension is not available in this database environment. Skipping pgRouting installation.';
END $$;

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

CREATE INDEX IF NOT EXISTS idx_road_vertices_geom ON road_vertices USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_road_segments_geom ON road_segments USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_road_segments_source ON road_segments(source);
CREATE INDEX IF NOT EXISTS idx_road_segments_target ON road_segments(target);
CREATE INDEX IF NOT EXISTS idx_beneficiary_facility_travel_lookup
    ON beneficiary_facility_travel(beneficiary_id, facility_type);
CREATE INDEX IF NOT EXISTS idx_beneficiary_facility_travel_facility
    ON beneficiary_facility_travel(facility_type, facility_id);
