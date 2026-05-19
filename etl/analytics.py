import logging
import time

import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

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
    'education_standards_compliance',
    'education_catchment_access',
    'education_flood_isolation',
    'education_welfare_vulnerability',
    'school_capacity_risk',
}

DEFAULT_HEALTH_2SFCA_CATCHMENT_MIN = 60.0
BOUNDARY_FETCH_MAX_RETRIES = 3
BOUNDARY_FETCH_RETRY_DELAY_SECONDS = 2


def _read_postgis_with_retry(session, query, params=None, geom_col='geom'):
    params = params or {}

    for attempt in range(1, BOUNDARY_FETCH_MAX_RETRIES + 1):
        try:
            return gpd.read_postgis(text(query), session.bind, geom_col=geom_col, params=params)
        except OperationalError as exc:
            session.rollback()
            if attempt == BOUNDARY_FETCH_MAX_RETRIES:
                raise

            log_step(
                'read_postgis_with_retry',
                (
                    f'database connection dropped during boundary fetch; '
                    f'retrying ({attempt}/{BOUNDARY_FETCH_MAX_RETRIES})'
                ),
                level='warning',
            )
            time.sleep(BOUNDARY_FETCH_RETRY_DELAY_SECONDS * attempt)

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

    return _read_postgis_with_retry(session, query, params=params, geom_col='geom')

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

# Fetch indicator values for a specific dataset type and indicator name, with optional filtering
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

# Check if the necessary routing prerequisites (PostGIS, pgRouting, and road network data) are available
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


# Helper function to extract geometry from a row
def get_row_geometry(row):
    if isinstance(row, pd.Series):
        if 'geometry' in row.index:
            return row['geometry']
        if 'geom' in row.index:
            return row['geom']
    return getattr(row, 'geometry', getattr(row, 'geom', None))

