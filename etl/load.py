# importing libraries
import json

import pandas as pd
from geoalchemy2 import Geometry, WKTElement
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import text
from shapely.geometry import Point
from shapely import wkt

from pipeline_config import DATASET_CONFIG

#This function handles fetching administrative unit data from the database and create a lookup structure
def fetch_admin_unit_lookup(session):
    query = text(
        """
        SELECT
            id,
            code,
            name,
            'district' AS type,
            NULL::INTEGER AS parent_id
        FROM districts

        UNION ALL

        SELECT
            id,
            code,
            name,
            LOWER(type) AS type,
            district_id AS parent_id
        FROM admin3_units
        """
    )
    rows = session.execute(query).mappings().all()
    lookup = {}
    by_id = {}
    for row in rows:
        normalized_name = str(row['name']).strip().lower() if row['name'] else None
        record = {
            'id': row['id'],
            'code': row['code'],
            'type': (row['type'] or '').strip().lower(),
            'parent_id': row['parent_id'],
        }
        by_id[row['id']] = record
        if normalized_name:
            lookup[(normalized_name, (row['type'] or '').strip().lower())] = record
            lookup[(normalized_name, '')] = record
    return {'by_name': lookup, 'by_id': by_id}


def fetch_spatial_admin_lookup(session):
    query = text(
        """
        SELECT
            d.id AS district_id,
            d.name AS district_name,
            ST_AsText(d.geom) AS district_geom_wkt,
            a.id AS ta_id,
            a.name AS ta_name,
            ST_AsText(a.geom) AS ta_geom_wkt
        FROM districts d
        LEFT JOIN admin3_units a
            ON a.district_id = d.id
            AND LOWER(a.type) = 'ta'
        WHERE d.geom IS NOT NULL
        """
    )
    rows = session.execute(query).mappings().all()

    districts = {}
    ta_units = []
    for row in rows:
        district_id = row['district_id']
        if district_id not in districts:
            district_geom = wkt.loads(row['district_geom_wkt']) if row['district_geom_wkt'] else None
            districts[district_id] = {
                'id': district_id,
                'name': row['district_name'],
                'geom': district_geom,
            }

        if row['ta_id'] and row['ta_geom_wkt']:
            ta_units.append(
                {
                    'id': row['ta_id'],
                    'name': row['ta_name'],
                    'district_id': district_id,
                    'geom': wkt.loads(row['ta_geom_wkt']),
                }
            )

    return {
        'districts': list(districts.values()),
        'ta_units': ta_units,
    }


def _normalize_lookup_text(value):
    if value is None or pd.isna(value):
        return ''
    return str(value).strip().lower()


def _coalesce_row_values(row, columns):
    for column in columns:
        value = row.get(column)
        if pd.notna(value):
            text = str(value).strip()
            if text:
                return text
    return None


def _find_spatial_match(point, polygons):
    if point is None:
        return None

    # Prefer strict containment; fallback to intersects for boundary-touch cases.
    for candidate in polygons:
        geom = candidate.get('geom')
        if geom is not None and point.within(geom):
            return candidate

    for candidate in polygons:
        geom = candidate.get('geom')
        if geom is not None and point.intersects(geom):
            return candidate

    return None

