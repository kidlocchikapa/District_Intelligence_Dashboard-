#import modules
import argparse
import datetime as dt
import logging
import os
from collections import defaultdict

import json
import numpy as np
import rasterio
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
from rasterio.features import geometry_mask, shapes
from rasterio.mask import mask
from rasterio.warp import Resampling, reproject, transform, transform_geom
from shapely import wkb
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.ops import unary_union
from sqlalchemy import text

#import from other files
from db_utils import get_session
from worldpop import (
    DEFAULT_WORLDPOP_YEAR,
    download_worldpop_raster,
    load_worldpop_catalog,
    select_worldpop_dataset,
)

# Set up logging for the flood exposure pipeline
LOGGER = logging.getLogger('flood_exposure_pipeline')

# Flood value classification (0=None, 1-2=Low, 3-4=Medium, 5=High).
RISK_CLASS_MAP = {
    1: 'Low',
    2: 'Low',
    3: 'Medium',
    4: 'Medium',
    5: 'High',
}

# Error handler
class FloodPipelineError(Exception):
    def __init__(self, user_message, step_name, original_error=None):
        self.user_message = user_message
        self.step_name = step_name
        self.original_error = original_error
        super().__init__(f"{user_message} (step: {step_name})")

# Set up logging configuration for the pipeline
def setup_logging():
    if LOGGER.handlers:
        return
    logging.basicConfig(
        level=logging.INFO,
        format='[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
    )

#
def log_step(step_name, message, level='info'):
    log_method = getattr(LOGGER, level, LOGGER.info)
    log_method(f"[{step_name}] {message}")


def run_step(step_name, user_message_on_error, fn, *args, **kwargs):
    log_step(step_name, 'started')
    try:
        result = fn(*args, **kwargs)
    except FloodPipelineError:
        raise
    except Exception as exc:
        log_step(step_name, f"failed: {exc}", level='error')
        raise FloodPipelineError(
            user_message=user_message_on_error,
            step_name=step_name,
            original_error=exc,
        ) from exc
    log_step(step_name, 'completed')
    return result

#Ensure that the flood_zones table exists with appropriate schema and indexes for efficient querying.
def ensure_flood_zones_table(session):
    session.execute(
        text(
            """
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
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_flood_zones_analysis_date
            ON flood_zones (analysis_date)
            """
        )
    )
    session.commit()


