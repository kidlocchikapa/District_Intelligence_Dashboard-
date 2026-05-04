import json
import logging
import os
import re
from datetime import datetime

import geopandas as gpd
import pandas as pd
from geoalchemy2 import Geometry, WKTElement
from shapely.geometry import LineString, MultiLineString, shape
from sqlalchemy import text

from db_utils import log_etl_run, table_exists
from ingest import extract_source
from transform import standardize_schema, validate_schema
from pipeline_config import DATASET_CONFIG

LOGGER = logging.getLogger('etl.roads')

DEFAULT_SPEED_KMH = 30.0
HEALTH_ACCESS_TIME_MIN = 60.0
SCHOOL_ACCESS_TIME_MIN = 45.0

ROAD_CLASS_SPEEDS = {
    'motorway': 90.0,
    'trunk': 80.0,
    'primary': 70.0,
    'secondary': 60.0,
    'tertiary': 50.0,
    'unclassified': 35.0,
    'residential': 30.0,
    'service': 20.0,
    'track': 15.0,
    'path': 5.0,
    'footway': 5.0,
}


class RoadNetworkError(Exception):
    def __init__(self, user_message, step_name, original_error=None):
        self.user_message = user_message
        self.step_name = step_name
        self.original_error = original_error
        super().__init__(f"{user_message} (step: {step_name})")


def log_step(step_name, message, level='info'):
    log_method = getattr(LOGGER, level, LOGGER.info)
    log_method(f"[{step_name}] {message}")


def run_step(step_name, user_message_on_error, fn, *args, **kwargs):
    log_step(step_name, 'started')
    try:
        result = fn(*args, **kwargs)
    except RoadNetworkError:
        raise
    except Exception as exc:
        log_step(step_name, f"failed: {exc}", level='error')
        raise RoadNetworkError(user_message_on_error, step_name, exc) from exc
    log_step(step_name, 'completed')
    return result


def _normalize_text(value):
    if value is None or pd.isna(value):
        return None
    text_value = str(value).strip()
    return text_value or None


def _parse_speed(value, road_class=None):
    if value is not None and not pd.isna(value):
        match = re.search(r'\d+(?:\.\d+)?', str(value))
        if match:
            speed = float(match.group(0))
            # Values tagged as mph are rare in Malawi data, but convert if present.
            if 'mph' in str(value).lower():
                speed *= 1.60934
            if speed > 0:
                return speed

    normalized_class = str(road_class or '').strip().lower()
    return ROAD_CLASS_SPEEDS.get(normalized_class, DEFAULT_SPEED_KMH)


def _parse_oneway(value):
    if value is None or pd.isna(value):
        return False
    normalized = str(value).strip().lower()
    return normalized in {'yes', 'true', '1', 'y', 'oneway', 'forward'}


def _explode_lines(geometry):
    if geometry is None or geometry.is_empty:
        return []
    if isinstance(geometry, LineString):
        return [geometry]
    if isinstance(geometry, MultiLineString):
        return [line for line in geometry.geoms if line is not None and not line.is_empty]
    if hasattr(geometry, 'geoms'):
        return [
            line
            for item in geometry.geoms
            for line in _explode_lines(item)
        ]
    return []


def transform_road_dataset(df):
    if 'geometry' not in df.columns:
        raise RoadNetworkError(
            user_message='Road datasets must contain line geometry.',
            step_name='transform_road_dataset',
        )

    working = gpd.GeoDataFrame(df.copy(), geometry='geometry', crs=getattr(df, 'crs', None) or 'EPSG:4326')
    if working.crs is None:
        working = working.set_crs('EPSG:4326')
    elif working.crs.to_string() != 'EPSG:4326':
        working = working.to_crs('EPSG:4326')

    rows = []
    for _, row in working.iterrows():
        road_class = _normalize_text(row.get('road_class'))
        speed_kmh = _parse_speed(row.get('speed_kmh'), road_class)
        for line in _explode_lines(row.geometry):
            if len(line.coords) < 2:
                continue
            rows.append(
                {
                    'road_name': _normalize_text(row.get('road_name')),
                    'road_class': road_class,
                    'surface': _normalize_text(row.get('surface')),
                    'speed_kmh': speed_kmh,
                    'oneway': _parse_oneway(row.get('oneway')),
                    'geometry': line,
                }
            )

    if not rows:
        raise RoadNetworkError(
            user_message='Road dataset did not contain any usable LineString geometries.',
            step_name='transform_road_dataset',
        )

    road_gdf = gpd.GeoDataFrame(rows, geometry='geometry', crs='EPSG:4326')
    log_step('transform_road_dataset', f'transformed_road_segments={len(road_gdf)}')
    return road_gdf