# This function takes a DataFrame and an administrative unit lookup, and attempts to assign TA, ward,
#  and district IDs based on the names and codes in the DataFrame
def assign_ward_ids(df, admin_lookup, spatial_lookup=None):
    working = df.copy()
    ta_ids = []
    ward_ids = []
    district_ids = []
    geo_codes = []
    lookup_by_name = admin_lookup['by_name']
    lookup_by_id = admin_lookup['by_id']
    district_polygons = (spatial_lookup or {}).get('districts', [])
    ta_polygons = (spatial_lookup or {}).get('ta_units', [])

    for _, row in working.iterrows():
        ward_name = _normalize_lookup_text(
            _coalesce_row_values(row, ['ward_name', 'ta_name', 'admin3_unit'])
        )
        district_name = _normalize_lookup_text(
            _coalesce_row_values(row, ['district_name', 'district'])
        )

        lon = row.get('longitude')
        lat = row.get('latitude')
        point = None
        if pd.notna(lon) and pd.notna(lat):
            try:
                point = Point(float(lon), float(lat))
            except Exception:
                point = None

        ward_match = (
            lookup_by_name.get((ward_name, 'ward'))
            or lookup_by_name.get((ward_name, 'ta'))
            or lookup_by_name.get((ward_name, 'admin3'))
            or lookup_by_name.get((ward_name, 'village'))
            or lookup_by_name.get((ward_name, ''))
        )
        district_match = lookup_by_name.get((district_name, 'district')) or lookup_by_name.get((district_name, ''))

        ward_id = ward_match['id'] if ward_match and ward_match['type'] in {'ward', 'ta', 'admin3', 'village'} else None
        district_id = district_match['id'] if district_match and district_match['type'] == 'district' else None

        if ward_match and ward_match.get('parent_id'):
            parent = lookup_by_id.get(ward_match['parent_id'])
            if parent and parent['type'] == 'district':
                district_id = parent['id']

        # Spatial relationship derivation for upload-time foreign keys.
        if ward_id is None and point is not None and ta_polygons:
            matched_ta = _find_spatial_match(point, ta_polygons)
            if matched_ta:
                ward_id = matched_ta['id']
                if district_id is None:
                    district_id = matched_ta.get('district_id')

        if district_id is None and point is not None and district_polygons:
            matched_district = _find_spatial_match(point, district_polygons)
            if matched_district:
                district_id = matched_district['id']

        chosen = ward_match or district_match
        ta_ids.append(ward_id)
        ward_ids.append(ward_id)
        district_ids.append(district_id)
        geo_codes.append(row.get('geo_code') if pd.notna(row.get('geo_code')) else (chosen['code'] if chosen else None))

    working['ta_id'] = ta_ids
    working['ward_id'] = ward_ids
    working['district_id'] = district_ids
    working['geo_code'] = geo_codes
    return working

# This function fetches administrative unit data from the database and returns it as a DataFrame, which can be used
#  for indicator processing and assignment
def fetch_admin_units_for_indicators(session):
    query = text(
        """
        SELECT
            id,
            code,
            name,
            'District'::VARCHAR AS type,
            COALESCE(population_total, 0)::INTEGER AS population_total
        FROM districts

        UNION ALL

        SELECT
            id,
            code,
            name,
            CASE
                WHEN LOWER(type) = 'ta' THEN 'TA'
                WHEN LOWER(type) = 'ward' THEN 'Ward'
                WHEN LOWER(type) = 'village' THEN 'Village'
                ELSE INITCAP(type)
            END AS type,
            0::INTEGER AS population_total
        FROM admin3_units
        """
    )
    rows = session.execute(query).mappings().all()
    return pd.DataFrame(rows)

# This function prepares a DataFrame for loading into PostGIS by ensuring 
# required columns are present, converting geometries to WKT, and sanitizing JSON values
def prepare_dataframe_for_load(df, dataset_type):
    working = df.copy()
    load_columns = DATASET_CONFIG[dataset_type]['load_columns']

    for column in load_columns:
        if column not in working.columns:
            working[column] = pd.NA

    if 'geometry' in working.columns:
        working['geom'] = working['geometry'].apply(
            lambda geom: WKTElement(geom.wkt, srid=4326) if geom is not None else None
        )

    if 'centroid' in working.columns:
        working['centroid'] = working['centroid'].apply(
            lambda geom: WKTElement(geom.wkt, srid=4326) if geom is not None else None
        )

    if 'simplified_geom' in working.columns:
        working['simplified_geom'] = working['simplified_geom'].apply(
            lambda geom: WKTElement(geom.wkt, srid=4326) if geom is not None else None
        )

    if 'services_offered' in working.columns:
        working['services_offered'] = working['services_offered'].apply(_coerce_array)

    if 'metadata' in working.columns:
        working['metadata'] = working['metadata'].apply(_sanitize_json_value)

    return working[load_columns]

