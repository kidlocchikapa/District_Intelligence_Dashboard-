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