def ensure_routing_schema(session):
    session.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    session.execute(text("CREATE EXTENSION IF NOT EXISTS pgrouting"))
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS road_vertices (
                id BIGSERIAL PRIMARY KEY,
                snap_key VARCHAR(80) UNIQUE NOT NULL,
                geom GEOMETRY(Point, 4326) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    session.execute(
        text(
            """
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
            )
            """
        )
    )
    session.execute(
        text(
            """
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
            )
            """
        )
    )
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_road_vertices_geom ON road_vertices USING GIST(geom)"))
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_road_segments_geom ON road_segments USING GIST(geom)"))
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_road_segments_source ON road_segments(source)"))
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_road_segments_target ON road_segments(target)"))
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_beneficiary_facility_travel_lookup ON beneficiary_facility_travel(beneficiary_id, facility_type)"))
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_beneficiary_facility_travel_facility ON beneficiary_facility_travel(facility_type, facility_id)"))
    session.commit()


def load_roads_to_postgis(session, roads_gdf, source_filename=None):
    ensure_routing_schema(session)
    engine = session.bind
    working = roads_gdf.copy()
    working['source_filename'] = source_filename
    working['geom'] = working.geometry.apply(lambda geom: WKTElement(geom.wkt, srid=4326))
    load_df = working[
        ['road_name', 'road_class', 'surface', 'speed_kmh', 'oneway', 'source_filename', 'geom']
    ].copy()

    load_df.to_sql(
        'tmp_road_segments_raw',
        engine,
        if_exists='replace',
        index=False,
        dtype={'geom': Geometry('LINESTRING', srid=4326)},
    )

    session.execute(text("TRUNCATE TABLE beneficiary_facility_travel"))
    session.execute(text("TRUNCATE TABLE road_segments RESTART IDENTITY CASCADE"))
    session.execute(text("TRUNCATE TABLE road_vertices RESTART IDENTITY CASCADE"))

    session.execute(
        text(
            """
            INSERT INTO road_segments (
                road_name,
                road_class,
                surface,
                speed_kmh,
                oneway,
                source_filename,
                geom
            )
            WITH noded AS (
                SELECT (ST_Dump(ST_Node(ST_UnaryUnion(ST_Collect(geom))))).geom AS geom
                FROM tmp_road_segments_raw
                WHERE geom IS NOT NULL
            ),
            lines AS (
                SELECT
                    ROW_NUMBER() OVER () AS line_id,
                    ST_LineMerge(ST_CollectionExtract(geom, 2)) AS geom
                FROM noded
            )
            SELECT
                raw.road_name,
                raw.road_class,
                raw.surface,
                COALESCE(NULLIF(raw.speed_kmh, 0), 30)::DOUBLE PRECISION AS speed_kmh,
                COALESCE(raw.oneway, FALSE) AS oneway,
                raw.source_filename,
                ST_SetSRID(ST_Force2D(lines.geom), 4326) AS geom
            FROM lines
            LEFT JOIN LATERAL (
                SELECT road_name, road_class, surface, speed_kmh, oneway, source_filename
                FROM tmp_road_segments_raw raw
                ORDER BY lines.geom <-> raw.geom
                LIMIT 1
            ) raw ON TRUE
            WHERE GeometryType(lines.geom) = 'LINESTRING'
              AND ST_NPoints(lines.geom) >= 2
              AND ST_Length(lines.geom::geography) > 0
            """
        )
    )

    endpoint_sql = """
        SELECT ST_StartPoint(geom) AS point FROM road_segments
        UNION ALL
        SELECT ST_EndPoint(geom) AS point FROM road_segments
    """
    session.execute(
        text(
            f"""
            INSERT INTO road_vertices (snap_key, geom)
            SELECT
                CONCAT(ROUND(ST_X(point)::numeric, 6), ',', ROUND(ST_Y(point)::numeric, 6)) AS snap_key,
                ST_SetSRID(
                    ST_MakePoint(ROUND(ST_X(point)::numeric, 6), ROUND(ST_Y(point)::numeric, 6)),
                    4326
                ) AS geom
            FROM ({endpoint_sql}) endpoints
            WHERE point IS NOT NULL
            GROUP BY snap_key, geom
            ON CONFLICT (snap_key) DO NOTHING
            """
        )
    )

    snap_key_expr = "CONCAT(ROUND(ST_X({point})::numeric, 6), ',', ROUND(ST_Y({point})::numeric, 6))"
    session.execute(
        text(
            f"""
            UPDATE road_segments rs
            SET
                source = source_vertex.id,
                target = target_vertex.id,
                length_m = ST_Length(rs.geom::geography),
                cost = GREATEST((ST_Length(rs.geom::geography) / 1000.0) / NULLIF(rs.speed_kmh, 0) * 60.0, 0.0001),
                reverse_cost = CASE
                    WHEN rs.oneway THEN -1
                    ELSE GREATEST((ST_Length(rs.geom::geography) / 1000.0) / NULLIF(rs.speed_kmh, 0) * 60.0, 0.0001)
                END,
                updated_at = CURRENT_TIMESTAMP
            FROM road_vertices source_vertex,
                 road_vertices target_vertex
            WHERE source_vertex.snap_key = {snap_key_expr.format(point='ST_StartPoint(rs.geom)')}
              AND target_vertex.snap_key = {snap_key_expr.format(point='ST_EndPoint(rs.geom)')}
            """
        )
    )
    session.execute(text("DROP TABLE IF EXISTS tmp_road_segments_raw"))
    session.commit()

    rows_loaded = int(session.execute(text("SELECT COUNT(*) FROM road_segments")).scalar() or 0)
    log_step('load_roads_to_postgis', f'rows_loaded={rows_loaded}, source={source_filename}')
    return rows_loaded


def _routing_prerequisites_available(session):
    extension_count = session.execute(
        text("SELECT COUNT(*) FROM pg_extension WHERE extname IN ('postgis', 'pgrouting')")
    ).scalar()
    if int(extension_count or 0) < 2:
        return False
    if not table_exists(session, 'road_segments') or not table_exists(session, 'road_vertices'):
        return False
    edge_count = session.execute(
        text("SELECT COUNT(*) FROM road_segments WHERE source IS NOT NULL AND target IS NOT NULL AND cost > 0")
    ).scalar()
    return int(edge_count or 0) > 0


def _ensure_indicator_rows(session):
    if not table_exists(session, 'welfare_beneficiary_indicators'):
        return
    session.execute(
        text(
            """
            INSERT INTO welfare_beneficiary_indicators (
                beneficiary_id,
                program_id,
                ta_id,
                district_id,
                affected_by_flood,
                has_school_access,
                has_health_facility_access
            )
            SELECT
                wb.id,
                wb.program_id,
                wb.ta_id,
                wb.district_id,
                FALSE,
                FALSE,
                FALSE
            FROM welfare_beneficiary wb
            WHERE NOT EXISTS (
                SELECT 1
                FROM welfare_beneficiary_indicators wbi
                WHERE wbi.beneficiary_id = wb.id
            )
            """
        )
    )


def _facility_source_sql(facility_type):
    if facility_type == 'health':
        return """
            SELECT
                id::BIGINT AS facility_id,
                name AS facility_name,
                geom
            FROM health_facilities
            WHERE geom IS NOT NULL
        """
    if facility_type == 'school':
        return """
            SELECT
                school_id::BIGINT AS facility_id,
                school_name AS facility_name,
                geom
            FROM education_facilities
            WHERE geom IS NOT NULL
        """
    raise ValueError(f'Unsupported facility type for routing: {facility_type}')


def compute_facility_travel(session, facility_type, candidate_limit=8):
    ensure_routing_schema(session)
    if not _routing_prerequisites_available(session):
        log_step('compute_facility_travel', 'routing prerequisites missing; skipping travel computation', level='warning')
        return 0

    facility_sql = _facility_source_sql(facility_type)
    session.execute(text("DELETE FROM beneficiary_facility_travel WHERE facility_type = :facility_type"), {'facility_type': facility_type})

    query = text(
        f"""
        WITH beneficiary_nodes AS (
            SELECT
                wb.id AS beneficiary_id,
                wb.geom,
                v.id AS beneficiary_node,
                ST_Distance(wb.geom::geography, v.geom::geography) AS snap_distance_m
            FROM welfare_beneficiary wb
            LEFT JOIN LATERAL (
                SELECT id, geom
                FROM road_vertices
                WHERE wb.geom IS NOT NULL
                ORDER BY wb.geom <-> geom
                LIMIT 1
            ) v ON TRUE
            WHERE wb.geom IS NOT NULL
        ),
        facility_nodes AS (
            SELECT
                f.facility_id,
                f.facility_name,
                f.geom,
                v.id AS facility_node,
                ST_Distance(f.geom::geography, v.geom::geography) AS facility_snap_distance_m
            FROM ({facility_sql}) f
            LEFT JOIN LATERAL (
                SELECT id, geom
                FROM road_vertices
                ORDER BY f.geom <-> geom
                LIMIT 1
            ) v ON TRUE
        ),
        candidate_pairs AS (
            SELECT
                b.beneficiary_id,
                b.beneficiary_node,
                b.snap_distance_m,
                f.facility_id,
                f.facility_name,
                f.facility_node,
                f.facility_snap_distance_m,
                ST_Distance(b.geom::geography, f.geom::geography) / 1000.0 AS straight_line_distance_km
            FROM beneficiary_nodes b
            JOIN LATERAL (
                SELECT *
                FROM facility_nodes f
                WHERE f.facility_node IS NOT NULL
                ORDER BY b.geom <-> f.geom
                LIMIT :candidate_limit
            ) f ON TRUE
            WHERE b.beneficiary_node IS NOT NULL
        ),
        routed_pairs AS (
            SELECT
                cp.*,
                route.network_distance_km,
                route.travel_time_min,
                CASE
                    WHEN cp.facility_id IS NULL THEN 'no_facility'
                    WHEN route.travel_time_min IS NULL THEN 'unroutable'
                    ELSE 'routed'
                END AS routing_status
            FROM candidate_pairs cp
            LEFT JOIN LATERAL (
                SELECT
                    SUM(CASE WHEN d.edge <> -1 THEN COALESCE(rs.length_m, 0) ELSE 0 END) / 1000.0 AS network_distance_km,
                    MAX(d.agg_cost) AS travel_time_min
                FROM pgr_dijkstra(
                    'SELECT id, source, target, cost, reverse_cost FROM road_segments WHERE source IS NOT NULL AND target IS NOT NULL AND cost > 0',
                    cp.beneficiary_node,
                    cp.facility_node,
                    directed := true
                ) d
                LEFT JOIN road_segments rs
                    ON d.edge = rs.id
            ) route ON TRUE
        ),
        ranked AS (
            SELECT
                *,
                ROW_NUMBER() OVER (
                    PARTITION BY beneficiary_id
                    ORDER BY
                        CASE WHEN travel_time_min IS NULL THEN 1 ELSE 0 END,
                        travel_time_min ASC NULLS LAST,
                        straight_line_distance_km ASC NULLS LAST
                ) AS route_rank
            FROM routed_pairs
        )
        INSERT INTO beneficiary_facility_travel (
            beneficiary_id,
            facility_type,
            facility_id,
            facility_name,
            beneficiary_node,
            facility_node,
            network_distance_km,
            travel_time_min,
            straight_line_distance_km,
            snap_distance_m,
            facility_snap_distance_m,
            routing_status,
            calculated_at
        )
        SELECT
            beneficiary_id,
            :facility_type,
            facility_id,
            facility_name,
            beneficiary_node,
            facility_node,
            network_distance_km,
            travel_time_min,
            straight_line_distance_km,
            snap_distance_m,
            facility_snap_distance_m,
            routing_status,
            CURRENT_TIMESTAMP
        FROM ranked
        WHERE route_rank = 1
        ON CONFLICT (beneficiary_id, facility_type) DO UPDATE
        SET
            facility_id = EXCLUDED.facility_id,
            facility_name = EXCLUDED.facility_name,
            beneficiary_node = EXCLUDED.beneficiary_node,
            facility_node = EXCLUDED.facility_node,
            network_distance_km = EXCLUDED.network_distance_km,
            travel_time_min = EXCLUDED.travel_time_min,
            straight_line_distance_km = EXCLUDED.straight_line_distance_km,
            snap_distance_m = EXCLUDED.snap_distance_m,
            facility_snap_distance_m = EXCLUDED.facility_snap_distance_m,
            routing_status = EXCLUDED.routing_status,
            calculated_at = CURRENT_TIMESTAMP
        """
    )
    result = session.execute(
        query,
        {
            'facility_type': facility_type,
            'candidate_limit': int(candidate_limit),
        },
    )
    session.commit()
    rows_loaded = int(result.rowcount or 0)
    log_step('compute_facility_travel', f'facility_type={facility_type}, rows_loaded={rows_loaded}')
    return rows_loaded


def update_welfare_access_from_travel(session):
    _ensure_indicator_rows(session)
    session.execute(
        text(
            """
            UPDATE welfare_beneficiary_indicators
            SET
                has_health_facility_access = FALSE,
                has_school_access = FALSE,
                updated_at = CURRENT_TIMESTAMP
            """
        )
    )
    health_update = session.execute(
        text(
            """
            UPDATE welfare_beneficiary_indicators wbi
            SET
                has_health_facility_access = COALESCE(travel.travel_time_min <= :threshold, FALSE),
                updated_at = CURRENT_TIMESTAMP
            FROM beneficiary_facility_travel travel
            WHERE travel.beneficiary_id = wbi.beneficiary_id
              AND travel.facility_type = 'health'
            """
        ),
        {'threshold': HEALTH_ACCESS_TIME_MIN},
    ).rowcount
    school_update = session.execute(
        text(
            """
            UPDATE welfare_beneficiary_indicators wbi
            SET
                has_school_access = COALESCE(travel.travel_time_min <= :threshold, FALSE),
                updated_at = CURRENT_TIMESTAMP
            FROM beneficiary_facility_travel travel
            WHERE travel.beneficiary_id = wbi.beneficiary_id
              AND travel.facility_type = 'school'
            """
        ),
        {'threshold': SCHOOL_ACCESS_TIME_MIN},
    ).rowcount
    session.commit()
    return {
        'health_access_rows_updated': int(health_update or 0),
        'school_access_rows_updated': int(school_update or 0),
    }


def recompute_beneficiary_facility_travel(session, facility_types=None, candidate_limit=8, strict=False):
    selected_types = facility_types or ['health', 'school']
    try:
        ensure_routing_schema(session)
        if not _routing_prerequisites_available(session):
            message = 'Road network or pgRouting extension is not available; travel computation skipped.'
            if strict:
                raise RoadNetworkError(message, 'routing_prerequisites')
            log_step('recompute_beneficiary_facility_travel', message, level='warning')
            return {
                'status': 'skipped',
                'reason': message,
                'rows_loaded': 0,
            }

        rows_loaded = 0
        for facility_type in selected_types:
            rows_loaded += compute_facility_travel(session, facility_type, candidate_limit=candidate_limit)
        access_updates = update_welfare_access_from_travel(session)
        return {
            'status': 'completed',
            'facility_types': selected_types,
            'rows_loaded': rows_loaded,
            **access_updates,
        }
    except RoadNetworkError:
        raise
    except Exception as exc:
        session.rollback()
        if strict:
            raise RoadNetworkError(
                user_message='Road travel recomputation failed.',
                step_name='recompute_beneficiary_facility_travel',
                original_error=exc,
            ) from exc
        log_step('recompute_beneficiary_facility_travel', f'skipped after failure: {exc}', level='warning')
        return {
            'status': 'failed',
            'reason': str(exc),
            'rows_loaded': 0,
        }


def _parse_clip_districts(value):
    if not value:
        return []
    if isinstance(value, (list, tuple)):
        return [item for item in value if item]
    return [item.strip() for item in str(value).split(',') if item.strip()]


def _fetch_district_union_geometry(session, district_names):
    names = _parse_clip_districts(district_names)
    if not names:
        return None
    result = session.execute(
        text(
            """
            SELECT ST_AsGeoJSON(ST_Union(geom))
            FROM districts
            WHERE name = ANY(:names)
            """
        ),
        {'names': names},
    ).scalar()
    if not result:
        raise RoadNetworkError(
            user_message='No matching district geometry found for road clipping.',
            step_name='clip_roads_to_districts',
        )
    return shape(json.loads(result))


def clip_roads_to_districts(session, road_gdf, district_names):
    if road_gdf is None or road_gdf.empty:
        return road_gdf
    clip_geom = _fetch_district_union_geometry(session, district_names)
    if clip_geom is None:
        return road_gdf
    clip_gdf = gpd.GeoDataFrame({'geometry': [clip_geom]}, geometry='geometry', crs=road_gdf.crs)
    clipped = gpd.clip(road_gdf, clip_gdf)
    if clipped.empty:
        raise RoadNetworkError(
            user_message='Road clipping removed all road segments. Check district geometry and query bounds.',
            step_name='clip_roads_to_districts',
        )
    return clipped


def process_roads_dataset(
    session,
    file_path=None,
    missing_data_strategy='flag',
    source_type='file',
    api_url=None,
    api_headers=None,
    overpass_url=None,
    overpass_query=None,
    overpass_timeout=60,
    clip_districts=None,
):
    started_at = datetime.utcnow()
    source_name = os.path.basename(file_path) if file_path else overpass_url
    dataset_config = DATASET_CONFIG['roads']

    raw_df = run_step(
        step_name='extract_road_source',
        user_message_on_error='Could not read road input data. Verify the file and geometry format.',
        fn=extract_source,
        source_type=source_type,
        file_path=file_path,
        api_url=api_url,
        api_headers=api_headers,
        overpass_url=overpass_url,
        overpass_query=overpass_query,
        overpass_timeout=overpass_timeout,
    )
    standardized_df = run_step(
        step_name='standardize_road_schema',
        user_message_on_error='Road input columns could not be standardized.',
        fn=standardize_schema,
        df=raw_df,
        dataset_config=dataset_config,
    )
    standardized_df = run_step(
        step_name='validate_road_schema',
        user_message_on_error='Road input failed validation.',
        fn=validate_schema,
        df=standardized_df,
        dataset_config=dataset_config,
    )
    road_gdf = run_step(
        step_name='transform_road_dataset',
        user_message_on_error='Could not transform road geometries.',
        fn=transform_road_dataset,
        df=standardized_df,
    )
    if clip_districts:
        road_gdf = run_step(
            step_name='clip_roads_to_districts',
            user_message_on_error='Could not clip roads to district boundaries.',
            fn=clip_roads_to_districts,
            session=session,
            road_gdf=road_gdf,
            district_names=clip_districts,
        )
    rows_loaded = run_step(
        step_name='load_roads_to_postgis',
        user_message_on_error='Could not save road network to the database.',
        fn=load_roads_to_postgis,
        session=session,
        roads_gdf=road_gdf,
        source_filename=source_name,
    )
    routing_result = run_step(
        step_name='recompute_beneficiary_facility_travel',
        user_message_on_error='Roads loaded, but travel recomputation failed.',
        fn=recompute_beneficiary_facility_travel,
        session=session,
        strict=False,
    )

    metadata = {
        'source_name': source_name,
        'routing_result': routing_result,
        'missing_data_strategy': missing_data_strategy,
        'clip_districts': _parse_clip_districts(clip_districts),
        'source_type': source_type,
    }
    run_step(
        step_name='log_etl_success_roads',
        user_message_on_error='Road network loaded but ETL audit logging failed.',
        fn=log_etl_run,
        session=session,
        filename=source_name,
        source_type='file',
        dataset_type='roads',
        table_name='road_segments',
        rows_read=len(raw_df),
        rows_processed=len(road_gdf),
        rows_loaded=rows_loaded,
        rows_flagged=0,
        status='Success',
        metadata=metadata,
        started_at=started_at,
        completed_at=datetime.utcnow(),
    )
    return {
        'dataset_type': 'roads',
        'table_name': 'road_segments',
        'rows_read': len(raw_df),
        'rows_processed': len(road_gdf),
        'rows_loaded': rows_loaded,
        'rows_flagged': 0,
        'indicators_loaded': routing_result.get('rows_loaded', 0) if isinstance(routing_result, dict) else 0,
    }


def process_routing_dataset(session, strict=True):
    started_at = datetime.utcnow()
    routing_result = run_step(
        step_name='recompute_beneficiary_facility_travel',
        user_message_on_error='Could not recompute beneficiary facility travel.',
        fn=recompute_beneficiary_facility_travel,
        session=session,
        strict=strict,
    )
    rows_loaded = int(routing_result.get('rows_loaded', 0)) if isinstance(routing_result, dict) else 0
    run_step(
        step_name='log_etl_success_routing',
        user_message_on_error='Routing completed but ETL audit logging failed.',
        fn=log_etl_run,
        session=session,
        filename='beneficiary_facility_travel',
        source_type='internal',
        dataset_type='routing',
        table_name='beneficiary_facility_travel',
        rows_read=rows_loaded,
        rows_processed=rows_loaded,
        rows_loaded=rows_loaded,
        rows_flagged=0,
        status='Success',
        metadata=routing_result,
        started_at=started_at,
        completed_at=datetime.utcnow(),
    )
    return {
        'dataset_type': 'routing',
        'table_name': 'beneficiary_facility_travel',
        'rows_read': rows_loaded,
        'rows_processed': rows_loaded,
        'rows_loaded': rows_loaded,
        'rows_flagged': 0,
        'indicators_loaded': rows_loaded,
    }
