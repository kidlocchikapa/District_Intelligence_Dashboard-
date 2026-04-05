#import necessary libraries for geospatial analysis and database interaction
import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union
from sqlalchemy import text

from worldpop import get_zonal_stats

# Define the types of analyses that can be performed
ANALYSIS_TYPES = {
    'disaster_vulnerability',
    'education_summary',
    'health_summary',
    'health_population_served',
    'nearest_school_distance',
    'nearest_health_distance',
    'school_service_coverage',
    'health_service_coverage',
}

# Fetch administrative units with optional filtering by admin level (e.g., 'ward', 'district')
def fetch_admin_units_for_analysis(session, admin_level=None):
    query = """
        SELECT id, code, name, type, geom, area_sq_km, population_total
        FROM administrative_units
        WHERE geom IS NOT NULL
    """
    params = {}
    if admin_level:
        query += " AND LOWER(type) = LOWER(:admin_level)"
        params['admin_level'] = admin_level

    return gpd.read_postgis(text(query), session.bind, geom_col='geom', params=params)

# Fetch facilities (education or health) with relevant attributes for analysis
def fetch_facilities(session, table_name):
    if table_name == 'education_facilities':
        query = """
            SELECT school_id AS id, name, ward_id, district_id, student_enrollment_total, teacher_count, geom
            FROM education_facilities
            WHERE geom IS NOT NULL
        """
    elif table_name == 'health_facilities':
        query = """
            SELECT id, name, ward_id, district_id, beds_count, patient_visits_total, geom
            FROM health_facilities
            WHERE geom IS NOT NULL
        """
    else:
        query = f"""
            SELECT id, name, geom
            FROM {table_name}
            WHERE geom IS NOT NULL
        """

    return gpd.read_postgis(text(query), session.bind, geom_col='geom')

# Fetch indicator values for a specific dataset type and indicator name, with optional filtering by geographic level
def fetch_indicator_lookup(session, dataset_type, indicator_name, geographic_level=None):
    query = """
        SELECT DISTINCT ON (COALESCE(geographic_code, geographic_name))
            geographic_code,
            geographic_name,
            indicator_value
        FROM unified_indicators
        WHERE dataset_type = :dataset_type
          AND indicator_name = :indicator_name
    """
    params = {
        'dataset_type': dataset_type,
        'indicator_name': indicator_name,
    }
    if geographic_level:
        query += " AND LOWER(geographic_level) = LOWER(:geographic_level)"
        params['geographic_level'] = geographic_level

    query += """
        ORDER BY COALESCE(geographic_code, geographic_name), calculated_at DESC, id DESC
    """

    rows = session.execute(text(query), params).mappings().all()
    return {
        'by_code': {
            row['geographic_code']: float(row['indicator_value'])
            for row in rows
            if row['geographic_code']
        },
        'by_name': {
            str(row['geographic_name']).strip().lower(): float(row['indicator_value'])
            for row in rows
            if row['geographic_name']
        },
    }

# Ensure that the geometries used for analysis are representative points (centroids) of the administrative units
def ensure_analysis_geometries(admin_units_gdf):
    working = admin_units_gdf.copy()
    working['centroid'] = working.geometry.representative_point()
    return working


# Helper function to extract geometry from a row, whether it's a Series or an object with a geometry attribute
def get_row_geometry(row):
    if isinstance(row, pd.Series) and 'geometry' in row.index:
        return row['geometry']
    return getattr(row, 'geometry', None)

#calculate the distance from each administrative unit to the nearest facility and return a DataFrame with the results
def compute_nearest_facility_distance(admin_units_gdf, facilities_gdf, analysis_type, metric_name):
    admin_units = ensure_analysis_geometries(admin_units_gdf)
    admin_proj = admin_units.to_crs('EPSG:3857')
    facilities_proj = facilities_gdf.to_crs('EPSG:3857')

    if facilities_proj.empty:
        raise ValueError(f'No facilities available for {analysis_type}')

    facility_union = unary_union(facilities_proj.geometry.tolist())
    records = []

    for _, row in admin_proj.iterrows():
        centroid = row['centroid']
        distance_km = centroid.distance(facility_union) / 1000
        records.append(
            analysis_record(
                analysis_type=analysis_type,
                admin_row=row,
                metric_name=metric_name,
                metric_value=float(distance_km),
                metric_unit='km',
            )
        )

    return pd.DataFrame(records)

# Calculate the percentage of each administrative unit's area that is covered by facilities within a specified distance and return a DataFrame with the results
def compute_service_coverage(admin_units_gdf, facilities_gdf, analysis_type, metric_name, coverage_distance_km=5.0):
    admin_proj = admin_units_gdf.to_crs('EPSG:3857')
    facilities_proj = facilities_gdf.to_crs('EPSG:3857')

    if facilities_proj.empty:
        raise ValueError(f'No facilities available for {analysis_type}')

    buffer_union = unary_union(facilities_proj.buffer(coverage_distance_km * 1000).tolist())
    records = []
    admin_geom_col = admin_proj.geometry.name

    for _, row in admin_proj.iterrows():
        row_geom = row.get(admin_geom_col)
        area = row_geom.area if row_geom is not None else 0
        covered = row_geom.intersection(buffer_union).area if row_geom is not None and not row_geom.is_empty else 0
        coverage_pct = (covered / area * 100) if area else 0
        records.append(
            analysis_record(
                analysis_type=analysis_type,
                admin_row=row,
                metric_name=metric_name,
                metric_value=float(coverage_pct),
                metric_unit='percent',
                metadata={'coverage_distance_km': coverage_distance_km},
            )
        )

    return pd.DataFrame(records)