# This function recursively sanitizes JSON values by converting pandas NA and NaN to None
def _sanitize_json_value(value):
    if value is None or value is pd.NA:
        return None

    try:
        if pd.isna(value):
            return None
    except TypeError:
        pass

    if isinstance(value, dict):
        return {
            key: _sanitize_json_value(item)
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [_sanitize_json_value(item) for item in value]

    return value

# this function trim strings
def _coerce_array(value):
    if value is None or pd.isna(value):
        return None
    if isinstance(value, list):
        return value
    return [item.strip() for item in str(value).split(',') if item.strip()]

# This function handles loading a GeoDataFrame into PostGIS, with special handling for boundary d
# atasets to load them into normalized tables
def load_to_postgis(session, gdf, dataset_type, if_exists='append'):
    engine = session.bind
    table_name = DATASET_CONFIG[dataset_type]['table_name']
    load_df = prepare_dataframe_for_load(gdf, dataset_type)

    if dataset_type == 'boundaries':
        rows_loaded, normalized_table_names = load_boundaries_normalized(session, gdf)
        return rows_loaded, normalized_table_names

    geom_type = 'MULTIPOLYGON' if dataset_type == 'disaster' else 'POINT'

    requires_non_null_geom = dataset_type in {'education'}

    if geom_type == 'POINT' and 'geom' in load_df.columns and requires_non_null_geom:
        valid_geom_mask = load_df['geom'].notna()
        dropped = int((~valid_geom_mask).sum())
        if dropped > 0:
            print(f"Skipping {dropped} rows with missing/invalid point geometry for {dataset_type} load")
        load_df = load_df.loc[valid_geom_mask].copy()
        if load_df.empty:
            return 0, table_name

    load_df.to_sql(
        table_name,
        engine,
        if_exists=if_exists,
        index=False,
        dtype={'geom': Geometry(geom_type, srid=4326)},
    )
    return len(load_df), table_name


def run_post_load_spatial_fk_enrichment(session, dataset_type, started_at, completed_at):
    if dataset_type not in {'education', 'health'}:
        return {'enabled': False, 'updated_rows': 0}

    table_name = DATASET_CONFIG[dataset_type]['table_name']
    params = {
        'started_at': started_at,
        'completed_at': completed_at,
    }

    updates = []

    # District assignment: strict point-in-polygon first.
    updates.append(
        session.execute(
            text(
                f"""
                UPDATE {table_name} t
                SET district_id = (
                    SELECT d.id
                    FROM districts d
                    WHERE d.geom IS NOT NULL
                      AND t.geom IS NOT NULL
                      AND ST_Within(t.geom, d.geom)
                    ORDER BY ST_Area(d.geom) DESC
                    LIMIT 1
                )
                WHERE t.created_at >= :started_at
                  AND t.created_at <= :completed_at
                  AND t.district_id IS NULL
                  AND t.geom IS NOT NULL
                """
            ),
            params,
        ).rowcount
    )

    # District fallback for boundary-touching points.
    updates.append(
        session.execute(
            text(
                f"""
                UPDATE {table_name} t
                SET district_id = (
                    SELECT d.id
                    FROM districts d
                    WHERE d.geom IS NOT NULL
                      AND t.geom IS NOT NULL
                      AND ST_Intersects(t.geom, d.geom)
                    ORDER BY ST_Area(d.geom) DESC
                    LIMIT 1
                )
                WHERE t.created_at >= :started_at
                  AND t.created_at <= :completed_at
                  AND t.district_id IS NULL
                  AND t.geom IS NOT NULL
                """
            ),
            params,
        ).rowcount
    )

    # TA assignment: strict point-in-polygon first.
    updates.append(
        session.execute(
            text(
                f"""
                UPDATE {table_name} t
                SET ta_id = (
                    SELECT a.id
                    FROM admin3_units a
                    WHERE LOWER(a.type) = 'ta'
                      AND a.geom IS NOT NULL
                      AND t.geom IS NOT NULL
                      AND ST_Within(t.geom, a.geom)
                    ORDER BY ST_Area(a.geom) ASC
                    LIMIT 1
                )
                WHERE t.created_at >= :started_at
                  AND t.created_at <= :completed_at
                  AND t.ta_id IS NULL
                  AND t.geom IS NOT NULL
                """
            ),
            params,
        ).rowcount
    )

    # TA fallback for boundary-touching points.
    updates.append(
        session.execute(
            text(
                f"""
                UPDATE {table_name} t
                SET ta_id = (
                    SELECT a.id
                    FROM admin3_units a
                    WHERE LOWER(a.type) = 'ta'
                      AND a.geom IS NOT NULL
                      AND t.geom IS NOT NULL
                      AND ST_Intersects(t.geom, a.geom)
                    ORDER BY ST_Area(a.geom) ASC
                    LIMIT 1
                )
                WHERE t.created_at >= :started_at
                  AND t.created_at <= :completed_at
                  AND t.ta_id IS NULL
                  AND t.geom IS NOT NULL
                """
            ),
            params,
        ).rowcount
    )

    # Name-based district fallback for rows without usable geometry.
    updates.append(
        session.execute(
            text(
                f"""
                UPDATE {table_name} t
                SET district_id = (
                    SELECT d.id
                    FROM districts d
                    WHERE t.district IS NOT NULL
                      AND LOWER(TRIM(t.district)) = LOWER(TRIM(d.name))
                    LIMIT 1
                )
                WHERE t.created_at >= :started_at
                  AND t.created_at <= :completed_at
                  AND t.district_id IS NULL
                """
            ),
            params,
        ).rowcount
    )

    session.commit()
    return {'enabled': True, 'updated_rows': sum(int(value or 0) for value in updates)}

# This function handles loading indicator data into the unified_indicators table
def load_unified_indicators(session, indicators_df, source_filename=None):
    if indicators_df is None or indicators_df.empty:
        return 0

    engine = session.bind
    working = indicators_df.copy()
    working['source_filename'] = source_filename
    working['metadata'] = working['metadata'].apply(_sanitize_json_value)

    working.to_sql('unified_indicators', engine, if_exists='append', index=False, dtype={'metadata': JSONB})
    return len(working)

# This function handles loading WorldPop age and sex data into the worldpop_age_sex table
def load_worldpop_age_sex(session, age_sex_df):
    if age_sex_df is None or age_sex_df.empty:
        return 0

    engine = session.bind
    working = age_sex_df.copy()
    working['metadata'] = working['metadata'].apply(_sanitize_json_value)

    years = [int(year) for year in working['worldpop_year'].dropna().unique().tolist()]

    if years:
        unit_types = (
            working[['admin_unit_type', 'admin_unit_id']]
            .dropna()
            .copy()
        )
        if not unit_types.empty:
            for admin_unit_type, group in unit_types.groupby('admin_unit_type'):
                admin_ids = [int(admin_id) for admin_id in group['admin_unit_id'].tolist()]
                if not admin_ids:
                    continue
                session.execute(
                    text(
                        """
                        DELETE FROM worldpop_age_sex
                        WHERE worldpop_year = ANY(:years)
                          AND LOWER(admin_unit_type) = LOWER(:admin_unit_type)
                          AND admin_unit_id = ANY(:admin_unit_ids)
                        """
                    ),
                    {
                        'years': years,
                        'admin_unit_type': str(admin_unit_type),
                        'admin_unit_ids': admin_ids,
                    },
                )
            session.commit()

    working.to_sql(
        'worldpop_age_sex',
        engine,
        if_exists='append',
        index=False,
        dtype={'metadata': JSONB},
    )
    return len(working)

# This function handles loading analysis results into the analysis_results table,
def load_analysis_results(session, analysis_df):
    if analysis_df is None or analysis_df.empty:
        return 0

    engine = session.bind
    working = analysis_df.copy()
    working['metadata'] = working['metadata'].apply(_sanitize_json_value)
    working['geom'] = working['geom'].apply(
        lambda geom: WKTElement(geom.wkt, srid=4326) if geom is not None else None
    )

    analysis_types = working['analysis_type'].dropna().unique().tolist()
    if analysis_types:
        session.execute(
            text("DELETE FROM analysis_results WHERE analysis_type = ANY(:analysis_types)"),
            {'analysis_types': analysis_types},
        )
        session.commit()

    working.to_sql(
        'analysis_results',
        engine,
        if_exists='append',
        index=False,
        dtype={
            'geom': Geometry('MULTIPOLYGON', srid=4326),
            'metadata': JSONB,
        },
    )
    return len(working)

# This function ensures that the normalized boundary tables (districts and admin3_units) exist in the database
def ensure_normalized_boundary_tables(session):
    session.execute(
        text(
            """
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
            )
            """
        )
    )
    session.execute(
        text(
            """
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
            )
            """
        )
    )
    session.execute(text("ALTER TABLE IF EXISTS admin3_units ADD COLUMN IF NOT EXISTS population_total INTEGER DEFAULT 0"))
    session.execute(text("ALTER TABLE IF EXISTS admin3_units ADD COLUMN IF NOT EXISTS population_density FLOAT DEFAULT 0"))
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_districts_geom ON districts USING GIST(geom)"))
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_districts_name ON districts(name)"))
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_admin3_units_geom ON admin3_units USING GIST(geom)"))
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_admin3_units_district_id ON admin3_units(district_id)"))
    session.commit()

# This function handles loading boundary data into normalized tables (districts and admin3_units) with logic to resolve
#  parent-child relationships  
def load_boundaries_normalized(session, gdf):
    ensure_normalized_boundary_tables(session)
    engine = session.bind

    working = gdf.copy()
    working['metadata'] = working['metadata'].apply(_sanitize_json_value)
    if 'district_name' not in working.columns:
        working['district_name'] = pd.NA
    if 'parent_code' not in working.columns:
        working['parent_code'] = pd.NA

    working['district_name'] = working.apply(
        lambda row: row.get('district_name')
        if pd.notna(row.get('district_name'))
        else ((row.get('metadata') or {}).get('district') if isinstance(row.get('metadata'), dict) else pd.NA),
        axis=1,
    )
    working['parent_code'] = working.apply(
        lambda row: row.get('parent_code')
        if pd.notna(row.get('parent_code'))
        else ((row.get('metadata') or {}).get('parent_code') if isinstance(row.get('metadata'), dict) else pd.NA),
        axis=1,
    )

    district_rows = working[working['type'] == 'District'].copy()
    admin3_rows = working[working['type'].isin(['TA', 'Ward', 'Village'])].copy()

    rows_loaded = 0

    if not district_rows.empty:
        district_rows['geom'] = district_rows['geometry'].apply(
            lambda geom: WKTElement(geom.wkt, srid=4326) if geom is not None else None
        )
        district_load = district_rows[
            [
                'code',
                'name',
                'valid_on',
                'boundary_version',
                'reference_name',
                'population_total',
                'population_density',
                'area_sq_km',
                'metadata',
                'geom',
            ]
        ].copy()
        district_load.to_sql(
            'tmp_boundary_districts',
            engine,
            if_exists='replace',
            index=False,
            dtype={
                'geom': Geometry('MULTIPOLYGON', srid=4326),
                'metadata': JSONB,
            },
        )
        session.execute(
            text(
                """
                INSERT INTO districts (
                    code,
                    name,
                    valid_on,
                    boundary_version,
                    reference_name,
                    population_total,
                    population_density,
                    area_sq_km,
                    metadata,
                    geom,
                    updated_at
                )
                SELECT
                    NULLIF(TRIM(code), ''),
                    name,
                    valid_on,
                    boundary_version,
                    reference_name,
                    population_total,
                    population_density,
                    area_sq_km,
                    metadata,
                    geom,
                    CURRENT_TIMESTAMP
                FROM tmp_boundary_districts
                WHERE NULLIF(TRIM(code), '') IS NOT NULL
                ON CONFLICT (code) DO UPDATE
                SET
                    name = EXCLUDED.name,
                    valid_on = EXCLUDED.valid_on,
                    boundary_version = EXCLUDED.boundary_version,
                    reference_name = EXCLUDED.reference_name,
                    population_total = EXCLUDED.population_total,
                    population_density = EXCLUDED.population_density,
                    area_sq_km = EXCLUDED.area_sq_km,
                    metadata = EXCLUDED.metadata,
                    geom = EXCLUDED.geom,
                    updated_at = CURRENT_TIMESTAMP
                """
            )
        )
        rows_loaded += len(district_load)

    if not admin3_rows.empty:
        admin3_rows['geom'] = admin3_rows['geometry'].apply(
            lambda geom: WKTElement(geom.wkt, srid=4326) if geom is not None else None
        )
        admin3_load = admin3_rows[
            [
                'code',
                'name',
                'type',
                'parent_code',
                'district_name',
                'valid_on',
                'boundary_version',
                'reference_name',
                'metadata',
                'geom',
            ]
        ].copy()
        admin3_load.to_sql(
            'tmp_boundary_admin3',
            engine,
            if_exists='replace',
            index=False,
            dtype={
                'geom': Geometry('MULTIPOLYGON', srid=4326),
                'metadata': JSONB,
            },
        )
        session.execute(
            text(
                """
                WITH resolved AS (
                    SELECT
                        NULLIF(TRIM(t.code), '') AS code,
                        t.name,
                        CASE
                            WHEN LOWER(t.type) = 'ward' THEN 'TA'
                            WHEN t.type IN ('TA', 'Village', 'Admin3') THEN t.type
                            ELSE 'TA'
                        END AS type,
                        d.id AS district_id,
                        t.valid_on,
                        t.boundary_version,
                        t.reference_name,
                        t.metadata,
                        t.geom
                    FROM tmp_boundary_admin3 t
                    LEFT JOIN districts d
                        ON LOWER(TRIM(COALESCE(t.parent_code, ''))) = LOWER(TRIM(d.code))
                        OR LOWER(TRIM(COALESCE(t.district_name, ''))) = LOWER(TRIM(d.name))
                )
                INSERT INTO admin3_units (
                    code,
                    name,
                    type,
                    district_id,
                    valid_on,
                    boundary_version,
                    reference_name,
                    metadata,
                    geom,
                    updated_at
                )
                SELECT
                    code,
                    name,
                    type,
                    district_id,
                    valid_on,
                    boundary_version,
                    reference_name,
                    metadata,
                    geom,
                    CURRENT_TIMESTAMP
                FROM resolved
                WHERE code IS NOT NULL
                ON CONFLICT (code) DO UPDATE
                SET
                    name = EXCLUDED.name,
                    type = EXCLUDED.type,
                    district_id = COALESCE(EXCLUDED.district_id, admin3_units.district_id),
                    valid_on = EXCLUDED.valid_on,
                    boundary_version = EXCLUDED.boundary_version,
                    reference_name = EXCLUDED.reference_name,
                    metadata = EXCLUDED.metadata,
                    geom = EXCLUDED.geom,
                    updated_at = CURRENT_TIMESTAMP
                """
            )
        )
        session.execute(
            text(
                """
                UPDATE admin3_units a
                SET district_id = d.id,
                    updated_at = CURRENT_TIMESTAMP
                FROM districts d
                WHERE a.district_id IS NULL
                  AND a.geom IS NOT NULL
                  AND d.geom IS NOT NULL
                  AND ST_Within(ST_PointOnSurface(a.geom), d.geom)
                """
            )
        )
        rows_loaded += len(admin3_load)

    session.commit()
    return rows_loaded, 'districts,admin3_units'