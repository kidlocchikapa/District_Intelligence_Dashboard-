import json
import logging
import math
import os
from datetime import datetime, timezone

import geopandas as gpd
import matplotlib.colors as mcolors
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import rasterio
from geoalchemy2 import Geometry, WKTElement
from sqlalchemy.dialects.postgresql import JSONB
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from shapely.geometry import box
from sqlalchemy import text

from db_utils import log_etl_run
from roads import recompute_beneficiary_facility_travel
from worldpop import DEFAULT_WORLDPOP_YEAR, get_zonal_stats, resolve_worldpop_raster
from analytics import compute_health_2sfca_access, fetch_admin_units_for_analysis
from load import load_analysis_results

LOGGER = logging.getLogger("etl.health_access")

DEFAULT_HEALTH_ACCESS_DISTANCE_KM = 8.0
DEFAULT_HEALTH_ACCESS_GRID_SIZE_M = 250.0
DEFAULT_HEALTH_ACCESS_MIN_RESOLUTION_M = 100.0
DEFAULT_HEALTH_ACCESS_MAX_PIXELS = 4_000_000
DEFAULT_HEALTH_ACCESS_GAUSSIAN_SIGMA_PX = 1.4
DEFAULT_HEALTH_ACCESS_IDW_POWER = 2.0
DEFAULT_HEALTH_ACCESS_IDW_MAX_SAMPLES = 24
DEFAULT_HEALTH_ACCESS_RENDER_DPI = 220
DEFAULT_HEALTH_ACCESS_NODATA = -9999.0
DEFAULT_PREVIEW_OUTPUT_DIR = os.path.join(
    os.path.dirname(__file__), "..", "frontend", "public", "health-access"
)
DISTRICT_GROUPS = {
    "zomba": ["Zomba", "Zomba City"],
    "zomba city": ["Zomba", "Zomba City"],
    "zomba (all)": ["Zomba", "Zomba City"],
    "zomba_all": ["Zomba", "Zomba City"],
}
SPECIAL_DISTRICT_IDS = {
    "zomba": 20,
    "zomba city": 31,
}


def log_step(step_name, message, level="info"):
    log_method = getattr(LOGGER, level, LOGGER.info)
    log_method(f"[{step_name}] {message}")


class HealthAccessError(Exception):
    def __init__(self, user_message, step_name, original_error=None):
        self.user_message = user_message
        self.step_name = step_name
        self.original_error = original_error
        super().__init__(f"{user_message} (step: {step_name})")


def run_step(step_name, user_message_on_error, fn, *args, **kwargs):
    log_step(step_name, "started")
    try:
        result = fn(*args, **kwargs)
    except HealthAccessError:
        raise
    except Exception as exc:
        log_step(step_name, f"failed: {exc}", level="error")
        raise HealthAccessError(user_message_on_error, step_name, exc) from exc
    log_step(step_name, "completed")
    return result


def _normalize_district_names(district_name=None, district_names=None):
    names = []

    def _expand_name(value):
        normalized = str(value or "").strip()
        if not normalized:
            return []
        group = DISTRICT_GROUPS.get(normalized.lower())
        if group:
            return group
        return [normalized]

    if district_name:
        names.extend(_expand_name(district_name))
    for item in district_names or []:
        if item:
            names.extend(_expand_name(item))
    seen = []
    for item in names:
        if item and item not in seen:
            seen.append(item)
    return seen


def _slugify_districts(district_names):
    if not district_names:
        return "malawi"
    slug = "-".join(
        "".join(ch.lower() if ch.isalnum() else "-" for ch in name).strip("-")
        for name in district_names
    )
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "malawi"


def _district_scope_predicate(column_expression, names):
    if not names:
        return "", {}
    return f"WHERE {column_expression} = ANY(:district_names)", {"district_names": names}


def _empty_geodataframe(crs="EPSG:4326"):
    return gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs=crs)


def _resolve_district_scope(session, district_names=None):
    names = district_names or []
    if not names:
        return {"district_names": [], "district_ids": []}

    query = text(
        """
        SELECT id, name
        FROM districts
        WHERE name = ANY(:district_names)
        """
    )
    rows = session.execute(query, {"district_names": names}).mappings().all()
    ids_by_name = {str(row["name"]).strip().lower(): int(row["id"]) for row in rows}
    resolved_ids = []
    for name in names:
        key = str(name).strip().lower()
        district_id = ids_by_name.get(key, SPECIAL_DISTRICT_IDS.get(key))
        if district_id is not None and district_id not in resolved_ids:
            resolved_ids.append(int(district_id))
    return {"district_names": names, "district_ids": resolved_ids}


