#import necessary libraries for geospatial analysis and database interaction
import logging

import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union
from sqlalchemy import text

from worldpop import get_zonal_stats

#Logger setup for analytics module
LOGGER = logging.getLogger('etl.analytics')

#Exception class for handling errors
class AnalyticsError(Exception):
    def __init__(self, user_message, step_name, original_error=None):
        self.user_message = user_message
        self.step_name = step_name
        self.original_error = original_error
        super().__init__(f"{user_message} (step: {step_name})")

#Helper function to log the start and completion of each step
def log_step(step_name, message, level='info'):
    log_method = getattr(LOGGER, level, LOGGER.info)
    log_method(f"[{step_name}] {message}")

#Wrapper 
def run_step(step_name, user_message_on_error, fn, *args, **kwargs):
    log_step(step_name, 'started')
    try:
        result = fn(*args, **kwargs)
    except AnalyticsError:
        raise
    except Exception as exc:
        log_step(step_name, f"failed: {exc}", level='error')
        raise AnalyticsError(
            user_message=user_message_on_error,
            step_name=step_name,
            original_error=exc,
        ) from exc
    log_step(step_name, 'completed')
    return result

# Define the types of analyses that can be performed
ANALYSIS_TYPES = {
    'education_summary',
    'health_summary',
    'health_population_served',
    'health_2sfca_access',
    'nearest_school_distance',
    'nearest_health_distance',
    'school_service_coverage',
    'health_service_coverage',
}

DEFAULT_HEALTH_2SFCA_CATCHMENT_MIN = 60.0