# Calculate the 2SFCA access score for health facilities for each administrative unit
def compute_health_2sfca_access(
    session,
    admin_units_gdf,
    catchment_minutes=DEFAULT_HEALTH_2SFCA_CATCHMENT_MIN,
    admin_level=None,
    is_flooded=False,
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
                    'SELECT id, source, target, cost, reverse_cost FROM road_segments WHERE source IS NOT NULL AND target IS NOT NULL AND cost > 0' 
                    || CASE WHEN :is_flooded THEN ' AND id NOT IN (SELECT rs.id FROM road_segments rs, flood_risk_polygons fz WHERE rs.geom && fz.geom AND ST_Intersects(rs.geom, fz.geom))' ELSE '' END,
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
                        THEN CAST(staff_count AS FLOAT) / NULLIF(catchment_population, 0)
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
            'is_flooded': bool(is_flooded),
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


# Compute an integrated vulnerability index by combining healthcare access scores with welfare beneficiary density
def compute_integrated_vulnerability(session, admin_units_gdf):
    if admin_units_gdf.empty:
        return pd.DataFrame()

    # 1. Fetch latest Health Access Scores (2SFCA) from the database
    health_query = text("""
        SELECT admin_unit_id, metric_value 
        FROM analysis_results 
        WHERE analysis_type = 'health_2sfca_access' 
        AND LOWER(admin_unit_type) = 'ta'
    """)
    health_scores = {
        int(row['admin_unit_id']): float(row['metric_value'] or 0.0) 
        for row in session.execute(health_query).mappings()
    }
    
    # 2. Fetch Welfare Beneficiary Counts per TA
    welfare_query = text("""
        SELECT ta_id, COUNT(*) as beneficiary_count
        FROM welfare_beneficiary
        WHERE ta_id IS NOT NULL
        GROUP BY ta_id
    """)
    welfare_counts = {
        int(row['ta_id']): int(row['beneficiary_count'] or 0) 
        for row in session.execute(welfare_query).mappings()
    }
    
    # 3. Calculate raw vulnerability components
    raw_data = []
    for _, row in admin_units_gdf.iterrows():
        admin_id = int(row['id'])
        population = float(row.get('population_total') or 1.0)
        h_score = health_scores.get(admin_id, 0.0)
        w_count = welfare_counts.get(admin_id, 0)
        
        # Poverty Density: Beneficiaries per person
        w_density = w_count / population if population > 0 else 0
        
        raw_data.append({
            'admin_id': admin_id,
            'h_score': h_score,
            'w_density': w_density,
            'admin_row': row
        })
        
    df_raw = pd.DataFrame(raw_data)
    if df_raw.empty:
        return pd.DataFrame()

    # 4. Normalize and combine metrics (Min-Max normalization)
    h_max = df_raw['h_score'].max() or 1.0
    w_max = df_raw['w_density'].max() or 1.0
    
    records = []
    for _, entry in df_raw.iterrows():
        # Scale to 0-1
        norm_h = entry['h_score'] / h_max
        norm_w = entry['w_density'] / w_max
        
        # Integrated Score: High Poverty AND Low Health Access = High Priority
        vulnerability_score = (1.0 - norm_h) * norm_w * 100.0
        
        records.append(
            analysis_record(
                analysis_type='health_welfare_vulnerability',
                admin_row=entry['admin_row'],
                metric_name='vulnerability_index',
                metric_value=float(vulnerability_score),
                metric_unit='priority_score',
                metadata={
                    'normalized_health_access': float(norm_h),
                    'normalized_poverty_density': float(norm_w),
                    'raw_health_score': float(entry['h_score']),
                    'raw_beneficiary_count': int(welfare_counts.get(entry['admin_id'], 0))
                }
            )
        )
            
    return pd.DataFrame(records)

# Identify areas at risk of healthcare isolation by comparing normal access with simulated flooded access
def compute_flood_isolation_index(session, admin_units_gdf):
    if admin_units_gdf.empty:
        return pd.DataFrame()

    # 1. Compute baseline (Normal) access
    df_normal = compute_health_2sfca_access(session, admin_units_gdf, is_flooded=False)
    
    # 2. Compute "Flooded" access (excluding segments in flood zones)
    df_flooded = compute_health_2sfca_access(session, admin_units_gdf, is_flooded=True)
    
    # Create lookups 
    normal_scores = {
        int(row['admin_unit_id']): float(row['metric_value']) 
        for _, row in df_normal.iterrows()
    }
    flooded_scores = {
        int(row['admin_unit_id']): float(row['metric_value']) 
        for _, row in df_flooded.iterrows()
    }
    
    records = []
    for _, admin_row in admin_units_gdf.iterrows():
        admin_id = int(admin_row['id'])
        score_normal = normal_scores.get(admin_id, 0.0)
        score_flooded = flooded_scores.get(admin_id, 0.0)
        
        # Isolation Score
        loss = score_normal - score_flooded
        isolation_index = (loss / score_normal * 100.0) if score_normal > 0 else 0.0
        isolation_index = max(0.0, min(100.0, isolation_index))
        
        records.append(
            analysis_record(
                analysis_type='health_flood_isolation',
                admin_row=admin_row,
                metric_name='flood_isolation_index',
                metric_value=float(isolation_index),
                metric_unit='percent_access_loss',
                metadata={
                    'score_normal': float(score_normal),
                    'score_flooded': float(score_flooded),
                    'access_loss_raw': float(loss),
                    'scenario': '100yr_flood_road_closure'
                }
            )
        )
        
    return pd.DataFrame(records)

# Identify schools that lack nearby healthcare facilities by calculating the distance
#  to the nearest health center
def compute_school_health_gap(session, admin_units_gdf):
    if admin_units_gdf.empty:
        return pd.DataFrame()

    # 1. Fetch school and health facility locations
    schools_query = text("""
        SELECT school_id, school_name, geom, COALESCE(student_enrollment_total, 0) as enrolment 
        FROM education_facilities 
        WHERE geom IS NOT NULL
    """)
    health_query = text("SELECT id, name, geom FROM health_facilities WHERE geom IS NOT NULL")
    
    schools_rows = session.execute(schools_query).mappings().all()
    health_rows = session.execute(health_query).mappings().all()
    
    if not schools_rows or not health_rows:
        return pd.DataFrame()

    # 2. Use PostGIS to find the nearest health facility for each school
    gap_query = text("""
        WITH school_gaps AS (
            SELECT 
                s.school_id,
                s.school_name,
                s.student_enrollment_total as enrolment,
                s.geom as school_geom,
                ST_Distance(s.geom::geography, h.geom::geography) / 1000.0 as distance_km
            FROM education_facilities s
            CROSS JOIN LATERAL (
                SELECT geom 
                FROM health_facilities 
                ORDER BY s.geom <-> geom 
                LIMIT 1
            ) h
            WHERE s.geom IS NOT NULL
        )
        SELECT 
            au.id as admin_unit_id,
            SUM(sg.enrolment) as total_enrolment,
            AVG(sg.distance_km) as avg_distance_to_health,
            COUNT(sg.school_id) as school_count
        FROM admin3_units au
        JOIN school_gaps sg ON ST_Within(sg.school_geom, au.geom)
        WHERE LOWER(au.type) = 'ta'
        GROUP BY au.id
    """)
    
    gap_data = {
        int(row['admin_unit_id']): {
            'avg_distance': float(row['avg_distance_to_health']),
            'student_count': int(row['total_enrolment'] or 0)
        }
        for row in session.execute(gap_query).mappings()
    }
    
    records = []
    for _, admin_row in admin_units_gdf.iterrows():
        admin_id = int(admin_row['id'])
        stats = gap_data.get(admin_id, {'avg_distance': 0.0, 'student_count': 0})
        
        # Metric: Average distance to healthcare for schools in this TA
        records.append(
            analysis_record(
                analysis_type='school_health_gap',
                admin_row=admin_row,
                metric_name='avg_school_to_health_dist_km',
                metric_value=float(stats['avg_distance']),
                metric_unit='km',
                metadata={
                    'student_enrolment_affected': int(stats['student_count']),
                    'school_count': int(stats.get('school_count', 0))
                }
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

# Helper function to create a standardized analysis record for a given administrative unit and metric
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
# counts, enrollment, teacher counts, and population coverage
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

# Function to run selected spatial analyses based on provided parameters
def get_school_thresholds(school_name):
    name_lower = str(school_name).lower()
    if 'sec' in name_lower or 'cdss' in name_lower:
        return {'type': 'secondary', 'max_dist_km': 8.0, 'ptr': 40.0, 'csr': 60.0}
    else:
        return {'type': 'primary', 'max_dist_km': 3.0, 'ptr': 60.0, 'csr': 60.0}

# Calculate compliance with education standards based on student-teacher ratios and
# classroom space ratios for each administrative unit
def compute_education_standards_compliance(admin_units_gdf, schools_gdf, admin_level=None):
    if schools_gdf.empty:
        return pd.DataFrame()

    admin_units = admin_units_gdf.copy()
    selected_level = (admin_level or '').lower()
    if selected_level == 'ta':
        join_column = 'ta_id'
    elif selected_level == 'ward':
        join_column = 'ward_id'
    else:
        join_column = 'district_id'

    records = []
    
    for _, admin_row in admin_units.iterrows():
        admin_id = admin_row['id']
        ta_schools = schools_gdf[schools_gdf[join_column] == admin_id]
        
        if ta_schools.empty:
            continue
            
        primary_ptr_compliant = 0
        primary_csr_compliant = 0
        primary_count = 0
        
        sec_ptr_compliant = 0
        sec_csr_compliant = 0
        sec_count = 0
        
        for _, school in ta_schools.iterrows():
            thresholds = get_school_thresholds(school.get('school_name', ''))
            
            # calculate metrics safely
            enrollment = float(school.get('student_enrollment_total') or 0)
            teachers = float(school.get('teacher_count') or 0)
            classrooms = float(school.get('blocks_count') or 0) # Assuming blocks_count represents classrooms
            
            ptr = enrollment / teachers if teachers > 0 else (enrollment if enrollment > 0 else 0)
            csr = enrollment / classrooms if classrooms > 0 else (enrollment if enrollment > 0 else 0)
            
            ptr_compliant = 1 if ptr <= thresholds['ptr'] else 0
            csr_compliant = 1 if csr <= thresholds['csr'] else 0
            
            if thresholds['type'] == 'primary':
                primary_count += 1
                primary_ptr_compliant += ptr_compliant
                primary_csr_compliant += csr_compliant
            else:
                sec_count += 1
                sec_ptr_compliant += ptr_compliant
                sec_csr_compliant += csr_compliant
                
        metrics = {}
        if primary_count > 0:
            metrics['primary_ptr_compliance_pct'] = (primary_ptr_compliant / primary_count * 100.0, 'percent')
            metrics['primary_csr_compliance_pct'] = (primary_csr_compliant / primary_count * 100.0, 'percent')
        if sec_count > 0:
            metrics['secondary_ptr_compliance_pct'] = (sec_ptr_compliant / sec_count * 100.0, 'percent')
            metrics['secondary_csr_compliance_pct'] = (sec_csr_compliant / sec_count * 100.0, 'percent')

        for metric_name, (metric_value, metric_unit) in metrics.items():
            records.append(
                analysis_record(
                    analysis_type='education_standards_compliance',
                    admin_row=admin_row,
                    metric_name=metric_name,
                    metric_value=float(metric_value),
                    metric_unit=metric_unit,
                )
            )

    return pd.DataFrame(records)


# Calculate the percentage of each administrative unit's area that falls within 
# the catchment areas of primary and secondary schools
def compute_education_catchment_access(admin_units_gdf, schools_gdf):
    # Coverage calculation using specific thresholds
    admin_proj = admin_units_gdf.to_crs('EPSG:3857')
    schools_proj = schools_gdf.to_crs('EPSG:3857')
    
    if schools_proj.empty:
        return pd.DataFrame()
        
    # Separate primary and secondary
    primary_geoms = []
    secondary_geoms = []
    
    for _, school in schools_proj.iterrows():
        thresholds = get_school_thresholds(school.get('name') or school.get('school_name', ''))
        school_geom = get_row_geometry(school)
        if school_geom is None:
            continue
        if thresholds['type'] == 'primary':
            primary_geoms.append(school_geom.buffer(thresholds['max_dist_km'] * 1000))
        else:
            secondary_geoms.append(school_geom.buffer(thresholds['max_dist_km'] * 1000))
            
    primary_union = unary_union(primary_geoms) if primary_geoms else None
    secondary_union = unary_union(secondary_geoms) if secondary_geoms else None
    
    records = []
    admin_geom_col = admin_proj.geometry.name
    
    for _, row in admin_proj.iterrows():
        row_geom = row.get(admin_geom_col)
        area = row_geom.area if row_geom is not None else 0
        if not area:
            continue
            
        metrics = {}
        if primary_union:
            covered = row_geom.intersection(primary_union).area
            metrics['primary_catchment_coverage_pct'] = (covered / area * 100, 'percent')
        if secondary_union:
            covered = row_geom.intersection(secondary_union).area
            metrics['secondary_catchment_coverage_pct'] = (covered / area * 100, 'percent')
            
        for metric_name, (metric_value, metric_unit) in metrics.items():
            records.append(
                analysis_record(
                    analysis_type='education_catchment_access',
                    admin_row=row,
                    metric_name=metric_name,
                    metric_value=float(metric_value),
                    metric_unit=metric_unit,
                )
            )
            
    return pd.DataFrame(records)

# Calculate an isolation index for education facilities by comparing access under
# normal conditions with access under a simulated flood scenario
def compute_education_flood_isolation_index(session, admin_units_gdf):
    if admin_units_gdf.empty:
        return pd.DataFrame()

    # Reuse 2sfca access logic but for education facilities
    def get_edu_access(is_flooded):
        query = text("""
            WITH admin_nodes AS (
                SELECT au.id AS admin_unit_id, au.population_total, v.id AS admin_node
                FROM admin3_units au
                LEFT JOIN LATERAL (
                    SELECT id, geom FROM road_vertices ORDER BY ST_PointOnSurface(au.geom) <-> geom LIMIT 1
                ) v ON TRUE
                WHERE v.id IS NOT NULL AND LOWER(au.type) = 'ta'
            ),
            facility_nodes AS (
                SELECT ef.school_id AS facility_id, v.id AS facility_node
                FROM education_facilities ef
                LEFT JOIN LATERAL (
                    SELECT id, geom FROM road_vertices ORDER BY ef.geom <-> geom LIMIT 1
                ) v ON TRUE
                WHERE ef.geom IS NOT NULL AND v.id IS NOT NULL
            ),
            reachable AS (
                SELECT a.admin_unit_id, COUNT(DISTINCT f.facility_id) as reached_schools
                FROM admin_nodes a
                CROSS JOIN facility_nodes f
                JOIN LATERAL (
                    SELECT * FROM pgr_drivingDistance(
                        'SELECT id, source, target, cost, reverse_cost FROM road_segments WHERE source IS NOT NULL AND target IS NOT NULL AND cost > 0' 
                        || CASE WHEN :is_flooded THEN ' AND id NOT IN (SELECT rs.id FROM road_segments rs, flood_risk_polygons fz WHERE rs.geom && fz.geom AND ST_Intersects(rs.geom, fz.geom))' ELSE '' END,
                        f.facility_node,
                        30.0, -- Default 30 min access
                        directed := true
                    ) dd WHERE dd.node = a.admin_node
                ) dd ON TRUE
                GROUP BY a.admin_unit_id
            )
            SELECT admin_unit_id, reached_schools FROM reachable
        """)
        return {int(row['admin_unit_id']): int(row['reached_schools']) for row in session.execute(query, {'is_flooded': is_flooded}).mappings()}

    normal_access = get_edu_access(False)
    flooded_access = get_edu_access(True)

    records = []
    for _, admin_row in admin_units_gdf.iterrows():
        admin_id = int(admin_row['id'])
        score_normal = normal_access.get(admin_id, 0)
        score_flooded = flooded_access.get(admin_id, 0)
        
        loss = score_normal - score_flooded
        isolation_index = (loss / score_normal * 100.0) if score_normal > 0 else 0.0
        isolation_index = max(0.0, min(100.0, isolation_index))
        
        records.append(
            analysis_record(
                analysis_type='education_flood_isolation',
                admin_row=admin_row,
                metric_name='education_flood_isolation_index',
                metric_value=float(isolation_index),
                metric_unit='percent_access_loss',
            )
        )
        
    return pd.DataFrame(records)

# Calculate a composite vulnerability index for education by 
# combining welfare beneficiary density with access to schools
def compute_education_welfare_vulnerability(session, admin_units_gdf):
    if admin_units_gdf.empty:
        return pd.DataFrame()

    # Welfare density
    welfare_query = text("""
        SELECT ta_id, COUNT(*) as beneficiary_count
        FROM welfare_beneficiary
        WHERE ta_id IS NOT NULL
        GROUP BY ta_id
    """)
    welfare_counts = {int(row['ta_id']): int(row['beneficiary_count'] or 0) for row in session.execute(welfare_query).mappings()}
    
    # Education gaps (from standard compliance if exists, else compute basic gap)
    edu_query = text("""
        SELECT admin_unit_id, AVG(metric_value) as avg_dist
        FROM analysis_results 
        WHERE analysis_type = 'nearest_school_distance'
        GROUP BY admin_unit_id
    """)
    edu_dist = {int(row['admin_unit_id']): float(row['avg_dist'] or 0.0) for row in session.execute(edu_query).mappings()}

    records = []
    df_raw = []
    for _, row in admin_units_gdf.iterrows():
        admin_id = int(row['id'])
        pop = float(row.get('population_total') or 1.0)
        w_count = welfare_counts.get(admin_id, 0)
        dist = edu_dist.get(admin_id, 0.0)
        w_density = w_count / pop if pop > 0 else 0
        df_raw.append({'admin_id': admin_id, 'w_density': w_density, 'dist': dist, 'admin_row': row})
        
    if not df_raw:
        return pd.DataFrame()
        
    df = pd.DataFrame(df_raw)
    w_max = df['w_density'].max() or 1.0
    d_max = df['dist'].max() or 1.0
    
    for _, entry in df.iterrows():
        norm_w = entry['w_density'] / w_max
        norm_d = entry['dist'] / d_max
        vulnerability_score = norm_w * norm_d * 100.0
        
        records.append(
            analysis_record(
                analysis_type='education_welfare_vulnerability',
                admin_row=entry['admin_row'],
                metric_name='education_vulnerability_index',
                metric_value=float(vulnerability_score),
                metric_unit='priority_score',
            )
        )
        
    return pd.DataFrame(records)

# Calculate a risk index for school overcrowding 
def compute_school_capacity_risk(admin_units_gdf, schools_gdf, raster_path):
    if schools_gdf.empty or not raster_path:
        return pd.DataFrame()

    admin_proj = admin_units_gdf.to_crs('EPSG:3857')
    schools_proj = schools_gdf.to_crs('EPSG:3857')
    
    # Create buffers based on school type
    buffers = []
    for idx, school in schools_proj.iterrows():
        thresholds = get_school_thresholds(school.get('school_name', ''))
        buf = school.geometry.buffer(thresholds['max_dist_km'] * 1000)
        buffers.append(buf)
        
    schools_proj['catchment_geom'] = buffers
    schools_catchment_gdf = gpd.GeoDataFrame(schools_proj, geometry='catchment_geom', crs='EPSG:3857').to_crs('EPSG:4326')
    
    # zonal stats
    try:
        catchment_stats = get_zonal_stats(raster_path, schools_catchment_gdf, stat='sum')
    except Exception:
        # Fallback if raster fails
        catchment_stats = [0] * len(schools_catchment_gdf)

    records = []
    # aggregate back to TA
    selected_level = 'ta_id' if 'ta_id' in schools_gdf.columns else 'district_id'
    
    ta_risks = {}
    for idx, school in schools_proj.iterrows():
        ta_id = school.get(selected_level)
        if pd.isna(ta_id): continue
        ta_id = int(ta_id)
        
        child_pop_demand = float(catchment_stats[idx] or 0)
        thresholds = get_school_thresholds(school.get('school_name', ''))
        
        # capacity
        classrooms = float(school.get('blocks_count') or 0)
        teachers = float(school.get('teacher_count') or 0)
        
        max_capacity = min(classrooms * thresholds['csr'], teachers * thresholds['ptr']) if (classrooms and teachers) else (classrooms * thresholds['csr'] if classrooms else 0)
        
        risk = child_pop_demand / max_capacity if max_capacity > 0 else (10.0 if child_pop_demand > 0 else 0) # High risk if no capacity
        
        if ta_id not in ta_risks:
            ta_risks[ta_id] = []
        ta_risks[ta_id].append(risk)
        
    for _, admin_row in admin_units_gdf.iterrows():
        admin_id = int(admin_row['id'])
        risks = ta_risks.get(admin_id, [])
        avg_risk = sum(risks) / len(risks) if risks else 0.0
        
        records.append(
            analysis_record(
                analysis_type='school_capacity_risk',
                admin_row=admin_row,
                metric_name='average_school_overcrowding_risk',
                metric_value=float(avg_risk),
                metric_unit='ratio',
            )
        )
        
    return pd.DataFrame(records)

# Function to run selected spatial analyses based on provided parameters
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
        if (
            'education_summary' in selected_types 
            or 'nearest_school_distance' in selected_types 
            or 'school_service_coverage' in selected_types
            or 'education_standards_compliance' in selected_types
            or 'education_catchment_access' in selected_types
            or 'education_flood_isolation' in selected_types
            or 'education_welfare_vulnerability' in selected_types
            or 'school_capacity_risk' in selected_types
        ):
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
            if 'education_standards_compliance' in selected_types:
                outputs.append(
                    run_step(
                        step_name='compute_education_standards_compliance',
                        user_message_on_error='Could not compute education standards compliance metrics.',
                        fn=compute_education_standards_compliance,
                        admin_units_gdf=admin_units_gdf,
                        schools_gdf=schools,
                        admin_level=admin_level,
                    )
                )
            if 'education_catchment_access' in selected_types:
                outputs.append(
                    run_step(
                        step_name='compute_education_catchment_access',
                        user_message_on_error='Could not compute education catchment access metrics.',
                        fn=compute_education_catchment_access,
                        admin_units_gdf=admin_units_gdf,
                        schools_gdf=schools,
                    )
                )
            if 'education_flood_isolation' in selected_types:
                outputs.append(
                    run_step(
                        step_name='compute_education_flood_isolation_index',
                        user_message_on_error='Could not compute education flood isolation index.',
                        fn=compute_education_flood_isolation_index,
                        session=session,
                        admin_units_gdf=admin_units_gdf,
                    )
                )
            if 'education_welfare_vulnerability' in selected_types:
                outputs.append(
                    run_step(
                        step_name='compute_education_welfare_vulnerability',
                        user_message_on_error='Could not compute education welfare vulnerability.',
                        fn=compute_education_welfare_vulnerability,
                        session=session,
                        admin_units_gdf=admin_units_gdf,
                    )
                )
            if 'school_capacity_risk' in selected_types:
                outputs.append(
                    run_step(
                        step_name='compute_school_capacity_risk',
                        user_message_on_error='Could not compute school capacity risk.',
                        fn=compute_school_capacity_risk,
                        admin_units_gdf=admin_units_gdf,
                        schools_gdf=schools,
                        raster_path=raster_path,
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