def ensure_flood_risk_polygons_table(session):
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS flood_risk_polygons (
                id SERIAL PRIMARY KEY,
                analysis_date DATE NOT NULL,
                risk_level VARCHAR(20) NOT NULL,
                source_raster VARCHAR(255),
                geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_flood_risk_polygons_date
            ON flood_risk_polygons (analysis_date)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_flood_risk_polygons_risk
            ON flood_risk_polygons (risk_level)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_flood_risk_polygons_geom
            ON flood_risk_polygons USING GIST (geom)
            """
        )
    )
    session.commit()

# Map flood raster values to risk levels, handling potential issues with data types and missing values
def _risk_level_from_value(value):
    try:
        return RISK_CLASS_MAP.get(int(value))
    except (TypeError, ValueError):
        return None

# Normalize the geometry resulting from a union operation to ensure it is a valid MultiPolygon,
def _normalize_union_geom(geom):
    if geom.is_empty:
        return None
    if geom.geom_type == 'Polygon':
        return MultiPolygon([geom])
    if geom.geom_type == 'MultiPolygon':
        return geom
    # Filter to polygonal parts only
    polygon_parts = [
        part
        for part in getattr(geom, 'geoms', [])
        if part.geom_type in ('Polygon', 'MultiPolygon')
    ]
    if not polygon_parts:
        return None
    merged = unary_union(polygon_parts)
    if merged.is_empty:
        return None
    if merged.geom_type == 'Polygon':
        return MultiPolygon([merged])
    if merged.geom_type == 'MultiPolygon':
        return merged
    return None

# Build flood risk polygons from the raster data by extracting geometries for each risk level and storing them in the database
def build_flood_risk_polygons(session, flood_raster_path, analysis_date, source_raster=None):
    with rasterio.open(flood_raster_path) as src:
        band = src.read(1)
        nodata = src.nodata
        mask = np.isfinite(band)
        if nodata is not None:
            mask &= band != nodata
        mask &= band > 0

        geoms_by_level = defaultdict(list)
        for geom, value in shapes(band, mask=mask, transform=src.transform):
            risk_level = _risk_level_from_value(value)
            if not risk_level:
                continue
            if src.crs and src.crs.to_string() != 'EPSG:4326':
                geom = transform_geom(src.crs, 'EPSG:4326', geom, precision=6)
            geoms_by_level[risk_level].append(shape(geom))

    session.execute(
        text(
            """
            DELETE FROM flood_risk_polygons
            WHERE analysis_date = :analysis_date
            """
        ),
        {'analysis_date': analysis_date},
    )

    rows = []
    for risk_level, geoms in geoms_by_level.items():
        if not geoms:
            continue
        merged = unary_union(geoms)
        normalized = _normalize_union_geom(merged)
        if not normalized:
            continue
        rows.append(
            {
                'analysis_date': analysis_date,
                'risk_level': risk_level,
                'source_raster': source_raster,
                'geom_wkt': normalized.wkt,
            }
        )

    if rows:
        session.execute(
            text(
                """
                INSERT INTO flood_risk_polygons (
                    analysis_date,
                    risk_level,
                    source_raster,
                    geom
                )
                VALUES (
                    :analysis_date,
                    :risk_level,
                    :source_raster,
                    ST_SetSRID(ST_Multi(ST_GeomFromText(:geom_wkt)), 4326)
                )
                """
            ),
            rows,
        )
    session.commit()

# Ensure that the tables for storing flood exposure results
# for facilities are created with appropriate schema and indexes.
def ensure_flood_facility_tables(session):
    session.execute(
        text(
            """
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
            )
            """
        )
    )
    session.execute(
        text(
            """
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
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_flood_facility_exposure_lookup
            ON flood_facility_exposure (analysis_date, facility_type, district_id, ta_id)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_flood_facility_exposure_summary_lookup
            ON flood_facility_exposure_summary (analysis_date, facility_type, district_id, ta_id)
            """
        )
    )
    session.commit()

# fetch district and TA geometries based on provided district names, ensuring they have valid geometries 
# for analysis. The function returns combined district geometry and individual TA geometries for the specified districts
def fetch_district_and_ta_geometries(session, district_name=None, district_names=None):
    names = []
    if district_name:
        names.append(district_name)
    if district_names:
        names.extend(district_names)

    normalized_names = sorted({str(name).strip() for name in names if str(name).strip()})
    if not normalized_names:
        raise ValueError("At least one district name is required for flood analysis")

    district_rows = session.execute(
        text(
            """
            SELECT id, name, ST_AsBinary(geom) AS geom_wkb
            FROM districts
            WHERE geom IS NOT NULL
              AND LOWER(name) = ANY(:district_names)
            ORDER BY id
            """
        ),
        {"district_names": [name.lower() for name in normalized_names]},
    ).mappings().all()

    if not district_rows:
        raise ValueError(f"No matching districts with geometry found for: {normalized_names}")

    district_geoms = [wkb.loads(bytes(row["geom_wkb"])) for row in district_rows]
    combined_district_geom = unary_union(district_geoms)
    primary_district = district_rows[0]

    district_ids = [row["id"] for row in district_rows]
    ta_rows = session.execute(
        text(
            """
            SELECT id, name, district_id, ST_AsBinary(geom) AS geom_wkb
            FROM admin3_units
            WHERE district_id = ANY(:district_ids)
              AND LOWER(type) = 'ta'
              AND geom IS NOT NULL
            ORDER BY district_id, name
            """
        ),
        {"district_ids": district_ids},
    ).mappings().all()

    ta_geoms = [
        {
            "id": row["id"],
            "name": row["name"],
            "district_id": row["district_id"],
            "geom": wkb.loads(bytes(row["geom_wkb"])),
        }
        for row in ta_rows
    ]

    combined_name = primary_district["name"] if len(district_rows) == 1 else f"{primary_district['name']} (All)"

    return {
        "district_id": primary_district["id"],
        "district_name": combined_name,
        "district_geom": combined_district_geom,
        "source_district_names": [row["name"] for row in district_rows],
        "ta_units": ta_geoms,
    }


#Ensure that raster file have valid cordinate reference system
def _to_raster_crs(geometry, src_crs, dst_crs):
    if src_crs == dst_crs:
        return geometry.__geo_interface__
    return transform_geom(src_crs, dst_crs, geometry.__geo_interface__)

# Classify flood risk based on sampled flood value, returning risk class and exposure status
def _classify_flood_risk(flood_value):
    if flood_value is None or (isinstance(flood_value, float) and np.isnan(flood_value)):
        return 'none', False
    
    # Categorical intensity: 0=None, 1-2=Low, 3-4=Medium, 5=High
    if flood_value in (1, 2):
        return 'low', True
    if flood_value in (3, 4):
        return 'medium', True
    if flood_value == 5:
        return 'high', True
        
    return 'none', False

# find the matching TA ID for a given point geometry by checking 
# if it falls within or intersects any TA geometries
def _find_matching_ta_id(point_geom, ta_units):
    if point_geom is None:
        return None

    for ta in ta_units:
        geom = ta.get('geom')
        if geom is not None and point_geom.within(geom):
            return ta['id']

    for ta in ta_units:
        geom = ta.get('geom')
        if geom is not None and point_geom.intersects(geom):
            return ta['id']

    return None

# Fetch facilities (schools and health centers) that fall within the district geometry
def fetch_facilities_for_flood(session, boundaries):
    district_geom_wkt = boundaries['district_geom'].wkt
    ta_units = boundaries['ta_units']

    facility_specs = {
        'education': {
            'table': 'education_facilities',
            'id_col': 'school_id',
            'name_col': 'school_name',
        },
        'health': {
            'table': 'health_facilities',
            'id_col': 'id',
            'name_col': 'name',
        },
    }

    facilities = []
    for facility_type, spec in facility_specs.items():
        print(f"Fetching {facility_type} facilities for flood analysis...")
        rows = session.execute(
            text(
                f"""
                SELECT
                    {spec['id_col']} AS facility_id,
                    {spec['name_col']} AS facility_name,
                    district_id,
                    ta_id,
                    ST_AsBinary(geom) AS geom_wkb
                FROM {spec['table']}
                WHERE geom IS NOT NULL
                  AND ST_Intersects(geom, ST_GeomFromText(:district_geom_wkt, 4326))
                """
            ),
            {'district_geom_wkt': district_geom_wkt},
        ).mappings().all()
        print(f"Found {len(rows)} {facility_type} facilities.")

        for row in rows:
            geom = wkb.loads(bytes(row['geom_wkb'])) if row['geom_wkb'] else None
            resolved_ta_id = row['ta_id']
            if resolved_ta_id is None:
                resolved_ta_id = _find_matching_ta_id(geom, ta_units)
            facilities.append(
                {
                    'facility_type': facility_type,
                    'facility_id': int(row['facility_id']),
                    'facility_name': row['facility_name'],
                    'district_id': row['district_id'] or boundaries['district_id'],
                    'ta_id': resolved_ta_id,
                    'geom': geom,
                }
            )

    return facilities

# Store detailed flood exposure results for each facility into the database,
# using an upsert strategy to handle existing records and ensure data integrity
def upsert_flood_facility_exposure(session, rows):
    if not rows:
        return

    session.execute(
        text(
            """
            INSERT INTO flood_facility_exposure (
                analysis_date,
                district_id,
                district_name,
                ta_id,
                ta_name,
                facility_type,
                facility_id,
                facility_name,
                flood_value,
                risk_class,
                is_exposed
            )
            VALUES (
                :analysis_date,
                :district_id,
                :district_name,
                :ta_id,
                :ta_name,
                :facility_type,
                :facility_id,
                :facility_name,
                :flood_value,
                :risk_class,
                :is_exposed
            )
            ON CONFLICT (analysis_date, facility_type, facility_id)
            DO UPDATE SET
                district_id = EXCLUDED.district_id,
                district_name = EXCLUDED.district_name,
                ta_id = EXCLUDED.ta_id,
                ta_name = EXCLUDED.ta_name,
                facility_name = EXCLUDED.facility_name,
                flood_value = EXCLUDED.flood_value,
                risk_class = EXCLUDED.risk_class,
                is_exposed = EXCLUDED.is_exposed,
                updated_at = CURRENT_TIMESTAMP
            """
        ),
        rows,
    )
    session.commit()

# Upsert summary statistics for flood exposure by district, TA, and facility type
def upsert_flood_facility_exposure_summary(session, rows):
    if not rows:
        return

    session.execute(
        text(
            """
            INSERT INTO flood_facility_exposure_summary (
                analysis_date,
                district_id,
                district_name,
                ta_id,
                ta_name,
                facility_type,
                total_facilities,
                exposed_facilities,
                low_risk_count,
                medium_risk_count,
                high_risk_count
            )
            VALUES (
                :analysis_date,
                :district_id,
                :district_name,
                :ta_id,
                :ta_name,
                :facility_type,
                :total_facilities,
                :exposed_facilities,
                :low_risk_count,
                :medium_risk_count,
                :high_risk_count
            )
            ON CONFLICT (analysis_date, district_id, ta_id, facility_type)
            DO UPDATE SET
                district_name = EXCLUDED.district_name,
                ta_name = EXCLUDED.ta_name,
                total_facilities = EXCLUDED.total_facilities,
                exposed_facilities = EXCLUDED.exposed_facilities,
                low_risk_count = EXCLUDED.low_risk_count,
                medium_risk_count = EXCLUDED.medium_risk_count,
                high_risk_count = EXCLUDED.high_risk_count,
                updated_at = CURRENT_TIMESTAMP
            """
        ),
        rows,
    )
    session.commit()

# Compute flood exposure for facilities by sampling the flood raster at their locations, 
# classifying risk levels, and aggregating results by district and TA
def compute_facility_flood_exposure(session, flood_src, boundaries, analysis_date):
    facilities = fetch_facilities_for_flood(session, boundaries)
    if not facilities:
        return {'detail_rows': 0, 'summary_rows': 0, 'by_type': {}}

    ta_name_map = {ta['id']: ta['name'] for ta in boundaries['ta_units']}

    lon_values = [facility['geom'].x for facility in facilities]
    lat_values = [facility['geom'].y for facility in facilities]
    xs, ys = transform('EPSG:4326', flood_src.crs, lon_values, lat_values)

    print(f"Sampling flood risk for {len(facilities)} facilities...")
    sampled_values = []
    for i, sample in enumerate(flood_src.sample(zip(xs, ys))):
        if i % 100 == 0:
            print(f"Sampled {i}/{len(facilities)} facilities...")
        value = sample[0] if sample is not None and len(sample) > 0 else np.nan
        if flood_src.nodata is not None and value == flood_src.nodata:
            value = np.nan
        sampled_values.append(value)
    print("Sampling complete.")

    detail_rows = []
    summary_counter = defaultdict(lambda: {'total': 0, 'exposed': 0, 'low': 0, 'medium': 0, 'high': 0})
    by_type_counter = defaultdict(lambda: {'total': 0, 'exposed': 0, 'low': 0, 'medium': 0, 'high': 0})

    for facility, sampled_value in zip(facilities, sampled_values):
        ta_id = int(facility['ta_id']) if facility.get('ta_id') is not None else 0
        ta_name = ta_name_map.get(ta_id, 'Unknown TA') if ta_id else 'District Total'
        risk_class, is_exposed = _classify_flood_risk(float(sampled_value) if np.isfinite(sampled_value) else np.nan)

        detail_rows.append(
            {
                'analysis_date': analysis_date,
                'district_id': boundaries['district_id'],
                'district_name': boundaries['district_name'],
                'ta_id': ta_id,
                'ta_name': ta_name,
                'facility_type': facility['facility_type'],
                'facility_id': facility['facility_id'],
                'facility_name': facility['facility_name'],
                'flood_value': float(sampled_value) if np.isfinite(sampled_value) else None,
                'risk_class': risk_class,
                'is_exposed': bool(is_exposed),
            }
        )

        district_key = (boundaries['district_id'], 0, 'District Total', facility['facility_type'])
        ta_key = (boundaries['district_id'], ta_id, ta_name, facility['facility_type'])
        for key in [district_key, ta_key]:
            summary_counter[key]['total'] += 1
            if is_exposed:
                summary_counter[key]['exposed'] += 1
            if risk_class == 'low':
                summary_counter[key]['low'] += 1
            elif risk_class == 'medium':
                summary_counter[key]['medium'] += 1
            elif risk_class == 'high':
                summary_counter[key]['high'] += 1

        by_type_counter[facility['facility_type']]['total'] += 1
        if is_exposed:
            by_type_counter[facility['facility_type']]['exposed'] += 1
        if risk_class in {'low', 'medium', 'high'}:
            by_type_counter[facility['facility_type']][risk_class] += 1

    summary_rows = []
    for (district_id, ta_id, ta_name, facility_type), counts in summary_counter.items():
        summary_rows.append(
            {
                'analysis_date': analysis_date,
                'district_id': district_id,
                'district_name': boundaries['district_name'],
                'ta_id': ta_id,
                'ta_name': ta_name,
                'facility_type': facility_type,
                'total_facilities': counts['total'],
                'exposed_facilities': counts['exposed'],
                'low_risk_count': counts['low'],
                'medium_risk_count': counts['medium'],
                'high_risk_count': counts['high'],
            }
        )

    upsert_flood_facility_exposure(session, detail_rows)
    upsert_flood_facility_exposure_summary(session, summary_rows)

    for facility_type, counts in sorted(by_type_counter.items()):
        print(
            f"Facilities {facility_type}: total={counts['total']}, exposed={counts['exposed']}, "
            f"low={counts['low']}, medium={counts['medium']}, high={counts['high']}"
        )

    return {
        'detail_rows': len(detail_rows),
        'summary_rows': len(summary_rows),
        'by_type': dict(by_type_counter),
    }

# Compute population stats for a given geometry by clipping the flood raster
def _compute_population_stats_for_geom(flood_src, pop_src, geom_geojson):
    flood_clip, flood_transform = mask(
        flood_src,
        [geom_geojson],
        crop=True,
        filled=False,
    )

    flood_arr = flood_clip[0].astype("float64")
    if np.ma.isMaskedArray(flood_arr):
        flood_data = flood_arr.filled(np.nan)
    else:
        flood_data = flood_arr

    if flood_data.size == 0:
        return {
            "total_population": 0.0,
            "exposed_population": 0.0,
            "low_risk_population": 0.0,
            "medium_risk_population": 0.0,
            "high_risk_population": 0.0,
        }

    pop_on_flood_grid = np.full(flood_data.shape, np.nan, dtype="float64")
    reproject(
        source=rasterio.band(pop_src, 1),
        destination=pop_on_flood_grid,
        src_transform=pop_src.transform,
        src_crs=pop_src.crs,
        dst_transform=flood_transform,
        dst_crs=flood_src.crs,
        src_nodata=pop_src.nodata,
        dst_nodata=np.nan,
        resampling=Resampling.bilinear,
    )

    in_geom_mask = geometry_mask(
        [geom_geojson],
        out_shape=flood_data.shape,
        transform=flood_transform,
        invert=True,
    )

    valid_pop = np.isfinite(pop_on_flood_grid)
    valid_flood = np.isfinite(flood_data)

    total_mask = in_geom_mask & valid_pop
    total_population = float(np.nansum(pop_on_flood_grid[total_mask]))

    # Categorical intensity: 0=None, 1-2=Low, 3-4=Medium, 5=High
    exposed_mask = total_mask & valid_flood & (flood_data > 0)
    low_mask = total_mask & valid_flood & np.isin(flood_data, [1, 2])
    med_mask = total_mask & valid_flood & np.isin(flood_data, [3, 4])
    high_mask = total_mask & valid_flood & (flood_data == 5)

    # Calculate exposed area in sq km
    # Get pixel size in degrees
    res_x, res_y = flood_src.res

    # Get center latitude for the geometry (or the district)
    # We'll use the bounding box of the clipped area for a local estimate
    left, bottom, right, top = flood_src.bounds
    center_lat = (bottom + top) / 2
    
    # 1 deg lat ~= 111.32 km
    # 1 deg lon ~= 111.32 * cos(rad(lat)) km
    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * np.cos(np.radians(center_lat))
    pixel_area_km2 = abs(res_x * res_y * km_per_deg_lat * km_per_deg_lon)
    
    exposed_pixels = float(np.sum(exposed_mask))
    exposed_area_km2 = exposed_pixels * pixel_area_km2

    return {
        "total_population": total_population,
        "exposed_population": float(np.nansum(pop_on_flood_grid[exposed_mask])),
        "low_risk_population": float(np.nansum(pop_on_flood_grid[low_mask])),
        "medium_risk_population": float(np.nansum(pop_on_flood_grid[med_mask])),
        "high_risk_population": float(np.nansum(pop_on_flood_grid[high_mask])),
        "exposed_area_sq_km": float(exposed_area_km2),
    }

# Store the computed flood exposure stats into the database 
def upsert_flood_zone_rows(session, rows):
    if not rows:
        return

    session.execute(
        text(
            """
            INSERT INTO flood_zones (
                district_id,
                district_name,
                ta_id,
                ta_name,
                total_population,
                exposed_population,
                low_risk_population,
                medium_risk_population,
                high_risk_population,
                exposed_area_sq_km,
                analysis_date
            )
            VALUES (
                :district_id,
                :district_name,
                :ta_id,
                :ta_name,
                :total_population,
                :exposed_population,
                :low_risk_population,
                :medium_risk_population,
                :high_risk_population,
                :exposed_area_sq_km,
                :analysis_date
            )
            ON CONFLICT (district_id, ta_id, analysis_date)
            DO UPDATE SET
                district_name = EXCLUDED.district_name,
                ta_name = EXCLUDED.ta_name,
                total_population = EXCLUDED.total_population,
                exposed_population = EXCLUDED.exposed_population,
                low_risk_population = EXCLUDED.low_risk_population,
                medium_risk_population = EXCLUDED.medium_risk_population,
                high_risk_population = EXCLUDED.high_risk_population,
                exposed_area_sq_km = EXCLUDED.exposed_area_sq_km,
                updated_at = CURRENT_TIMESTAMP
            """
        ),
        rows,
    )
    session.commit()

# Validate that a raster file is readable and has at least one band
def validate_raster_readable(raster_path, strict=False):
    try:
        with rasterio.open(raster_path) as src:
            if src.count < 1:
                return False
            if strict:
                for _, window in src.block_windows(1):
                    _ = src.read(1, window=window)
            else:
                window = ((0, 1), (0, 1))
                _ = src.read(1, window=window)
        return True
    except Exception:
        return False

def _write_preview_png(array, colors, output_png):
    cmap = mcolors.LinearSegmentedColormap.from_list("flood_risk", colors, N=256)
    # The values are 0-5. Map them to 0.0-1.0
    norm_array = array / 5.0
    rgba = cmap(np.clip(np.nan_to_num(norm_array, nan=0.0), 0.0, 1.0))
    rgba[np.isnan(array) | (array == 0), 3] = 0.0
    height, width = array.shape
    fig_width = max(width / 300, 1.0)
    fig_height = max(height / 300, 1.0)
    fig = plt.figure(figsize=(fig_width, fig_height), dpi=300, frameon=False)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.imshow(rgba, interpolation="nearest")
    ax.axis("off")
    fig.savefig(output_png, dpi=300, transparent=True)
    plt.close(fig)

def _save_preview_metadata(output_json, image_name, bounds, legend_label, low_label, high_label, colors):
    metadata = {
        "image": image_name,
        "bounds": bounds,
        "legend": {
            "label": legend_label,
            "lowLabel": low_label,
            "highLabel": high_label,
            "colors": colors,
        },
    }
    with open(output_json, "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)

def _leaflet_bounds_from_union(union_geom):
    minx, miny, maxx, maxy = union_geom.bounds
    return [[float(miny), float(minx)], [float(maxy), float(maxx)]]

def generate_flood_risk_previews(flood_raster_path, district_name, boundaries):
    log_step('previews', f'Generating flood risk raster previews for {district_name}')
    # Use relative path based on the project structure
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.abspath(os.path.join(script_dir, "..", "frontend", "public", "worldpop"))
    os.makedirs(output_dir, exist_ok=True)
    
    district_slug = district_name.lower().replace(" ", "_").replace("(", "").replace(")", "")
    png_name = f"flood_risk_{district_slug}.png"
    json_name = f"flood_risk_{district_slug}.preview.json"
    
    with rasterio.open(flood_raster_path) as src:
        district_geom = boundaries["district_geom"]
        geom_flood_crs = _to_raster_crs(district_geom, "EPSG:4326", src.crs)
        
        flood_clip, flood_transform = mask(
            src,
            [geom_flood_crs],
            crop=True,
            filled=False,
        )
        
        flood_arr = flood_clip[0].astype("float64")
        if np.ma.isMaskedArray(flood_arr):
            flood_data = flood_arr.filled(np.nan)
        else:
            flood_data = flood_arr

    # Map 0 to transparent, 1-2 green, 3-4 orange, 5 red
    colors = ["#ffffff00", "#16a34a", "#15803d", "#fcd34d", "#f59e0b", "#dc2626"]
    _write_preview_png(flood_data, colors, os.path.join(output_dir, png_name))
    
    bounds = _leaflet_bounds_from_union(boundaries["district_geom"])
    _save_preview_metadata(
        os.path.join(output_dir, json_name),
        png_name,
        bounds,
        "Flood Risk Surface",
        "Low Risk",
        "High Risk",
        ["#16a34a", "#f59e0b", "#dc2626"],
    )
    log_step('previews', 'completed raster preview generation')

# Comptute flood exposure stats for the specified district or TA
def run_flood_exposure_analysis(
    session,
    flood_raster_path,
    worldpop_raster_path,
    district_name,
    district_names,
    analysis_date,
):
    run_step(
        step_name='schema_setup_flood_zones',
        user_message_on_error='Failed to prepare flood output table in the database.',
        fn=ensure_flood_zones_table,
        session=session,
    )
    run_step(
        step_name='schema_setup_flood_facilities',
        user_message_on_error='Failed to prepare flood facility output tables in the database.',
        fn=ensure_flood_facility_tables,
        session=session,
    )
    run_step(
        step_name='schema_setup_flood_risk_polygons',
        user_message_on_error='Failed to prepare flood risk polygon table in the database.',
        fn=ensure_flood_risk_polygons_table,
        session=session,
    )
    run_step(
        step_name='build_flood_risk_polygons',
        user_message_on_error='Failed to build flood risk polygons from raster.',
        fn=build_flood_risk_polygons,
        session=session,
        flood_raster_path=flood_raster_path,
        analysis_date=analysis_date,
        source_raster=os.path.basename(flood_raster_path),
    )
    boundaries = run_step(
        step_name='load_boundaries',
        user_message_on_error='Could not load district and TA boundaries. Check district names and boundary data.',
        fn=fetch_district_and_ta_geometries,
        session=session,
        district_name=district_name,
        district_names=district_names,
    )

    rows = []
    processed_count = 0

    log_step('open_rasters', f'opening flood raster: {flood_raster_path}')
    log_step('open_rasters', f'opening worldpop raster: {worldpop_raster_path}')
    with rasterio.open(flood_raster_path) as flood_src, rasterio.open(worldpop_raster_path) as pop_src:
        district_geom_flood_crs = _to_raster_crs(boundaries["district_geom"], "EPSG:4326", flood_src.crs)

        district_stats = _compute_population_stats_for_geom(
            flood_src,
            pop_src,
            district_geom_flood_crs,
        )
        rows.append(
            {
                "district_id": boundaries["district_id"],
                "district_name": boundaries["district_name"],
                "ta_id": 0,
                "ta_name": "District Total",
                "analysis_date": analysis_date,
                **district_stats,
            }
        )
        processed_count += 1
        print(
            f"[1/{1 + len(boundaries['ta_units'])}] Processed district {boundaries['district_name']} "
            f"(total_pop={district_stats['total_population']:.2f}, exposed={district_stats['exposed_population']:.2f})"
        )

        for idx, ta in enumerate(boundaries["ta_units"], start=1):
            ta_geom_flood_crs = _to_raster_crs(ta["geom"], "EPSG:4326", flood_src.crs)
            ta_stats = _compute_population_stats_for_geom(
                flood_src,
                pop_src,
                ta_geom_flood_crs,
            )
            rows.append(
                {
                    "district_id": boundaries["district_id"],
                    "district_name": boundaries["district_name"],
                    "ta_id": ta["id"],
                    "ta_name": ta["name"],
                    "analysis_date": analysis_date,
                    **ta_stats,
                }
            )
            processed_count += 1
            print(
                f"[{idx + 1}/{1 + len(boundaries['ta_units'])}] Processed TA {ta['name']} "
                f"(total_pop={ta_stats['total_population']:.2f}, exposed={ta_stats['exposed_population']:.2f})"
            )

        facility_stats = run_step(
            step_name='compute_facility_exposure',
            user_message_on_error='Could not compute flood exposure for education and health facilities.',
            fn=compute_facility_flood_exposure,
            session=session,
            flood_src=flood_src,
            boundaries=boundaries,
            analysis_date=analysis_date,
        )
        log_step(
            'compute_facility_exposure',
            f"persisted detail_rows={facility_stats['detail_rows']}, summary_rows={facility_stats['summary_rows']}",
        )

    run_step(
        step_name='persist_population_exposure',
        user_message_on_error='Could not save flood population exposure results to the database.',
        fn=upsert_flood_zone_rows,
        session=session,
        rows=rows,
    )

    run_step(
        step_name='generate_previews',
        user_message_on_error='Could not generate flood risk raster previews.',
        fn=generate_flood_risk_previews,
        flood_raster_path=flood_raster_path,
        district_name=district_name,
        boundaries=boundaries,
    )

    return processed_count

# Resolve the WorldPop raster path, either using the provided path or fetching it via API if not provided
def resolve_population_raster_path(worldpop_raster_path, worldpop_year, download_timeout=900, max_attempts=3):
    if worldpop_raster_path:
        if not os.path.exists(worldpop_raster_path):
            raise FileNotFoundError(f"Population raster file not found: {worldpop_raster_path}")
        if not validate_raster_readable(worldpop_raster_path, strict=True):
            raise ValueError(f"Population raster is not readable/corrupted: {worldpop_raster_path}")
        log_step('resolve_worldpop', f'using provided worldpop raster: {worldpop_raster_path}')
        return worldpop_raster_path

    target_dir = os.path.join(os.path.dirname(__file__), 'data', 'worldpop')
    os.makedirs(target_dir, exist_ok=True)

    last_error = None
    for attempt in range(1, max_attempts + 1):
        try:
            log_step('resolve_worldpop', f'fetching via API (attempt {attempt}/{max_attempts})')
            catalog = load_worldpop_catalog()
            selected = select_worldpop_dataset(catalog, year=worldpop_year, iso3='MWI')
            filename = f"mwi_worldpop_{selected['year']}.tif"
            target_path = os.path.join(target_dir, filename)

            # If a prior cached file is corrupted, force a clean download.
            if os.path.exists(target_path) and not validate_raster_readable(target_path, strict=True):
                os.remove(target_path)

            raster_path = download_worldpop_raster(
                selected['raster_url'],
                download_dir=target_dir,
                filename=filename,
                timeout=download_timeout,
            )

            if validate_raster_readable(raster_path, strict=True):
                log_step('resolve_worldpop', f'using downloaded raster: {raster_path}')
                return raster_path

            if os.path.exists(raster_path):
                os.remove(raster_path)
            raise ValueError(f"Downloaded WorldPop raster is corrupted: {raster_path}")
        except Exception as exc:
            last_error = exc
            log_step('resolve_worldpop', f'attempt {attempt} failed: {exc}', level='warning')

    raise RuntimeError(f"Failed to fetch a valid WorldPop raster after {max_attempts} attempts: {last_error}")


# Parse command-line arguments for flood exposure analysis, including paths to flood 
# and population rasters, district names, and analysis date
def parse_args():
    parser = argparse.ArgumentParser(description="Flood exposure analysis for Zomba district and TA units")
    parser.add_argument("--flood-raster", required=True, help="Path to flood hazard GeoTIFF")
    parser.add_argument(
        "--worldpop-raster",
        default=None,
        help="Path to WorldPop GeoTIFF. If omitted, ETL fetches Malawi WorldPop raster automatically.",
    )
    parser.add_argument("--worldpop-year", type=int, default=DEFAULT_WORLDPOP_YEAR)
    parser.add_argument("--worldpop-timeout", type=int, default=900)
    parser.add_argument("--worldpop-max-attempts", type=int, default=3)
    parser.add_argument("--district-name", default="Zomba")
    parser.add_argument("--district-name-list", action="append", help="Additional district names to include")
    parser.add_argument(
        "--analysis-date",
        default=dt.date.today().isoformat(),
        help="Analysis date in YYYY-MM-DD format",
    )
    return parser.parse_args()

# Main function to orchestrate the flood exposure analysis workflow
def main():
    setup_logging()
    args = parse_args()

    try:
        if not os.path.exists(args.flood_raster):
            raise FloodPipelineError(
                user_message=f"Flood raster file was not found: {args.flood_raster}. Check the path and rerun.",
                step_name='validate_flood_raster',
            )

        analysis_date = run_step(
            step_name='parse_analysis_date',
            user_message_on_error='The analysis date is invalid. Use YYYY-MM-DD format (example: 2026-04-18).',
            fn=lambda: dt.date.fromisoformat(args.analysis_date),
        )
        worldpop_raster_path = run_step(
            step_name='resolve_worldpop',
            user_message_on_error='Could not get a usable WorldPop population raster. Check network access or provide --worldpop-raster.',
            fn=resolve_population_raster_path,
            worldpop_raster_path=args.worldpop_raster,
            worldpop_year=args.worldpop_year,
            download_timeout=args.worldpop_timeout,
            max_attempts=args.worldpop_max_attempts,
        )

        log_step('session_setup', 'opening database session')
        session = get_session()
        try:
            processed_count = run_step(
                step_name='run_flood_analysis',
                user_message_on_error='Flood analysis failed during computation. Review the step logs above for details.',
                fn=run_flood_exposure_analysis,
                session=session,
                flood_raster_path=args.flood_raster,
                worldpop_raster_path=worldpop_raster_path,
                district_name=args.district_name,
                district_names=args.district_name_list,
                analysis_date=analysis_date,
            )
            log_step('run_flood_analysis', f'successfully processed {processed_count} geometries')
            print(f"Success: processed {processed_count} geometries and upserted flood exposure results.")
        finally:
            log_step('session_teardown', 'closing database session')
            session.close()
    except FloodPipelineError as exc:
        LOGGER.error(
            "Pipeline failed at step '%s'. %s Original error: %s",
            exc.step_name,
            exc.user_message,
            exc.original_error,
        )
        raise SystemExit(f"Pipeline failed: {exc.user_message}")
    except Exception as exc:
        LOGGER.exception("Unexpected pipeline failure")
        raise SystemExit(
            "Pipeline failed due to an unexpected internal error. "
            "Please check the logs and retry."
        ) from exc


if __name__ == "__main__":
    main()