# Fetch administrative units with optional filtering by admin level (e.g., 'ward', 'district')
def fetch_admin_units_for_analysis(session, admin_level=None):
    query = """
        SELECT id, code, name, type, geom, area_sq_km, population_total
        FROM (
            SELECT
                id,
                code,
                name,
                'District'::VARCHAR AS type,
                geom,
                area_sq_km,
                population_total
            FROM districts
            UNION ALL
            SELECT
                id,
                code,
                name,
                CASE
                    WHEN LOWER(type) = 'ta' THEN 'TA'
                    ELSE INITCAP(type)
                END AS type,
                geom,
                (ST_Area(ST_Transform(geom, 3857)) / 1000000.0) AS area_sq_km,
                COALESCE(population_total, 0)::INTEGER AS population_total
            FROM admin3_units
        ) admin_units
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
            SELECT
                school_id AS id,
                school_name AS name,
                ta_id,
                ta_id AS ward_id,
                district_id,
                student_enrollment_total,
                teacher_count,
                geom
            FROM education_facilities
            WHERE geom IS NOT NULL
        """
    elif table_name == 'health_facilities':
        query = """
            SELECT
                id,
                name,
                ta_id,
                ta_id AS ward_id,
                district_id,
                beds_count,
                patient_visits_total,
                geom
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


def _routing_prerequisites_available(session):
    extension_count = session.execute(
        text("SELECT COUNT(*) FROM pg_extension WHERE extname IN ('postgis', 'pgrouting')")
    ).scalar()
    if int(extension_count or 0) < 2:
        return False

    tables_ready = session.execute(
        text(
            """
            SELECT
                to_regclass('public.road_segments') IS NOT NULL
                AND to_regclass('public.road_vertices') IS NOT NULL AS tables_ready
            """
        )
    ).scalar()
    if not tables_ready:
        return False

    edge_count = session.execute(
        text(
            """
            SELECT COUNT(*)
            FROM road_segments
            WHERE source IS NOT NULL AND target IS NOT NULL AND cost > 0
            """
        )
    ).scalar()
    return int(edge_count or 0) > 0


# Helper function to extract geometry from a row, whether it's a Series or an object with a geometry attribute
def get_row_geometry(row):
    if isinstance(row, pd.Series) and 'geometry' in row.index:
        return row['geometry']
    return getattr(row, 'geometry', None)


def compute_health_2sfca_access(
    session,
    admin_units_gdf,
    catchment_minutes=DEFAULT_HEALTH_2SFCA_CATCHMENT_MIN,
    admin_level=None,
):
    if admin_units_gdf.empty:
        raise ValueError('No administrative units available for health_2sfca_access')
    if not _routing_prerequisites_available(session):
        raise ValueError('Routing prerequisites missing for health_2sfca_access')

    query = text(
        """
        WITH admin_units AS (
            SELECT
                id,
                code,
                name,
                type,
                population_total,
                geom,
                ST_PointOnSurface(geom) AS centroid
            FROM (
                SELECT
                    id,
                    code,
                    name,
                    'District'::VARCHAR AS type,
                    population_total,
                    geom
                FROM districts
                UNION ALL
                SELECT
                    id,
                    code,
                    name,
                    CASE
                        WHEN LOWER(type) = 'ta' THEN 'TA'
                        ELSE INITCAP(type)
                    END AS type,
                    population_total,
                    geom
                FROM admin3_units
            ) admin_units
            WHERE geom IS NOT NULL
              AND (:admin_level IS NULL OR LOWER(type) = LOWER(:admin_level))
        ),
        admin_nodes AS (
            SELECT
                au.id AS admin_unit_id,
                au.population_total,
                v.id AS admin_node
            FROM admin_units au
            LEFT JOIN LATERAL (
                SELECT id, geom
                FROM road_vertices
                ORDER BY au.centroid <-> geom
                LIMIT 1
            ) v ON TRUE
            WHERE v.id IS NOT NULL
        ),
        facility_nodes AS (
            SELECT
                hf.id AS facility_id,
                COALESCE(hf.doctor_count, 0) + COALESCE(hf.nurse_midwife_count, 0) AS staff_count,
                v.id AS facility_node
            FROM health_facilities hf
            LEFT JOIN LATERAL (
                SELECT id, geom
                FROM road_vertices
                ORDER BY hf.geom <-> geom
                LIMIT 1
            ) v ON TRUE
            WHERE hf.geom IS NOT NULL AND v.id IS NOT NULL
        ),
        reachable AS (
            SELECT
                f.facility_id,
                f.staff_count,
                a.admin_unit_id,
                a.population_total
            FROM facility_nodes f
            JOIN LATERAL (
                SELECT *
                FROM pgr_drivingDistance(
                    'SELECT id, source, target, cost, reverse_cost FROM road_segments WHERE source IS NOT NULL AND target IS NOT NULL AND cost > 0',
                    f.facility_node,
                    :catchment_minutes,
                    directed := true
                )
            ) dd ON TRUE
            JOIN admin_nodes a ON a.admin_node = dd.node
        ),
        facility_demand AS (
            SELECT
                facility_id,
                staff_count,
                SUM(population_total) AS catchment_population
            FROM reachable
            GROUP BY facility_id, staff_count
        ),
        facility_ratio AS (
            SELECT
                facility_id,
                CASE
                    WHEN catchment_population > 0
                        THEN staff_count / catchment_population
                    ELSE 0
                END AS supply_ratio
            FROM facility_demand
        ),
        admin_access AS (
            SELECT
                r.admin_unit_id,
                SUM(fr.supply_ratio) AS access_score
            FROM reachable r
            JOIN facility_ratio fr ON fr.facility_id = r.facility_id
            GROUP BY r.admin_unit_id
        )
        SELECT
            a.admin_unit_id,
            COALESCE(aa.access_score, 0) AS access_score
        FROM admin_nodes a
        LEFT JOIN admin_access aa ON aa.admin_unit_id = a.admin_unit_id
        """
    )

    rows = session.execute(
        query,
        {
            'catchment_minutes': float(catchment_minutes),
            'admin_level': admin_level,
        },
    ).mappings().all()

    access_lookup = {
        int(row['admin_unit_id']): float(row['access_score'] or 0.0)
        for row in rows
    }

    records = []
    for _, admin_row in admin_units_gdf.iterrows():
        access_score = access_lookup.get(int(admin_row['id']), 0.0)
        access_per_1000 = access_score * 1000.0
        records.append(
            analysis_record(
                analysis_type='health_2sfca_access',
                admin_row=admin_row,
                metric_name='health_2sfca_access_score',
                metric_value=float(access_per_1000),
                metric_unit='staff_per_1000_people',
                metadata={
                    'method': '2sfca_classic',
                    'catchment_minutes': float(catchment_minutes),
                    'supply_metric': 'doctor_count+nurse_midwife_count',
                    'travel_metric': 'road_travel_time_min',
                },
            )
        )

    return pd.DataFrame(records)

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

# Calculate the percentage of each administrative unit's area that is covered by facilities within a specified distance
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
def compute_health_population_served(admin_units_gdf, health_gdf, raster_path, coverage_distance_km=8.0):
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

#Calculate health facility counts, bed counts, patient visits, and related metrics for each administrative unit
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

# Helper function to create a standardized analysis record for a given administrative unit and metric, including geometry and metadata
def analysis_record(analysis_type, admin_row, metric_name, metric_value, metric_unit, metadata=None):
    return {
        'analysis_type': analysis_type,
        'admin_unit_id': int(admin_row['id']),
        'admin_unit_code': admin_row.get('code'),
        'admin_unit_name': admin_row['name'],
        'admin_unit_type': admin_row['type'],
        'metric_name': metric_name,
        'metric_value': metric_value,
        'metric_unit': metric_unit,
        'geom': get_row_geometry(admin_row),
        'metadata': metadata or {},
    }

# Calculate education-related metrics for each administrative unit, including school 
# counts, enrollment, teacher counts, and population coverage, and return a DataFrame with the results
def compute_education_summary(admin_units_gdf, schools_gdf, school_age_lookup=None, child_population_lookup=None, admin_level=None):
    if schools_gdf.empty:
        raise ValueError('No schools available for education_summary')

    admin_units = admin_units_gdf.copy()
    selected_level = (admin_level or '').lower()
    if selected_level == 'ta':
        join_column = 'ta_id'
    elif selected_level == 'ward':
        join_column = 'ward_id'
    else:
        join_column = 'district_id'

    grouped = schools_gdf.groupby(join_column, dropna=True).agg(
        school_count=('id', 'count'),
        student_enrollment_total=('student_enrollment_total', 'sum'),
        teacher_count_total=('teacher_count', 'sum'),
    )

    records = []
    for _, admin_row in admin_units.iterrows():
        metrics = grouped.loc[admin_row['id']] if admin_row['id'] in grouped.index else None
        school_count = float(metrics['school_count']) if metrics is not None and pd.notna(metrics['school_count']) else 0.0
        student_enrollment_total = float(metrics['student_enrollment_total']) if metrics is not None and pd.notna(metrics['student_enrollment_total']) else 0.0
        teacher_count_total = float(metrics['teacher_count_total']) if metrics is not None and pd.notna(metrics['teacher_count_total']) else 0.0
        population_total = float(admin_row.get('population_total') or 0)
        code_lookup = (school_age_lookup or {}).get('by_code', {})
        name_lookup = (school_age_lookup or {}).get('by_name', {})
        school_age_population_total = float(
            code_lookup.get(admin_row.get('code'))
            or name_lookup.get(str(admin_row.get('name', '')).strip().lower())
            or 0.0
        )
        child_code_lookup = (child_population_lookup or {}).get('by_code', {})
        child_name_lookup = (child_population_lookup or {}).get('by_name', {})
        child_population_total = float(
            child_code_lookup.get(admin_row.get('code'))
            or child_name_lookup.get(str(admin_row.get('name', '')).strip().lower())
            or 0.0
        )
        school_age_population_unenrolled = max(school_age_population_total - student_enrollment_total, 0.0)
        child_population_unenrolled = max(child_population_total - student_enrollment_total, 0.0)

        metric_set = {
            'school_count': (school_count, 'count'),
            'student_enrollment_total': (student_enrollment_total, 'students'),
            'teacher_count_total': (teacher_count_total, 'teachers'),
            'school_age_population_total': (school_age_population_total, 'people'),
            'school_age_population_unenrolled': (school_age_population_unenrolled, 'people'),
            'child_population_total': (child_population_total, 'people'),
            'child_population_unenrolled': (child_population_unenrolled, 'people'),
            'schools_per_1000_population': ((school_count * 1000 / population_total) if population_total else 0.0, 'per_1000_people'),
            'teachers_per_100_students': ((teacher_count_total * 100 / student_enrollment_total) if student_enrollment_total else 0.0, 'per_100_students'),
            'school_age_population_per_school': ((school_age_population_total / school_count) if school_count else 0.0, 'people_per_school'),
            'enrollment_to_school_age_pct': ((student_enrollment_total * 100 / school_age_population_total) if school_age_population_total else 0.0, 'percent'),
            'child_population_per_school': ((child_population_total / school_count) if school_count else 0.0, 'people_per_school'),
            'enrollment_to_child_population_pct': ((student_enrollment_total * 100 / child_population_total) if child_population_total else 0.0, 'percent'),
        }

        for metric_name, (metric_value, metric_unit) in metric_set.items():
            records.append(
                analysis_record(
                    analysis_type='education_summary',
                    admin_row=admin_row,
                    metric_name=metric_name,
                    metric_value=float(metric_value),
                    metric_unit=metric_unit,
                )
            )

    return pd.DataFrame(records)

# Main function to run selected spatial analyses based on provided parameters, fetching necessary data and computing 
# results for each analysis type, and returning a combined DataFrame with all results
def run_spatial_analyses(session, analysis_types=None, admin_level=None, coverage_distance_km=5.0, raster_path=None):
    try:
        selected_types = set(analysis_types or ANALYSIS_TYPES)
        unknown_types = selected_types - ANALYSIS_TYPES
        if unknown_types:
            raise AnalyticsError(
                user_message=f'Unsupported analysis types requested: {sorted(unknown_types)}.',
                step_name='validate_analysis_types',
            )

        log_step('run_spatial_analyses', f'selected_types={sorted(selected_types)}, admin_level={admin_level}')
        admin_units_gdf = run_step(
            step_name='fetch_admin_units_for_analysis',
            user_message_on_error='Could not load administrative boundaries for analysis.',
            fn=fetch_admin_units_for_analysis,
            session=session,
            admin_level=admin_level,
        )
        if admin_units_gdf.empty:
            raise AnalyticsError(
                user_message='No administrative boundaries with geometry were found for analysis.',
                step_name='fetch_admin_units_for_analysis',
            )

        outputs = []
        if 'education_summary' in selected_types or 'nearest_school_distance' in selected_types or 'school_service_coverage' in selected_types:
            schools = run_step(
                step_name='fetch_education_facilities',
                user_message_on_error='Could not load education facilities for analysis.',
                fn=fetch_facilities,
                session=session,
                table_name='education_facilities',
            )
            if 'education_summary' in selected_types:
                school_age_lookup = run_step(
                    step_name='fetch_school_age_lookup',
                    user_message_on_error='Could not load school-age population indicators from unified indicators.',
                    fn=fetch_indicator_lookup,
                    session=session,
                    dataset_type='worldpop',
                    indicator_name='school_age_population_total',
                    geographic_level=(admin_level or '').lower() or None,
                )
                child_population_lookup = run_step(
                    step_name='fetch_child_population_lookup',
                    user_message_on_error='Could not load child population indicators from unified indicators.',
                    fn=fetch_indicator_lookup,
                    session=session,
                    dataset_type='worldpop',
                    indicator_name='child_population_total',
                    geographic_level=(admin_level or '').lower() or None,
                )
                outputs.append(
                    run_step(
                        step_name='compute_education_summary',
                        user_message_on_error='Could not compute education summary metrics.',
                        fn=compute_education_summary,
                        admin_units_gdf=admin_units_gdf,
                        schools_gdf=schools,
                        school_age_lookup=school_age_lookup,
                        child_population_lookup=child_population_lookup,
                        admin_level=admin_level,
                    )
                )
            if 'nearest_school_distance' in selected_types:
                outputs.append(
                    run_step(
                        step_name='compute_nearest_school_distance',
                        user_message_on_error='Could not compute nearest school distance metrics.',
                        fn=compute_nearest_facility_distance,
                        admin_units_gdf=admin_units_gdf,
                        facilities_gdf=schools,
                        analysis_type='nearest_school_distance',
                        metric_name='nearest_school_distance_km',
                    )
                )
            if 'school_service_coverage' in selected_types:
                outputs.append(
                    run_step(
                        step_name='compute_school_service_coverage',
                        user_message_on_error='Could not compute school service coverage metrics.',
                        fn=compute_service_coverage,
                        admin_units_gdf=admin_units_gdf,
                        facilities_gdf=schools,
                        analysis_type='school_service_coverage',
                        metric_name='school_service_coverage_pct',
                        coverage_distance_km=coverage_distance_km,
                    )
                )

        if (
            'health_summary' in selected_types
            or 'health_population_served' in selected_types
            or 'health_2sfca_access' in selected_types
            or 'nearest_health_distance' in selected_types
            or 'health_service_coverage' in selected_types
        ):
            health = run_step(
                step_name='fetch_health_facilities',
                user_message_on_error='Could not load health facilities for analysis.',
                fn=fetch_facilities,
                session=session,
                table_name='health_facilities',
            )
            if 'health_summary' in selected_types:
                outputs.append(
                    run_step(
                        step_name='compute_health_summary',
                        user_message_on_error='Could not compute health summary metrics.',
                        fn=compute_health_summary,
                        admin_units_gdf=admin_units_gdf,
                        health_gdf=health,
                        admin_level=admin_level,
                    )
                )
            if 'health_population_served' in selected_types:
                outputs.append(
                    run_step(
                        step_name='compute_health_population_served',
                        user_message_on_error='Could not compute health population served metrics.',
                        fn=compute_health_population_served,
                        admin_units_gdf=admin_units_gdf,
                        health_gdf=health,
                        raster_path=raster_path,
                        coverage_distance_km=coverage_distance_km,
                    )
                )
            if 'health_2sfca_access' in selected_types:
                outputs.append(
                    run_step(
                        step_name='compute_health_2sfca_access',
                        user_message_on_error='Could not compute health 2SFCA access metrics.',
                        fn=compute_health_2sfca_access,
                        session=session,
                        admin_units_gdf=admin_units_gdf,
                        admin_level=admin_level,
                    )
                )
            if 'nearest_health_distance' in selected_types:
                outputs.append(
                    run_step(
                        step_name='compute_nearest_health_distance',
                        user_message_on_error='Could not compute nearest health distance metrics.',
                        fn=compute_nearest_facility_distance,
                        admin_units_gdf=admin_units_gdf,
                        facilities_gdf=health,
                        analysis_type='nearest_health_distance',
                        metric_name='nearest_health_distance_km',
                    )
                )
            if 'health_service_coverage' in selected_types:
                outputs.append(
                    run_step(
                        step_name='compute_health_service_coverage',
                        user_message_on_error='Could not compute health service coverage metrics.',
                        fn=compute_service_coverage,
                        admin_units_gdf=admin_units_gdf,
                        facilities_gdf=health,
                        analysis_type='health_service_coverage',
                        metric_name='health_service_coverage_pct',
                        coverage_distance_km=coverage_distance_km,
                    )
                )

        return pd.concat(outputs, ignore_index=True) if outputs else pd.DataFrame()
    except AnalyticsError:
        raise
    except Exception as exc:
        raise AnalyticsError(
            user_message='Spatial analysis failed during processing.',
            step_name='run_spatial_analyses',
            original_error=exc,
        ) from exc