def ensure_health_access_tables(session):
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS health_facility_access_metrics (
                facility_id BIGINT PRIMARY KEY REFERENCES health_facilities(id) ON DELETE CASCADE,
                coverage_distance_km DOUBLE PRECISION NOT NULL DEFAULT 8,
                worldpop_population_within_buffer DOUBLE PRECISION DEFAULT 0,
                welfare_beneficiaries_within_buffer INTEGER DEFAULT 0,
                welfare_beneficiaries_served_by_8km_network INTEGER DEFAULT 0,
                avg_network_distance_km DOUBLE PRECISION,
                avg_travel_time_min DOUBLE PRECISION,
                metadata JSONB DEFAULT '{}'::jsonb,
                calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_health_facility_access_metrics_calculated_at
            ON health_facility_access_metrics(calculated_at)
            """
        )
    )
    session.commit()


def fetch_district_union(session, district_names=None):
    names = district_names or []
    where_clause, params = _district_scope_predicate("name", names)
    query = text(
        f"""
        SELECT ST_Union(geom) AS geom
        FROM districts
        {where_clause}
        """
    )
    gdf = gpd.read_postgis(query, session.bind, geom_col="geom", params=params or None)
    if gdf.empty or gdf.geometry.iloc[0] is None:
        raise ValueError("No district geometry found for health access preview generation.")
    return gdf.set_crs("EPSG:4326", allow_override=True)


def fetch_health_facility_scope(session, district_names=None):
    names = district_names or []
    scope = _resolve_district_scope(session, names)
    district_ids = scope["district_ids"]
    query = text(
        f"""
        WITH district_union AS (
            SELECT ST_Union(geom) AS geom
            FROM districts
            {"WHERE id = ANY(:district_ids)" if district_ids else ""}
        )
        SELECT
            hf.id AS facility_id,
            COALESCE(hf.name, '') AS facility_name,
            hf.type AS facility_type,
            hf.ownership,
            hf.district_id,
            hf.ta_id,
            hf.doctor_count,
            hf.nurse_midwife_count,
            d.name AS district_name,
            a3.name AS ta_name,
            hf.geom
        FROM health_facilities hf
        LEFT JOIN districts d
          ON d.id = hf.district_id
        LEFT JOIN admin3_units a3
          ON a3.id = hf.ta_id
        CROSS JOIN district_union du
        WHERE hf.geom IS NOT NULL
        {"AND hf.district_id = ANY(:district_ids)" if district_ids else ""}
        {"AND du.geom IS NOT NULL AND ST_Intersects(hf.geom, du.geom)" if district_ids else ""}
        """
    )
    params = {"district_ids": district_ids} if district_ids else None
    facilities = gpd.read_postgis(query, session.bind, geom_col="geom", params=params)

    if district_ids:
        invalid_query = text(
            """
            WITH district_union AS (
                SELECT ST_Union(geom) AS geom
                FROM districts
                WHERE id = ANY(:district_ids)
            )
            SELECT
                hf.id AS facility_id,
                COALESCE(hf.name, '') AS facility_name,
                d.name AS district_name
            FROM health_facilities hf
            LEFT JOIN districts d
              ON d.id = hf.district_id
            CROSS JOIN district_union du
            WHERE hf.geom IS NOT NULL
              AND hf.district_id = ANY(:district_ids)
              AND (du.geom IS NULL OR NOT ST_Intersects(hf.geom, du.geom))
            ORDER BY hf.name
            """
        )
        invalid_rows = session.execute(invalid_query, {"district_ids": district_ids}).mappings().all()
        if invalid_rows:
            preview = ", ".join(row["facility_name"] for row in invalid_rows[:5] if row["facility_name"]) or "unnamed facilities"
            if len(invalid_rows) > 5:
                preview = f"{preview}, +{len(invalid_rows) - 5} more"
            log_step(
                "fetch_health_facility_scope",
                (
                    f"excluded {len(invalid_rows)} facility record(s) whose geometry fell outside "
                    f"the combined district geometry despite matching district_id. Examples: {preview}"
                ),
                level="warning",
            )

    return facilities


def fetch_beneficiary_scope(session, district_names=None):
    names = district_names or []
    scope = _resolve_district_scope(session, names)
    district_ids = scope["district_ids"]
    query = text(
        f"""
        WITH district_union AS (
            SELECT ST_Union(geom) AS geom
            FROM districts
            {"WHERE id = ANY(:district_ids)" if district_ids else ""}
        )
        SELECT
            wb.id AS beneficiary_id,
            wb.household_size,
            wb.geom,
            d.name AS district_name,
            a3.name AS ta_name
        FROM welfare_beneficiary wb
        LEFT JOIN districts d
          ON d.id = wb.district_id
        LEFT JOIN admin3_units a3
          ON a3.id = wb.ta_id
        CROSS JOIN district_union du
        WHERE wb.geom IS NOT NULL
        {"AND wb.district_id = ANY(:district_ids)" if district_ids else ""}
        {"AND du.geom IS NOT NULL AND ST_Intersects(wb.geom, du.geom)" if district_ids else ""}
        """
    )
    return gpd.read_postgis(
        query,
        session.bind,
        geom_col="geom",
        params={"district_ids": district_ids} if district_ids else None,
    )


def fetch_beneficiary_network_scope(session, district_names=None):
    names = district_names or []
    scope = _resolve_district_scope(session, names)
    district_ids = scope["district_ids"]
    query = text(
        f"""
        WITH district_union AS (
            SELECT ST_Union(geom) AS geom
            FROM districts
            {"WHERE id = ANY(:district_ids)" if district_ids else ""}
        )
        SELECT
            wb.id AS beneficiary_id,
            wb.household_size,
            wb.geom,
            d.name AS district_name,
            a3.name AS ta_name,
            travel.facility_id AS nearest_health_facility_id,
            travel.facility_name AS nearest_health_facility_name,
            travel.network_distance_km,
            travel.travel_time_min,
            travel.routing_status,
            CASE
              WHEN travel.routing_status = 'routed'
               AND travel.network_distance_km IS NOT NULL
               AND travel.network_distance_km <= :distance_km
                THEN TRUE
              ELSE FALSE
            END AS has_health_facility_access
        FROM welfare_beneficiary wb
        LEFT JOIN districts d
          ON d.id = wb.district_id
        LEFT JOIN admin3_units a3
          ON a3.id = wb.ta_id
        LEFT JOIN beneficiary_facility_travel travel
          ON travel.beneficiary_id = wb.id
         AND travel.facility_type = 'health'
        CROSS JOIN district_union du
        WHERE wb.geom IS NOT NULL
        {"AND wb.district_id = ANY(:district_ids)" if district_ids else ""}
        {"AND du.geom IS NOT NULL AND ST_Intersects(wb.geom, du.geom)" if district_ids else ""}
        """
    )
    params = {"distance_km": DEFAULT_HEALTH_ACCESS_DISTANCE_KM}
    if district_ids:
        params["district_ids"] = district_ids
    return gpd.read_postgis(query, session.bind, geom_col="geom", params=params)


def _compute_worldpop_buffer_sums(raster_path, buffer_gdf):
    if not raster_path or buffer_gdf.empty:
        return [0.0] * len(buffer_gdf)

    with rasterio.open(raster_path) as src:
        raster_bounds_geom = box(*src.bounds)
        overlap_gdf = buffer_gdf.to_crs(src.crs)
        overlap_mask = overlap_gdf.geometry.intersects(raster_bounds_geom)

    sums = pd.Series(0.0, index=buffer_gdf.index, dtype="float64")
    overlapping = buffer_gdf.loc[overlap_mask].copy()
    if not overlapping.empty:
        overlapping_sums = get_zonal_stats(raster_path, overlapping, stat="sum")
        sums.loc[overlapping.index] = [float(value or 0.0) for value in overlapping_sums]

    non_overlapping = buffer_gdf.loc[~overlap_mask]
    if not non_overlapping.empty:
        names = non_overlapping.get("facility_name", pd.Series(dtype="object")).fillna("").tolist()
        preview = ", ".join(name for name in names[:5] if name) or "unnamed facilities"
        if len(names) > 5:
            preview = f"{preview}, +{len(names) - 5} more"
        log_step(
            "refresh_health_facility_access_metrics",
            (
                f"{len(non_overlapping)} facility buffer(s) did not overlap the raster extent; "
                f"defaulted their WorldPop buffer population to 0. Examples: {preview}"
            ),
            level="warning",
        )

    return sums.tolist()


def refresh_health_facility_access_metrics(
    session,
    raster_path,
    district_names=None,
    coverage_distance_km=DEFAULT_HEALTH_ACCESS_DISTANCE_KM,
):
    ensure_health_access_tables(session)
    facilities = fetch_health_facility_scope(session, district_names=district_names)
    beneficiaries = fetch_beneficiary_scope(session, district_names=district_names)
    beneficiary_network = fetch_beneficiary_network_scope(session, district_names=district_names)

    if facilities.empty:
        session.execute(text("DELETE FROM health_facility_access_metrics"))
        session.commit()
        return 0

    facilities_proj = facilities.to_crs("EPSG:3857")
    buffer_geom = facilities_proj.geometry.buffer(float(coverage_distance_km) * 1000.0)
    buffer_gdf = gpd.GeoDataFrame(
        facilities[["facility_id", "facility_name", "facility_type", "ownership"]].copy(),
        geometry=buffer_geom,
        crs="EPSG:3857",
    ).to_crs("EPSG:4326")

    worldpop_sums = _compute_worldpop_buffer_sums(raster_path, buffer_gdf)
    facilities["worldpop_population_within_buffer"] = [
        float(value or 0.0) for value in worldpop_sums
    ]

    buffer_count_lookup = {}
    if not beneficiaries.empty:
        beneficiaries_proj = beneficiaries.to_crs("EPSG:3857")
        beneficiary_geom_col = beneficiaries_proj.geometry.name
        buffer_proj = gpd.GeoDataFrame(
            buffer_gdf[["facility_id"]].copy(),
            geometry=buffer_gdf.geometry,
            crs=buffer_gdf.crs,
        ).to_crs("EPSG:3857")
        buffer_geom_col = buffer_proj.geometry.name
        buffer_join = gpd.sjoin(
            beneficiaries_proj[["beneficiary_id", beneficiary_geom_col]],
            buffer_proj[["facility_id", buffer_geom_col]],
            how="inner",
            predicate="intersects",
        )
        buffer_count_lookup = (
            buffer_join.groupby("facility_id")["beneficiary_id"].nunique().astype(int).to_dict()
        )

    served_lookup = {}
    avg_lookup = {}
    if not beneficiary_network.empty:
        served = beneficiary_network[
            (beneficiary_network["routing_status"] == "routed")
            & (beneficiary_network["network_distance_km"].fillna(np.inf) <= float(coverage_distance_km))
            & beneficiary_network["nearest_health_facility_id"].notna()
        ].copy()
        if not served.empty:
            served["nearest_health_facility_id"] = served["nearest_health_facility_id"].astype(int)
            served_lookup = (
                served.groupby("nearest_health_facility_id")["beneficiary_id"].nunique().astype(int).to_dict()
            )
            avg_df = served.groupby("nearest_health_facility_id").agg(
                avg_network_distance_km=("network_distance_km", "mean"),
                avg_travel_time_min=("travel_time_min", "mean"),
            )
            avg_lookup = avg_df.to_dict("index")

    records = []
    for _, row in facilities.iterrows():
        facility_id = int(row["facility_id"])
        averages = avg_lookup.get(facility_id, {})
        records.append(
            {
                "facility_id": facility_id,
                "coverage_distance_km": float(coverage_distance_km),
                "worldpop_population_within_buffer": float(
                    row.get("worldpop_population_within_buffer") or 0.0
                ),
                "welfare_beneficiaries_within_buffer": int(buffer_count_lookup.get(facility_id, 0)),
                "welfare_beneficiaries_served_by_8km_network": int(served_lookup.get(facility_id, 0)),
                "avg_network_distance_km": (
                    float(averages["avg_network_distance_km"])
                    if averages.get("avg_network_distance_km") is not None and not pd.isna(averages.get("avg_network_distance_km"))
                    else None
                ),
                "avg_travel_time_min": (
                    float(averages["avg_travel_time_min"])
                    if averages.get("avg_travel_time_min") is not None and not pd.isna(averages.get("avg_travel_time_min"))
                    else None
                ),
                "metadata": {
                    "buffer_rule": f"geometric_buffer_km={coverage_distance_km}",
                    "access_rule": f"network_distance_km<={coverage_distance_km}",
                    "district_names": district_names or [],
                },
            }
        )

    frame = pd.DataFrame(records)
    if frame.empty:
        return 0
    
    if district_names:
        session.execute(
            text(
                """
                DELETE FROM health_facility_access_metrics
                WHERE facility_id IN (
                    SELECT hf.id
                    FROM health_facilities hf
                    JOIN districts d ON d.id = hf.district_id
                    WHERE d.name = ANY(:district_names)
                )
                """
            ),
            {"district_names": district_names},
        )
    else:
        session.execute(text("DELETE FROM health_facility_access_metrics"))
    session.commit()

    frame.to_sql(
        "health_facility_access_metrics",
        session.bind,
        if_exists="append",
        index=False,
        dtype={"metadata": JSONB},
    )
    session.commit()
    return len(frame)


def _create_analysis_grid(union_gdf, cell_size_m=DEFAULT_HEALTH_ACCESS_GRID_SIZE_M):
    union_proj = union_gdf.to_crs("EPSG:3857")
    geom = union_proj.geometry.iloc[0]
    minx, miny, maxx, maxy = geom.bounds
    xs = np.arange(minx, maxx + cell_size_m, cell_size_m)
    ys = np.arange(miny, maxy + cell_size_m, cell_size_m)
    cells = []
    cell_ids = []
    for col_idx in range(len(xs) - 1):
        for row_idx in range(len(ys) - 1):
            cell = box(xs[col_idx], ys[row_idx], xs[col_idx + 1], ys[row_idx + 1])
            if not geom.intersects(cell):
                continue
            clipped = geom.intersection(cell)
            if clipped.is_empty:
                continue
            cells.append(clipped)
            cell_ids.append(f"{col_idx}-{row_idx}")
    if not cells:
        return _empty_geodataframe(crs="EPSG:3857")
    return gpd.GeoDataFrame({"cell_id": cell_ids}, geometry=cells, crs="EPSG:3857")


def _resolve_raster_resolution_m(union_proj, requested_resolution_m):
    geom = union_proj.geometry.iloc[0]
    minx, miny, maxx, maxy = geom.bounds
    requested = max(float(requested_resolution_m), DEFAULT_HEALTH_ACCESS_MIN_RESOLUTION_M)
    width = max(maxx - minx, requested)
    height = max(maxy - miny, requested)
    pixel_count = (width / requested) * (height / requested)
    if pixel_count <= DEFAULT_HEALTH_ACCESS_MAX_PIXELS:
        return requested
    scale = math.sqrt(pixel_count / DEFAULT_HEALTH_ACCESS_MAX_PIXELS)
    return max(requested * scale, requested)


def _build_raster_template(union_gdf, resolution_m):
    union_proj = union_gdf.to_crs("EPSG:3857")
    geom = union_proj.geometry.iloc[0]
    resolution_m = _resolve_raster_resolution_m(union_proj, resolution_m)
    minx, miny, maxx, maxy = geom.bounds
    width = max(int(math.ceil((maxx - minx) / resolution_m)), 1)
    height = max(int(math.ceil((maxy - miny) / resolution_m)), 1)
    transform = from_bounds(minx, miny, maxx, maxy, width, height)
    mask = rasterize(
        [(geom, 1)],
        out_shape=(height, width),
        transform=transform,
        fill=0,
        dtype="uint8",
        all_touched=True,
    ).astype(bool)
    cols = np.arange(width, dtype=np.float32) + 0.5
    rows = np.arange(height, dtype=np.float32) + 0.5
    xs = transform.c + cols * transform.a
    ys = transform.f + rows * transform.e
    xx, yy = np.meshgrid(xs, ys)
    return {
        "projection": union_proj,
        "geometry": geom,
        "bounds_3857": [float(minx), float(miny), float(maxx), float(maxy)],
        "width": width,
        "height": height,
        "transform": transform,
        "mask": mask,
        "xx": xx,
        "yy": yy,
        "resolution_m": float(resolution_m),
    }


def _point_coordinates(geoseries):
    if geoseries.empty:
        return np.empty((0, 2), dtype=np.float32)
    return np.column_stack((geoseries.x.to_numpy(dtype=np.float32), geoseries.y.to_numpy(dtype=np.float32)))


def _aggregate_points_to_raster(points_xy, values, template):
    if len(points_xy) == 0 or len(values) == 0:
        return np.full((template["height"], template["width"]), np.nan, dtype=np.float32)

    transform = template["transform"]
    height = template["height"]
    width = template["width"]
    cols = np.floor((points_xy[:, 0] - transform.c) / transform.a).astype(int)
    rows = np.floor((points_xy[:, 1] - transform.f) / transform.e).astype(int)
    valid = (
        np.isfinite(values)
        & (rows >= 0)
        & (rows < height)
        & (cols >= 0)
        & (cols < width)
    )
    if not np.any(valid):
        return np.full((height, width), np.nan, dtype=np.float32)

    rows = rows[valid]
    cols = cols[valid]
    vals = values[valid].astype(np.float32)
    flat_idx = rows * width + cols
    sums = np.bincount(flat_idx, weights=vals, minlength=height * width).reshape((height, width))
    counts = np.bincount(flat_idx, minlength=height * width).reshape((height, width))
    surface = np.full((height, width), np.nan, dtype=np.float32)
    populated = counts > 0
    surface[populated] = (sums[populated] / counts[populated]).astype(np.float32)
    return surface


def _gaussian_kernel1d(sigma_px):
    sigma_px = max(float(sigma_px), 1e-6)
    radius = max(int(math.ceil(sigma_px * 3)), 1)
    x = np.arange(-radius, radius + 1, dtype=np.float32)
    kernel = np.exp(-(x**2) / (2 * sigma_px**2))
    kernel /= kernel.sum()
    return kernel


def _convolve_axis(array, kernel, axis):
    pad = len(kernel) // 2
    pad_width = [(0, 0)] * array.ndim
    pad_width[axis] = (pad, pad)
    padded = np.pad(array, pad_width, mode="edge")
    return np.apply_along_axis(lambda vec: np.convolve(vec, kernel, mode="valid"), axis, padded)


def _gaussian_smooth_masked(array, valid_mask, sigma_px=DEFAULT_HEALTH_ACCESS_GAUSSIAN_SIGMA_PX):
    if not np.any(valid_mask):
        return np.full(array.shape, np.nan, dtype=np.float32)
    kernel = _gaussian_kernel1d(sigma_px)
    filled = np.where(valid_mask, array, 0.0).astype(np.float32)
    weights = valid_mask.astype(np.float32)
    smooth_values = _convolve_axis(_convolve_axis(filled, kernel, axis=1), kernel, axis=0)
    smooth_weights = _convolve_axis(_convolve_axis(weights, kernel, axis=1), kernel, axis=0)
    result = np.full(array.shape, np.nan, dtype=np.float32)
    with np.errstate(invalid="ignore", divide="ignore"):
        result[smooth_weights > 1e-6] = smooth_values[smooth_weights > 1e-6] / smooth_weights[smooth_weights > 1e-6]
    return result


def _idw_interpolate_surface(seed_surface, template, power=DEFAULT_HEALTH_ACCESS_IDW_POWER, max_samples=DEFAULT_HEALTH_ACCESS_IDW_MAX_SAMPLES):
    valid_mask = np.isfinite(seed_surface) & template["mask"]
    if not np.any(valid_mask):
        return np.full(seed_surface.shape, np.nan, dtype=np.float32)

    source_rows, source_cols = np.where(valid_mask)
    source_values = seed_surface[valid_mask].astype(np.float32)
    source_xy = np.column_stack((template["xx"][valid_mask], template["yy"][valid_mask])).astype(np.float32)
    target_rows, target_cols = np.where(template["mask"] & ~valid_mask)
    result = seed_surface.copy().astype(np.float32)

    if len(target_rows) == 0:
        return result

    max_samples = max(1, min(int(max_samples), len(source_values)))
    chunk_size = 4096
    for start in range(0, len(target_rows), chunk_size):
        stop = min(start + chunk_size, len(target_rows))
        tx = template["xx"][target_rows[start:stop], target_cols[start:stop]].astype(np.float32)
        ty = template["yy"][target_rows[start:stop], target_cols[start:stop]].astype(np.float32)
        dx = source_xy[:, 0][None, :] - tx[:, None]
        dy = source_xy[:, 1][None, :] - ty[:, None]
        distances = np.sqrt(dx * dx + dy * dy)
        nearest_idx = np.argpartition(distances, max_samples - 1, axis=1)[:, :max_samples]
        nearest_dist = np.take_along_axis(distances, nearest_idx, axis=1)
        nearest_vals = source_values[nearest_idx]
        nearest_dist = np.maximum(nearest_dist, 1.0)
        weights = 1.0 / np.power(nearest_dist, power)
        interpolated = np.sum(weights * nearest_vals, axis=1) / np.sum(weights, axis=1)
        result[target_rows[start:stop], target_cols[start:stop]] = interpolated.astype(np.float32)
    return result


def _nearest_distance_surface(points_xy, template):
    if len(points_xy) == 0:
        return np.full((template["height"], template["width"]), np.nan, dtype=np.float32)

    mask_rows, mask_cols = np.where(template["mask"])
    target_x = template["xx"][mask_rows, mask_cols].astype(np.float32)
    target_y = template["yy"][mask_rows, mask_cols].astype(np.float32)
    result = np.full((template["height"], template["width"]), np.nan, dtype=np.float32)
    chunk_size = 4096
    for start in range(0, len(target_x), chunk_size):
        stop = min(start + chunk_size, len(target_x))
        tx = target_x[start:stop]
        ty = target_y[start:stop]
        dx = points_xy[:, 0][None, :] - tx[:, None]
        dy = points_xy[:, 1][None, :] - ty[:, None]
        nearest = np.sqrt(dx * dx + dy * dy).min(axis=1)
        result[mask_rows[start:stop], mask_cols[start:stop]] = nearest.astype(np.float32)
    return result


def _clip_and_normalize(array, mask, clip_percentile=95):
    result = np.full(array.shape, np.nan, dtype=np.float32)
    valid = np.isfinite(array) & mask
    if not np.any(valid):
        return result, None
    values = array[valid].astype(np.float32)
    clip_max = float(np.percentile(values, clip_percentile)) if len(values) > 1 else float(values[0])
    clip_max = clip_max if clip_max > 0 else 1.0
    clipped = np.clip(array, 0.0, clip_max)
    result[valid] = (clipped[valid] / clip_max).astype(np.float32)
    return result, clip_max


def _mask_array(array, mask):
    result = np.full(array.shape, np.nan, dtype=np.float32)
    valid = np.isfinite(array) & mask
    result[valid] = array[valid].astype(np.float32)
    return result


def _write_geotiff(array, transform, output_tif, crs="EPSG:3857"):
    valid = np.isfinite(array)
    raster = np.where(valid, array, DEFAULT_HEALTH_ACCESS_NODATA).astype(np.float32)
    base_profile = {
        "height": raster.shape[0],
        "width": raster.shape[1],
        "count": 1,
        "dtype": "float32",
        "crs": crs,
        "transform": transform,
        "nodata": DEFAULT_HEALTH_ACCESS_NODATA,
    }
    try:
        with rasterio.open(
            output_tif,
            "w",
            driver="COG",
            compress="deflate",
            blocksize=256,
            overview_resampling="average",
            resampling="nearest",
            **base_profile,
        ) as dst:
            dst.write(raster, 1)
    except Exception:
        with rasterio.open(
            output_tif,
            "w",
            driver="GTiff",
            compress="deflate",
            predictor=2,
            tiled=True,
            blockxsize=256,
            blockysize=256,
            **base_profile,
        ) as dst:
            dst.write(raster, 1)


def _write_preview_png(array, colors, output_png):
    cmap = mcolors.LinearSegmentedColormap.from_list("health_access", colors, N=256)
    rgba = cmap(np.clip(np.nan_to_num(array, nan=0.0), 0.0, 1.0))
    rgba[np.isnan(array), 3] = 0.0
    height, width = array.shape
    fig_width = max(width / DEFAULT_HEALTH_ACCESS_RENDER_DPI, 1.0)
    fig_height = max(height / DEFAULT_HEALTH_ACCESS_RENDER_DPI, 1.0)
    fig = plt.figure(figsize=(fig_width, fig_height), dpi=DEFAULT_HEALTH_ACCESS_RENDER_DPI, frameon=False)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.imshow(rgba, interpolation="bicubic")
    ax.axis("off")
    fig.savefig(output_png, dpi=DEFAULT_HEALTH_ACCESS_RENDER_DPI, transparent=True)
    plt.close(fig)


def _save_preview_metadata(output_json, image_name, bounds, legend_label, low_label, high_label, colors, render, geotiff_name=None):
    metadata = {
        "image": image_name,
        "bounds": bounds,
        "legend": {
            "label": legend_label,
            "lowLabel": low_label,
            "highLabel": high_label,
            "colors": colors,
        },
        "render": render,
    }
    if geotiff_name:
        metadata["geotiff"] = geotiff_name
    with open(output_json, "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)


def _leaflet_bounds_from_union(union_gdf):
    wgs84 = union_gdf.to_crs("EPSG:4326")
    minx, miny, maxx, maxy = wgs84.total_bounds
    return [[float(miny), float(minx)], [float(maxy), float(maxx)]]


def generate_health_access_previews(
    session,
    district_name=None,
    district_names=None,
    output_dir=DEFAULT_PREVIEW_OUTPUT_DIR,
    coverage_distance_km=DEFAULT_HEALTH_ACCESS_DISTANCE_KM,
    grid_size_m=DEFAULT_HEALTH_ACCESS_GRID_SIZE_M,
):
    selected_districts = _normalize_district_names(district_name, district_names)
    union_gdf = fetch_district_union(session, district_names=selected_districts)
    facilities = fetch_health_facility_scope(session, district_names=selected_districts)
    beneficiary_network = fetch_beneficiary_network_scope(session, district_names=selected_districts)

    os.makedirs(output_dir, exist_ok=True)
    slug = _slugify_districts(selected_districts)
    bounds = _leaflet_bounds_from_union(union_gdf)
    template = _build_raster_template(union_gdf, float(grid_size_m))
    district_mask = template["mask"]
    smoothing_sigma = max(1.0, 750.0 / template["resolution_m"]) * DEFAULT_HEALTH_ACCESS_GAUSSIAN_SIGMA_PX

    facilities_proj = facilities.to_crs("EPSG:3857") if not facilities.empty else _empty_geodataframe("EPSG:3857")
    facility_xy = _point_coordinates(facilities_proj.geometry) if not facilities_proj.empty else np.empty((0, 2), dtype=np.float32)
    if len(facility_xy):
        facility_distance_m = _nearest_distance_surface(facility_xy, template)
        buffer_surface = np.clip(1.0 - (facility_distance_m / (float(coverage_distance_km) * 1000.0)), 0.0, 1.0)
        buffer_surface = _gaussian_smooth_masked(buffer_surface, district_mask, sigma_px=smoothing_sigma)
        buffer_surface = _mask_array(np.clip(buffer_surface, 0.0, 1.0), district_mask)
    else:
        buffer_surface = np.full((template["height"], template["width"]), np.nan, dtype=np.float32)

    network_surface = np.full((template["height"], template["width"]), np.nan, dtype=np.float32)
    travel_surface = np.full((template["height"], template["width"]), np.nan, dtype=np.float32)
    if not beneficiary_network.empty:
        beneficiary_network_proj = beneficiary_network.to_crs("EPSG:3857")
        beneficiary_xy = _point_coordinates(beneficiary_network_proj.geometry)

        network_seed = _aggregate_points_to_raster(
            beneficiary_xy,
            pd.to_numeric(beneficiary_network_proj["network_distance_km"], errors="coerce").to_numpy(dtype=np.float32),
            template,
        )
        network_surface = _idw_interpolate_surface(network_seed, template)
        network_surface = _gaussian_smooth_masked(network_surface, district_mask, sigma_px=smoothing_sigma)
        network_surface = _mask_array(network_surface, district_mask)

        travel_seed = _aggregate_points_to_raster(
            beneficiary_xy,
            pd.to_numeric(beneficiary_network_proj["travel_time_min"], errors="coerce").to_numpy(dtype=np.float32),
            template,
        )
        travel_surface = _idw_interpolate_surface(travel_seed, template)
        travel_surface = _gaussian_smooth_masked(travel_surface, district_mask, sigma_px=smoothing_sigma)
        travel_surface = _mask_array(travel_surface, district_mask)

    sfca_surface = np.full((template["height"], template["width"]), np.nan, dtype=np.float32)
    admin_units_gdf = fetch_admin_units_for_analysis(session, admin_level='TA')
    if not union_gdf.empty and not admin_units_gdf.empty:
        union_geom = union_gdf.to_crs(admin_units_gdf.crs).geometry.iloc[0]
        intersecting_admin_units = admin_units_gdf[admin_units_gdf.intersects(union_geom)].copy()
        if not intersecting_admin_units.empty:
            sfca_df = run_step(
                "compute_health_2sfca_preview",
                "Failed to compute 2SFCA for preview raster.",
                compute_health_2sfca_access,
                session=session,
                admin_units_gdf=intersecting_admin_units,
                admin_level='TA'
            )
            if not sfca_df.empty and session:
                run_step(
                    "save_health_2sfca_results",
                    "Could not save 2SFCA analysis results to database.",
                    load_analysis_results,
                    session=session,
                    analysis_df=sfca_df
                )
            if not sfca_df.empty:
                sfca_gdf = gpd.GeoDataFrame(sfca_df, geometry='geom', crs=admin_units_gdf.crs).to_crs("EPSG:3857")
                sfca_gdf = sfca_gdf[~sfca_gdf.geometry.isna() & ~sfca_gdf.geometry.is_empty].copy()
                sfca_gdf.geometry = sfca_gdf.geometry.centroid
                sfca_xy = _point_coordinates(sfca_gdf.geometry)
                sfca_vals = pd.to_numeric(sfca_gdf["metric_value"], errors="coerce").to_numpy(dtype=np.float32)
                
                valid_mask = np.isfinite(sfca_vals)
                if np.any(valid_mask):
                    sfca_seed = _aggregate_points_to_raster(
                        sfca_xy[valid_mask],
                        sfca_vals[valid_mask],
                        template,
                    )
                    sfca_surface = _idw_interpolate_surface(sfca_seed, template)
                    sfca_surface = _gaussian_smooth_masked(sfca_surface, district_mask, sigma_px=smoothing_sigma)
                    sfca_surface = _mask_array(sfca_surface, district_mask)

    products = [
        {
            "surface": buffer_surface,
            "name": f"{slug}.health_buffer_8km.preview",
            "colors": ["#b91c1c", "#ef4444", "#f59e0b", "#84cc16", "#166534"],
            "legend_label": "Health facility accessibility within 8 km",
            "low_label": "Lower access",
            "high_label": "Higher access",
            "render": {
                "transform": "continuous",
                "coverageDistanceKm": float(coverage_distance_km),
                "surfaceMethod": "nearest-facility-distance",
                "resolutionM": float(template["resolution_m"]),
                "smoothed": True,
                "maskedToDistrict": True,
            },
        },
        {
            "surface": network_surface,
            "name": f"{slug}.health_network_8km.preview",
            "colors": ["#0d7a73", "#2fb47c", "#9bd93c", "#f9e721", "#f89c20", "#d63f1a"],
            "legend_label": "Mean beneficiary road distance to nearest health facility",
            "low_label": "Near",
            "high_label": "Far",
            "render": {
                "transform": "linear",
                "coverageDistanceKm": float(coverage_distance_km),
                "surfaceMethod": "idw",
                "resolutionM": float(template["resolution_m"]),
                "smoothed": True,
                "maskedToDistrict": True,
            },
        },
        {
            "surface": travel_surface,
            "name": f"{slug}.health_travel_time.preview",
            "colors": ["#2056a8", "#2f89c5", "#7bc8b4", "#f2d06b", "#e97b56", "#b32d3c"],
            "legend_label": "Mean beneficiary travel time to nearest health facility",
            "low_label": "Fast",
            "high_label": "Slow",
            "render": {
                "transform": "linear",
                "unit": "minutes",
                "surfaceMethod": "idw",
                "resolutionM": float(template["resolution_m"]),
                "smoothed": True,
                "maskedToDistrict": True,
            },
        },
        {
            "surface": sfca_surface,
            "name": f"{slug}.health_2sfca.preview",
            "colors": ["#b32d3c", "#e97b56", "#f2d06b", "#7bc8b4", "#2f89c5", "#2056a8"],
            "legend_label": "2SFCA Access Score (staff per 1,000 people)",
            "low_label": "Low Access",
            "high_label": "High Access",
            "render": {
                "transform": "linear",
                "surfaceMethod": "idw",
                "resolutionM": float(template["resolution_m"]),
                "smoothed": True,
                "maskedToDistrict": True,
            },
        },
    ]

    generated = []
    for product in products:
        surface = product["surface"]
        if product["render"]["transform"] == "continuous":
            normalized = _mask_array(np.clip(surface, 0.0, 1.0), district_mask)
        else:
            normalized, upper = _clip_and_normalize(surface, district_mask)
            if upper is not None:
                product["render"]["clipMax"] = float(upper)

        normalized = _mask_array(normalized, district_mask)
        png_name = f"{product['name']}.png"
        json_name = f"{product['name']}.json"
        tif_name = f"{product['name']}.tif"
        png_path = os.path.join(output_dir, png_name)
        json_path = os.path.join(output_dir, json_name)
        tif_path = os.path.join(output_dir, tif_name)
        _write_preview_png(normalized, product["colors"], png_path)
        _write_geotiff(normalized, template["transform"], tif_path)
        _save_preview_metadata(
            json_path,
            png_name,
            bounds,
            product["legend_label"],
            product["low_label"],
            product["high_label"],
            product["colors"],
            product["render"],
            geotiff_name=tif_name,
        )
        generated.append({"png": png_path, "json": json_path, "tif": tif_path})

    return generated


def process_health_access_visualizations(
    session,
    district_name=None,
    district_names=None,
    raster_path=None,
    api_url=None,
    year=DEFAULT_WORLDPOP_YEAR,
    coverage_distance_km=DEFAULT_HEALTH_ACCESS_DISTANCE_KM,
    grid_size_m=DEFAULT_HEALTH_ACCESS_GRID_SIZE_M,
):
    started_at = datetime.now(timezone.utc)
    selected_districts = _normalize_district_names(district_name, district_names)
    resolved_worldpop = None
    if not raster_path:
        resolved_worldpop = run_step(
            "resolve_health_access_worldpop",
            "Could not resolve a WorldPop raster for health access visualizations.",
            resolve_worldpop_raster,
            api_url=api_url,
            year=year,
        )
        raster_path = resolved_worldpop["raster_path"]

    routing_result = run_step(
        "recompute_health_beneficiary_routing",
        "Could not refresh beneficiary health routing.",
        recompute_beneficiary_facility_travel,
        session=session,
        facility_types=["health"],
        strict=False,
    )
    facility_metrics_rows = run_step(
        "refresh_health_facility_access_metrics",
        "Could not compute facility health access metrics.",
        refresh_health_facility_access_metrics,
        session=session,
        raster_path=raster_path,
        district_names=selected_districts,
        coverage_distance_km=coverage_distance_km,
    )
    previews = run_step(
        "generate_health_access_previews",
        "Could not generate health access preview rasters.",
        generate_health_access_previews,
        session=session,
        district_name=district_name,
        district_names=district_names,
        coverage_distance_km=coverage_distance_km,
        grid_size_m=grid_size_m,
    )

    metadata = {
        "district_names": selected_districts,
        "coverage_distance_km": float(coverage_distance_km),
        "grid_size_m": float(grid_size_m),
        "raster_path": raster_path,
        "worldpop_year": resolved_worldpop["year"] if resolved_worldpop else year,
        "preview_assets": previews,
        "routing_result": routing_result,
    }
    run_step(
        "log_health_access_visualizations",
        "Health access visualizations completed but ETL audit logging failed.",
        log_etl_run,
        session=session,
        filename="health_access_visualizations",
        source_type="internal",
        dataset_type="health_access",
        table_name="health_facility_access_metrics",
        rows_read=facility_metrics_rows,
        rows_processed=facility_metrics_rows,
        rows_loaded=facility_metrics_rows,
        rows_flagged=0,
        status="Success",
        metadata=metadata,
        started_at=started_at,
        completed_at=datetime.now(timezone.utc),
    )
    return {
        "dataset_type": "health_access",
        "table_name": "health_facility_access_metrics",
        "rows_read": facility_metrics_rows,
        "rows_processed": facility_metrics_rows,
        "rows_loaded": facility_metrics_rows,
        "rows_flagged": 0,
        "indicators_loaded": len(previews),
    }