#Calculate the population served by health facilities within a specified adminstrative unit
def compute_health_population_served(admin_units_gdf, health_gdf, raster_path, coverage_distance_km=5.0):
    if health_gdf.empty:
        raise ValueError('No health facilities available for health_population_served')
    if not raster_path:
        raise ValueError('A WorldPop raster path is required for health_population_served')

    admin_proj = admin_units_gdf.to_crs('EPSG:3857')
    health_proj = health_gdf.to_crs('EPSG:3857')
    buffer_union = unary_union(health_proj.buffer(coverage_distance_km * 1000).tolist())

    served_polygons = []
    served_indices = []
    served_admin_rows = []
    admin_geom_col = admin_proj.geometry.name

    for _, admin_row in admin_proj.iterrows():
        admin_geom = admin_row.get(admin_geom_col)
        served_geom = admin_geom.intersection(buffer_union) if admin_geom is not None and not admin_geom.is_empty else None
        if served_geom is None or served_geom.is_empty:
            continue
        served_indices.append(admin_row['id'])
        served_admin_rows.append(admin_row)
        served_polygons.append(served_geom)

    served_lookup = {}
    if served_polygons:
        served_gdf = gpd.GeoDataFrame(
            {'admin_unit_id': served_indices},
            geometry=served_polygons,
            crs='EPSG:3857',
        ).to_crs('EPSG:4326')
        served_stats = get_zonal_stats(raster_path, served_gdf, stat='sum')
        served_lookup = {admin_id: float(value) for admin_id, value in zip(served_indices, served_stats)}

    records = []
    for _, admin_row in admin_proj.iterrows():
        population_total = float(admin_row.get('population_total') or 0)
        served_population = served_lookup.get(admin_row['id'], 0.0)
        unserved_population = max(population_total - served_population, 0.0)
        served_pct = (served_population * 100 / population_total) if population_total else 0.0
        unserved_pct = max(100.0 - served_pct, 0.0) if population_total else 0.0

        metrics = {
            'health_population_served_total': (served_population, 'people'),
            'health_population_served_pct': (served_pct, 'percent'),
            'health_population_unserved_total': (unserved_population, 'people'),
            'health_population_unserved_pct': (unserved_pct, 'percent'),
        }

        for metric_name, (metric_value, metric_unit) in metrics.items():
            records.append(
                analysis_record(
                    analysis_type='health_population_served',
                    admin_row=admin_row,
                    metric_name=metric_name,
                    metric_value=float(metric_value),
                    metric_unit=metric_unit,
                    metadata={'coverage_distance_km': coverage_distance_km},
                )
            )

    return pd.DataFrame(records)

#Calculate health facility counts, bed counts, patient visits, and related metrics for each administrative unit and return a DataFrame with the results
def compute_health_summary(admin_units_gdf, health_gdf, admin_level=None):
    if health_gdf.empty:
        raise ValueError('No health facilities available for health_summary')

    admin_units = admin_units_gdf.copy()
    admin_proj = admin_units.to_crs('EPSG:3857')
    health_proj = health_gdf.to_crs('EPSG:3857').rename(columns={'id': 'facility_id'})
    admin_geom_col = admin_proj.geometry.name
    admin_join = admin_proj[['id', admin_geom_col]].rename(columns={'id': 'admin_unit_id'})

    spatial_matches = gpd.sjoin(
        health_proj,
        admin_join,
        how='left',
        predicate='intersects',
    ).drop_duplicates(subset='facility_id')

    grouped = spatial_matches.groupby('admin_unit_id', dropna=True).agg(
        facility_count=('facility_id', 'count'),
        beds_count_total=('beds_count', 'sum'),
        patient_visits_total=('patient_visits_total', 'sum'),
    )

    records = []
    for _, admin_row in admin_units.iterrows():
        metrics = grouped.loc[admin_row['id']] if admin_row['id'] in grouped.index else None
        facility_count = float(metrics['facility_count']) if metrics is not None and pd.notna(metrics['facility_count']) else 0.0
        beds_count_total = float(metrics['beds_count_total']) if metrics is not None and pd.notna(metrics['beds_count_total']) else 0.0
        patient_visits_total = float(metrics['patient_visits_total']) if metrics is not None and pd.notna(metrics['patient_visits_total']) else 0.0
        population_total = float(admin_row.get('population_total') or 0)

        metric_set = {
            'health_facility_count': (facility_count, 'count'),
            'beds_count_total': (beds_count_total, 'beds'),
            'patient_visits_total': (patient_visits_total, 'visits'),
            'health_facilities_per_1000_population': ((facility_count * 1000 / population_total) if population_total else 0.0, 'per_1000_people'),
            'beds_per_1000_population': ((beds_count_total * 1000 / population_total) if population_total else 0.0, 'per_1000_people'),
        }

        for metric_name, (metric_value, metric_unit) in metric_set.items():
            records.append(
                analysis_record(
                    analysis_type='health_summary',
                    admin_row=admin_row,
                    metric_name=metric_name,
                    metric_value=float(metric_value),
                    metric_unit=metric_unit,
                )
            )

    return pd.DataFrame(records)
