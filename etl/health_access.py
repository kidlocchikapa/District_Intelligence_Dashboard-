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

LOGGER = logging.getLogger("etl.health_access")

DEFAULT_HEALTH_ACCESS_DISTANCE_KM = 8.0
DEFAULT_HEALTH_ACCESS_GRID_SIZE_M = 1000.0
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


def _rasterize_grid_values(grid_gdf, value_column, fill_value=np.nan):
    if grid_gdf.empty:
        raise ValueError("No analysis grid cells available for raster generation.")

    bounds = grid_gdf.total_bounds
    minx, miny, maxx, maxy = bounds
    width = max(int(math.ceil((maxx - minx) / DEFAULT_HEALTH_ACCESS_GRID_SIZE_M)), 1)
    height = max(int(math.ceil((maxy - miny) / DEFAULT_HEALTH_ACCESS_GRID_SIZE_M)), 1)
    transform = from_bounds(minx, miny, maxx, maxy, width, height)
    shapes = [
        (geom, float(value))
        for geom, value in zip(grid_gdf.geometry, grid_gdf[value_column])
        if geom is not None and not geom.is_empty and pd.notna(value)
    ]
    array = rasterize(
        shapes,
        out_shape=(height, width),
        transform=transform,
        fill=np.nan if isinstance(fill_value, float) and math.isnan(fill_value) else fill_value,
        dtype="float32",
    )
    return array, transform


def _write_preview_png(array, colors, output_png):
    cmap = mcolors.ListedColormap(colors)
    rgba = cmap(np.nan_to_num(array, nan=0.0))
    rgba[np.isnan(array), 3] = 0
    plt.imsave(output_png, rgba)


def _save_preview_metadata(output_json, image_name, bounds, legend_label, low_label, high_label, colors, render):
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

    grid = _create_analysis_grid(union_gdf, cell_size_m=float(grid_size_m))
    if grid.empty:
        raise ValueError("Could not create an analysis grid for the selected district scope.")
    grid["centroid"] = grid.geometry.centroid

    facilities_proj = facilities.to_crs("EPSG:3857") if not facilities.empty else _empty_geodataframe("EPSG:3857")
    if not facilities_proj.empty:
        buffer_union = facilities_proj.geometry.buffer(float(coverage_distance_km) * 1000.0).unary_union
        grid["buffer_covered"] = grid["centroid"].apply(
            lambda point: 1.0 if buffer_union is not None and not buffer_union.is_empty and point.within(buffer_union) else 0.0
        )
    else:
        grid["buffer_covered"] = 0.0

    network_grid = grid[["cell_id", "geometry"]].copy()
    travel_grid = grid[["cell_id", "geometry"]].copy()
    network_grid["network_distance_km"] = np.nan
    travel_grid["travel_time_min"] = np.nan

    if not beneficiary_network.empty:
        beneficiary_network_proj = beneficiary_network.to_crs("EPSG:3857")
        beneficiary_geom_col = beneficiary_network_proj.geometry.name
        grid_geom_col = grid.geometry.name
        join_cols = [
            "beneficiary_id",
            "network_distance_km",
            "travel_time_min",
            "has_health_facility_access",
            beneficiary_geom_col,
        ]
        joined = gpd.sjoin(
            beneficiary_network_proj[join_cols],
            grid[["cell_id", grid_geom_col]],
            how="left",
            predicate="intersects",
        )
        if not joined.empty:
            network_means = joined.groupby("cell_id")["network_distance_km"].mean()
            travel_means = joined.groupby("cell_id")["travel_time_min"].mean()
            network_grid["network_distance_km"] = network_grid["cell_id"].map(network_means)
            travel_grid["travel_time_min"] = travel_grid["cell_id"].map(travel_means)

    os.makedirs(output_dir, exist_ok=True)
    slug = _slugify_districts(selected_districts)
    bounds = _leaflet_bounds_from_union(union_gdf)

    products = [
        {
            "frame": grid,
            "column": "buffer_covered",
            "name": f"{slug}.health_buffer_8km.preview",
            "colors": ["#f2f0e6", "#2f6f3e"],
            "legend_label": "8 km facility buffer coverage",
            "low_label": "Outside buffer",
            "high_label": "Inside buffer",
            "render": {"transform": "binary", "coverageDistanceKm": float(coverage_distance_km)},
        },
        {
            "frame": network_grid,
            "column": "network_distance_km",
            "name": f"{slug}.health_network_8km.preview",
            "colors": ["#0f766e", "#22c55e", "#fde047", "#f97316", "#b91c1c"],
            "legend_label": "Mean beneficiary road distance to nearest health facility",
            "low_label": "Near",
            "high_label": "Far",
            "render": {"transform": "linear", "coverageDistanceKm": float(coverage_distance_km)},
        },
        {
            "frame": travel_grid,
            "column": "travel_time_min",
            "name": f"{slug}.health_travel_time.preview",
            "colors": ["#1d4ed8", "#38bdf8", "#fde047", "#fb7185", "#7e22ce"],
            "legend_label": "Mean beneficiary travel time to nearest health facility",
            "low_label": "Fast",
            "high_label": "Slow",
            "render": {"transform": "linear", "unit": "minutes"},
        },
    ]

    generated = []
    for product in products:
        frame = product["frame"].copy()
        values = frame[product["column"]]
        if values.notna().any():
            valid = values.dropna().astype(float)
            if product["column"] == "buffer_covered":
                normalized = values.astype(float)
            else:
                upper = np.percentile(valid, 95) if len(valid) > 1 else max(float(valid.iloc[0]), 1.0)
                upper = upper if upper > 0 else 1.0
                normalized = values.astype(float) / upper
                normalized = normalized.clip(lower=0.0, upper=1.0)
                product["render"]["clipMax"] = float(upper)
            frame["_normalized"] = normalized
        else:
            frame["_normalized"] = np.nan

        array, _ = _rasterize_grid_values(frame, "_normalized")
        png_name = f"{product['name']}.png"
        json_name = f"{product['name']}.json"
        png_path = os.path.join(output_dir, png_name)
        json_path = os.path.join(output_dir, json_name)
        _write_preview_png(array, product["colors"], png_path)
        _save_preview_metadata(
            json_path,
            png_name,
            bounds,
            product["legend_label"],
            product["low_label"],
            product["high_label"],
            product["colors"],
            product["render"],
        )
        generated.append({"png": png_path, "json": json_path})

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
