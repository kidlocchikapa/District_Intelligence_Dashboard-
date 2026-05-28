#imort standard libraries
import argparse
import logging
import os
from datetime import datetime, timezone

import pandas as pd

##import third-party libraries
from db_utils import get_session, log_etl_run
from analytics import ANALYSIS_TYPES, run_spatial_analyses
from flood_exposure import run_flood_exposure_analysis, resolve_population_raster_path
from health_access import (
    DEFAULT_HEALTH_ACCESS_DISTANCE_KM,
    DEFAULT_HEALTH_ACCESS_GRID_SIZE_M,
    process_education_access_visualizations,
    process_health_access_visualizations,
)
from ingest import extract_source, load_reference_gazetteer
from load import (
    assign_ward_ids,
    fetch_admin_unit_lookup,
    fetch_spatial_admin_lookup,
    fetch_admin_units_for_indicators,
    load_analysis_results,
    run_post_load_spatial_fk_enrichment,
    load_to_postgis,
    load_unified_indicators,
)
from load import load_worldpop_age_sex
from welfare import process_welfare_beneficiary_dataset
from pipeline_config import DATASET_CONFIG
from roads import (
    process_roads_dataset,
    process_routing_dataset,
    recompute_beneficiary_facility_travel,
)
from transform import (
    add_harmonized_names,
    coerce_numeric_columns,
    derive_indicators,
    handle_missing_data,
    normalize_health_dataset,
    parse_coordinates,
    standardize_geography,
    standardize_schema,
    transform_boundary_dataset,
    to_gdf,
    validate_schema,
)

#import worldpop-specific processing functions and constants
from worldpop import (
    DEFAULT_SCHOOL_AGE_MAX,
    DEFAULT_SCHOOL_AGE_MIN,
    DEFAULT_CHILD_CLASS_MAX,
    DEFAULT_WORLDPOP_DATASET,
    DEFAULT_WORLDPOP_STATS_URL,
    DEFAULT_WORLDPOP_YEAR,
    build_population_indicators,
    build_age_sex_outputs,
    fetch_admin_units,
    process_population_data,
    process_population_stats,
    resolve_worldpop_raster,
    update_population_metrics,
)

# Set up logging
LOGGER = logging.getLogger('etl_pipeline')

DEFAULT_OVERPASS_URL = os.getenv('OVERPASS_API_URL', 'https://overpass-api.de/api/interpreter')
DEFAULT_OVERPASS_TIMEOUT = int(os.getenv('OVERPASS_TIMEOUT', '180'))
DEFAULT_OVERPASS_DISTRICTS = os.getenv('OVERPASS_ROADS_DISTRICTS', '')
HEALTH_ANALYSIS_TYPES = {
    'health_population_served',
    'health_service_coverage',
}

#######     Custom exception class for ETL pipeline errors ########################3
class ETLPipelineError(Exception):
    def __init__(self, user_message, step_name, original_error=None):
        self.user_message = user_message
        self.step_name = step_name
        self.original_error = original_error
        super().__init__(f"{user_message} (step: {step_name})")

def setup_logging():
    if LOGGER.handlers:
        return
    logging.basicConfig(
        level=logging.INFO,
        format='[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
    )


def log_step(step_name, message, level='info'):
    log_method = getattr(LOGGER, level, LOGGER.info)
    log_method(f"[{step_name}] {message}")


def run_step(step_name, user_message_on_error, fn, *args, **kwargs):
    log_step(step_name, 'started')
    try:
        result = fn(*args, **kwargs)
    except ETLPipelineError:
        raise
    except Exception as exc:
        log_step(step_name, f"failed: {exc}", level='error')
        raise ETLPipelineError(
            user_message=user_message_on_error,
            step_name=step_name,
            original_error=exc,
        ) from exc
    log_step(step_name, 'completed')
    return result

# Utility function to parse comma-separated lists from environment variables or config
def parse_csv_list(value):
    if not value:
        return []
    return [item.strip() for item in str(value).split(',') if item.strip()]


def resolve_health_coverage_distance_km(coverage_distance_km, analysis_types=None):
    selected_types = set(analysis_types or [])
    if coverage_distance_km == 5.0 and selected_types.intersection(HEALTH_ANALYSIS_TYPES):
        return DEFAULT_HEALTH_ACCESS_DISTANCE_KM
    return coverage_distance_km

# Group Zomba and Zomba city as one
DISTRICT_GROUPS = {
    'zomba_all': ['Zomba', 'Zomba City'],
}
DEFAULT_WORLDPOP_DISTRICT_GROUP = 'zomba_all'

# main ETL processing functions
def process_tabular_dataset(
    session,
    dataset_type,
    source_type='file',
    file_path=None,
    api_url=None,
    api_headers=None,
    gazetteer_path=None,
    missing_data_strategy='flag',
):
    started_at = datetime.utcnow()
    dataset_config = DATASET_CONFIG[dataset_type]
    source_name = os.path.basename(file_path) if file_path else api_url
    log_step('tabular_pipeline', f"processing dataset_type={dataset_type}, source={source_name}")

    raw_df = run_step(
        step_name='extract_source',
        user_message_on_error='Could not read input data. Verify the file/API source and format.',
        fn=extract_source,
        source_type=source_type,
        file_path=file_path,
        api_url=api_url,
        api_headers=api_headers,
    )
    rows_read = len(raw_df)
    log_step('extract_source', f'rows_read={rows_read}')

    transformed_df = run_step(
        step_name='standardize_schema',
        user_message_on_error='Input columns do not match the expected schema for this dataset.',
        fn=standardize_schema,
        df=raw_df,
        dataset_config=dataset_config,
    )
    transformed_df = run_step(
        step_name='validate_schema',
        user_message_on_error='Input data failed schema validation. Check required columns and types.',
        fn=validate_schema,
        df=transformed_df,
        dataset_config=dataset_config,
    )

    if dataset_type == 'boundaries':
        boundary_gdf = run_step(
            step_name='transform_boundary_dataset',
            user_message_on_error='Could not transform boundary geometry data.',
            fn=transform_boundary_dataset,
            df=transformed_df,
        )
        rows_processed = len(boundary_gdf)
        rows_loaded, table_name = run_step(
            step_name='load_boundaries_to_postgis',
            user_message_on_error='Failed to save boundary data to the database.',
            fn=load_to_postgis,
            session=session,
            gdf=boundary_gdf,
            dataset_type=dataset_type,
        )

        metadata = {
            'source_name': source_name,
            'accepted_types': ['District', 'TA', 'Village'],
        }

# logging the ETL run for boundary datasets without indicator derivation
        run_step(
            step_name='log_etl_success_boundaries',
            user_message_on_error='Boundary data loaded but ETL audit logging failed.',
            fn=log_etl_run,
            session=session,
            filename=source_name,
            source_type=source_type,
            dataset_type=dataset_type,
            table_name=table_name,
            rows_read=rows_read,
            rows_processed=rows_processed,
            rows_loaded=rows_loaded,
            rows_flagged=0,
            status='Success',
            metadata=metadata,
            started_at=started_at,
            completed_at=datetime.utcnow(),
        )

        return {
            'dataset_type': dataset_type,
            'table_name': table_name,
            'rows_read': rows_read,
            'rows_processed': rows_processed,
            'rows_loaded': rows_loaded,
            'rows_flagged': 0,
            'indicators_loaded': 0,
        }

# For other dataset types, continue with standard transformations and indicator derivation
    transformed_df = run_step(
        step_name='coerce_numeric_columns',
        user_message_on_error='Could not convert numeric columns. Check numeric values in the input data.',
        fn=coerce_numeric_columns,
        df=transformed_df,
        numeric_columns=dataset_config['numeric_columns'],
    )
    transformed_df = run_step(
        step_name='parse_coordinates',
        user_message_on_error='Could not parse coordinates. Check latitude/longitude fields.',
        fn=parse_coordinates,
        df=transformed_df,
    )

    gazetteer_df = run_step(
        step_name='load_reference_gazetteer',
        user_message_on_error='Could not load the gazetteer data used for geography matching.',
        fn=load_reference_gazetteer,
        session=session,
        gazetteer_path=gazetteer_path,
    )
    transformed_df = run_step(
        step_name='standardize_geography',
        user_message_on_error='Could not standardize geography names against reference data.',
        fn=standardize_geography,
        df=transformed_df,
        gazetteer_df=gazetteer_df,
    )
    transformed_df = run_step(
        step_name='handle_missing_data',
        user_message_on_error='Missing data handling failed. Check required fields in the dataset.',
        fn=handle_missing_data,
        df=transformed_df,
        required_columns=dataset_config['required_columns'],
        strategy=missing_data_strategy,
    )
    transformed_df = run_step(
        step_name='add_harmonized_names',
        user_message_on_error='Could not create harmonized geography names.',
        fn=add_harmonized_names,
        df=transformed_df,
    )

    if dataset_type == 'health':
        transformed_df = run_step(
            step_name='normalize_health_dataset',
            user_message_on_error='Could not normalize health dataset values.',
            fn=normalize_health_dataset,
            df=transformed_df,
        )

    admin_units_df = run_step(
        step_name='fetch_admin_units_for_indicators',
        user_message_on_error='Could not load administrative units needed for indicator derivation.',
        fn=fetch_admin_units_for_indicators,
        session=session,
    )
    admin_lookup = run_step(
        step_name='fetch_admin_unit_lookup',
        user_message_on_error='Could not load admin lookup data required for ward matching.',
        fn=fetch_admin_unit_lookup,
        session=session,
    )
    spatial_lookup = run_step(
        step_name='fetch_spatial_admin_lookup',
        user_message_on_error='Could not load spatial lookup data for ward assignment.',
        fn=fetch_spatial_admin_lookup,
        session=session,
    )
    transformed_df = run_step(
        step_name='assign_ward_ids',
        user_message_on_error='Ward assignment failed for one or more records.',
        fn=assign_ward_ids,
        df=transformed_df,
        admin_lookup=admin_lookup,
        spatial_lookup=spatial_lookup,
    )
    gdf = run_step(
        step_name='to_gdf',
        user_message_on_error='Could not convert records into geospatial format.',
        fn=to_gdf,
        df=transformed_df,
    )
    rows_flagged = int(transformed_df['is_flagged'].sum()) if 'is_flagged' in transformed_df.columns else 0
    rows_processed = len(transformed_df)
    rows_loaded, table_name = run_step(
        step_name='load_to_postgis',
        user_message_on_error='Failed to save transformed records into the database.',
        fn=load_to_postgis,
        session=session,
        gdf=gdf,
        dataset_type=dataset_type,
    )
    enrichment_result = run_step(
        step_name='post_load_spatial_fk_enrichment',
        user_message_on_error='Loaded data, but post-load spatial enrichment failed.',
        fn=run_post_load_spatial_fk_enrichment,
        session=session,
        dataset_type=dataset_type,
        started_at=started_at,
        completed_at=datetime.utcnow(),
    )

    indicators_df = run_step(
        step_name='derive_indicators',
        user_message_on_error='Could not compute indicators from transformed records.',
        fn=derive_indicators,
        df=transformed_df,
        dataset_type=dataset_type,
        admin_units_df=admin_units_df,
    )
    indicators_loaded = run_step(
        step_name='load_unified_indicators',
        user_message_on_error='Indicator computation succeeded, but saving indicators failed.',
        fn=load_unified_indicators,
        session=session,
        indicators_df=indicators_df,
        source_filename=source_name,
    )

    health_access_rows_loaded = 0
    education_analysis_rows_loaded = 0
    if dataset_type == 'health':
        resolved_worldpop = run_step(
            step_name='health_access_resolve_worldpop_raster',
            user_message_on_error='Could not resolve WorldPop raster for health access analysis.',
            fn=resolve_worldpop_raster,
            api_url=None,
            year=DEFAULT_WORLDPOP_YEAR,
        )
        district_access_df = run_step(
            step_name='health_access_compute_district',
            user_message_on_error='Could not compute district-level health access analysis.',
            fn=run_spatial_analyses,
            session=session,
            analysis_types=['health_population_served'],
            admin_level='District',
            coverage_distance_km=DEFAULT_HEALTH_ACCESS_DISTANCE_KM,
            raster_path=resolved_worldpop['raster_path'],
        )
        health_access_rows_loaded += run_step(
            step_name='health_access_load_district',
            user_message_on_error='District-level health access analysis was computed but could not be saved.',
            fn=load_analysis_results,
            session=session,
            analysis_df=district_access_df,
        )

        ta_access_df = run_step(
            step_name='health_access_compute_ta',
            user_message_on_error='Could not compute TA-level health access analysis.',
            fn=run_spatial_analyses,
            session=session,
            analysis_types=['health_population_served'],
            admin_level='TA',
            coverage_distance_km=DEFAULT_HEALTH_ACCESS_DISTANCE_KM,
            raster_path=resolved_worldpop['raster_path'],
        )
        health_access_rows_loaded += run_step(
            step_name='health_access_load_ta',
            user_message_on_error='TA-level health access analysis was computed but could not be saved.',
            fn=load_analysis_results,
            session=session,
            analysis_df=ta_access_df,
        )

    if dataset_type == 'education':
        education_worldpop = run_step(
            step_name='education_analysis_resolve_worldpop_raster',
            user_message_on_error='Could not download/resolve WorldPop raster for education population access analysis.',
            fn=resolve_worldpop_raster,
            api_url=api_url,
            year=year,
        )
        district_education_df = run_step(
            step_name='education_analysis_compute_district',
            user_message_on_error='Could not compute district-level education analyses.',
            fn=run_spatial_analyses,
            session=session,
            analysis_types=[
                'education_summary',
                'nearest_school_distance',
                'school_service_coverage',
                'school_population_buffer',
            ],
            admin_level='District',
            coverage_distance_km=5.0,
            raster_path=education_worldpop['raster_path'],
        )
        education_analysis_rows_loaded += run_step(
            step_name='education_analysis_load_district',
            user_message_on_error='District-level education analyses were computed but could not be saved.',
            fn=load_analysis_results,
            session=session,
            analysis_df=district_education_df,
        )

        ta_education_df = run_step(
            step_name='education_analysis_compute_ta',
            user_message_on_error='Could not compute TA-level education analyses.',
            fn=run_spatial_analyses,
            session=session,
            analysis_types=[
                'education_summary',
                'nearest_school_distance',
                'school_service_coverage',
                'school_population_buffer',
            ],
            admin_level='TA',
            coverage_distance_km=5.0,
            raster_path=education_worldpop['raster_path'],
        )
        education_analysis_rows_loaded += run_step(
            step_name='education_analysis_load_ta',
            user_message_on_error='TA-level education analyses were computed but could not be saved.',
            fn=load_analysis_results,
            session=session,
            analysis_df=ta_education_df,
        )

    metadata = {
        'missing_data_strategy': missing_data_strategy,
        'gazetteer_rows': len(gazetteer_df),
        'indicator_rows_loaded': indicators_loaded,
        'source_name': source_name,
        'post_load_spatial_fk_enrichment': enrichment_result,
        'health_access_rows_loaded': health_access_rows_loaded,
        'education_analysis_rows_loaded': education_analysis_rows_loaded,
    }

    run_step(
        step_name='log_etl_success_tabular',
        user_message_on_error='Data processing completed but ETL audit logging failed.',
        fn=log_etl_run,
        session=session,
        filename=source_name,
        source_type=source_type,
        dataset_type=dataset_type,
        table_name=table_name,
        rows_read=rows_read,
        rows_processed=rows_processed,
        rows_loaded=rows_loaded,
        rows_flagged=rows_flagged,
        status='Success',
        metadata=metadata,
        started_at=started_at,
        completed_at=datetime.utcnow(),
    )

    return {
        'dataset_type': dataset_type,
        'table_name': table_name,
        'rows_read': rows_read,
        'rows_processed': rows_processed,
        'rows_loaded': rows_loaded,
        'rows_flagged': rows_flagged,
        'indicators_loaded': indicators_loaded,
    }


    return {
        'dataset_type': dataset_type,
        'table_name': table_name,
        'rows_read': len(raw_df),
        'rows_processed': len(transformed_df),
        'rows_loaded': rows_loaded,
        'rows_flagged': 0,
        'indicators_loaded': indicators_loaded,
    }

# Separate processing function for WorldPop datasets to handle both raster and 
# API-based inputs, with appropriate transformations and indicator derivation
def process_worldpop_dataset(
    session,
    raster_path=None,
    district_name=None,
    district_names=None,
    api_url=None,
    year=DEFAULT_WORLDPOP_YEAR,
    worldpop_dataset=DEFAULT_WORLDPOP_DATASET,
    api_key=None,
    school_age_min=DEFAULT_SCHOOL_AGE_MIN,
    school_age_max=DEFAULT_SCHOOL_AGE_MAX,
    child_class_max=DEFAULT_CHILD_CLASS_MAX,
):
    started_at = datetime.utcnow()
    resolved_worldpop = None
    source_name = None
    row_count = 0
    log_step('worldpop_pipeline', f'processing worldpop dataset={worldpop_dataset}, year={year}')
    selected_districts = []
    if district_name:
        selected_districts.append(district_name)
    if district_names:
        selected_districts.extend(district_names)
    if not selected_districts:
        selected_districts.extend(DISTRICT_GROUPS.get(DEFAULT_WORLDPOP_DISTRICT_GROUP, []))
    selected_districts = sorted({name for name in selected_districts if name})

# For raster-based WorldPop processing, fetch admin units, process the raster, and derive indicators
    if raster_path:
        source_name = os.path.basename(raster_path)
        admin_units_gdf = run_step(
            step_name='worldpop_fetch_admin_units',
            user_message_on_error='Could not load administrative boundaries for WorldPop processing.',
            fn=fetch_admin_units,
            session=session,
            district_name=district_name,
            district_names=selected_districts,
        )
        if admin_units_gdf.empty:
            raise ETLPipelineError(
                user_message='No administrative boundaries with geometry were found for the selected district(s).',
                step_name='worldpop_fetch_admin_units',
            )

        population_gdf = run_step(
            step_name='worldpop_process_raster',
            user_message_on_error='Could not process the WorldPop raster for population metrics.',
            fn=process_population_data,
            raster_path=raster_path,
            admin_units_gdf=admin_units_gdf,
        )
        rows_loaded = run_step(
            step_name='worldpop_update_population_metrics',
            user_message_on_error='Population metrics were computed but could not be saved to the database.',
            fn=update_population_metrics,
            session=session,
            population_gdf=population_gdf,
        )
        indicators_df = run_step(
            step_name='worldpop_build_indicators',
            user_message_on_error='Could not build WorldPop indicators from processed population data.',
            fn=build_population_indicators,
            population_gdf=population_gdf,
            source_filename=source_name,
        )
        indicators_loaded = run_step(
            step_name='worldpop_load_indicators',
            user_message_on_error='WorldPop indicators were computed but failed to save.',
            fn=load_unified_indicators,
            session=session,
            indicators_df=indicators_df,
            source_filename=source_name,
        )
        table_name = 'districts'
        row_count = len(population_gdf)
        metadata = {
            'district_name': district_name,
            'district_names': selected_districts,
            'indicator_rows_loaded': indicators_loaded,
            'worldpop_year': year,
            'raster_path': raster_path,
            'worldpop_dataset': 'raster',
        }
    elif worldpop_dataset == 'wpgppop':
        source_name = f'worldpop_{worldpop_dataset}_{year}'
        admin_units_gdf = run_step(
            step_name='worldpop_fetch_admin_units',
            user_message_on_error='Could not load administrative boundaries for WorldPop processing.',
            fn=fetch_admin_units,
            session=session,
            district_name=district_name,
            district_names=selected_districts,
        )
        if admin_units_gdf.empty:
            raise ETLPipelineError(
                user_message='No administrative boundaries with geometry were found for the selected district(s).',
                step_name='worldpop_fetch_admin_units',
            )

        population_gdf = run_step(
            step_name='worldpop_process_stats',
            user_message_on_error='Could not fetch/process WorldPop statistics from the API.',
            fn=process_population_stats,
            api_url=api_url or DEFAULT_WORLDPOP_STATS_URL,
            admin_units_gdf=admin_units_gdf,
            year=year,
            api_key=api_key,
            dataset=worldpop_dataset,
        )
        rows_loaded = run_step(
            step_name='worldpop_update_population_metrics',
            user_message_on_error='Population metrics were computed but could not be saved to the database.',
            fn=update_population_metrics,
            session=session,
            population_gdf=population_gdf,
        )
        indicators_df = run_step(
            step_name='worldpop_build_indicators',
            user_message_on_error='Could not build WorldPop indicators from processed population data.',
            fn=build_population_indicators,
            population_gdf=population_gdf,
            source_filename=source_name,
        )
        indicators_loaded = run_step(
            step_name='worldpop_load_indicators',
            user_message_on_error='WorldPop indicators were computed but failed to save.',
            fn=load_unified_indicators,
            session=session,
            indicators_df=indicators_df,
            source_filename=source_name,
        )
        table_name = 'districts'
        row_count = len(population_gdf)
        metadata = {
            'district_name': district_name,
            'district_names': selected_districts,
            'indicator_rows_loaded': indicators_loaded,
            'worldpop_year': year,
            'worldpop_dataset': worldpop_dataset,
            'worldpop_stats_url': api_url or DEFAULT_WORLDPOP_STATS_URL,
        }
    elif worldpop_dataset == 'wpgpas':
        source_name = f'worldpop_{worldpop_dataset}_{year}'
        admin_units_gdf = run_step(
            step_name='worldpop_fetch_admin_units',
            user_message_on_error='Could not load administrative boundaries for WorldPop processing.',
            fn=fetch_admin_units,
            session=session,
            district_name=district_name,
            district_names=selected_districts,
        )
        if admin_units_gdf.empty:
            raise ETLPipelineError(
                user_message='No administrative boundaries with geometry were found for the selected district(s).',
                step_name='worldpop_fetch_admin_units',
            )

        age_sex_df, indicators_df = run_step(
            step_name='worldpop_build_age_sex_outputs',
            user_message_on_error='Could not build WorldPop age/sex outputs from API data.',
            fn=build_age_sex_outputs,
            admin_units_gdf=admin_units_gdf,
            year=year,
            api_url=api_url or DEFAULT_WORLDPOP_STATS_URL,
            api_key=api_key,
            school_age_min=school_age_min,
            school_age_max=school_age_max,
            child_class_max=child_class_max,
        )
        rows_loaded = run_step(
            step_name='worldpop_load_age_sex',
            user_message_on_error='Age/sex records were generated but failed to save to the database.',
            fn=load_worldpop_age_sex,
            session=session,
            age_sex_df=age_sex_df,
        )
        indicators_loaded = run_step(
            step_name='worldpop_load_indicators',
            user_message_on_error='WorldPop indicators were computed but failed to save.',
            fn=load_unified_indicators,
            session=session,
            indicators_df=indicators_df,
            source_filename=source_name,
        )
        table_name = 'worldpop_age_sex'
        row_count = len(age_sex_df)
        metadata = {
            'age_sex_rows_loaded': rows_loaded,
            'district_name': district_name,
            'district_names': selected_districts,
            'indicator_rows_loaded': indicators_loaded,
            'worldpop_year': year,
            'worldpop_dataset': worldpop_dataset,
            'worldpop_stats_url': api_url or DEFAULT_WORLDPOP_STATS_URL,
            'school_age_min': school_age_min,
            'school_age_max': school_age_max,
            'child_class_max': child_class_max,
        }
    else:
        raise ValueError(f'Unsupported WorldPop dataset: {worldpop_dataset}')

    run_step(
        step_name='log_etl_success_worldpop',
        user_message_on_error='WorldPop processing completed but ETL audit logging failed.',
        fn=log_etl_run,
        session=session,
        filename=source_name,
        source_type='worldpop',
        dataset_type='worldpop',
        table_name=table_name,
        rows_read=row_count,
        rows_processed=row_count,
        rows_loaded=rows_loaded,
        rows_flagged=0,
        status='Success',
        metadata=metadata,
        started_at=started_at,
        completed_at=datetime.utcnow(),
    )

    return {
        'dataset_type': 'worldpop',
        'table_name': table_name,
        'rows_read': row_count,
        'rows_processed': row_count,
        'rows_loaded': rows_loaded,
        'rows_flagged': 0,
        'indicators_loaded': indicators_loaded,
    }

# Separate processing function for spatial analyses that can be run on demand
# with flexible parameters
def process_analysis_dataset(
    session,
    analysis_types=None,
    admin_level=None,
    coverage_distance_km=5.0,
    raster_path=None,
    api_url=None,
    year=DEFAULT_WORLDPOP_YEAR,
):
    started_at = datetime.utcnow()
    selected_analysis_types = set(analysis_types or ANALYSIS_TYPES)
    coverage_distance_km = resolve_health_coverage_distance_km(
        coverage_distance_km,
        selected_analysis_types,
    )
    resolved_worldpop = None
    log_step('analysis_pipeline', f'analysis_types={sorted(selected_analysis_types)}, admin_level={admin_level}')

    if (
        ('health_population_served' in selected_analysis_types
         or 'school_population_buffer' in selected_analysis_types)
        and not raster_path
    ):
        resolved_worldpop = run_step(
            step_name='analysis_resolve_worldpop_raster',
            user_message_on_error='Could not download/resolve WorldPop raster for population access analysis.',
            fn=resolve_worldpop_raster,
            api_url=api_url,
            year=year,
        )
        raster_path = resolved_worldpop['raster_path']

    analysis_df = run_step(
        step_name='analysis_compute_spatial_metrics',
        user_message_on_error='Spatial analysis computation failed. Check analysis options and input data.',
        fn=run_spatial_analyses,
        session=session,
        analysis_types=sorted(selected_analysis_types),
        admin_level=admin_level,
        coverage_distance_km=coverage_distance_km,
        raster_path=raster_path,
    )
    rows_loaded = run_step(
        step_name='analysis_load_results',
        user_message_on_error='Spatial metrics were computed but failed to save to analysis_results.',
        fn=load_analysis_results,
        session=session,
        analysis_df=analysis_df,
    )

    metadata = {
        'analysis_types': sorted(selected_analysis_types),
        'admin_level': admin_level,
        'coverage_distance_km': coverage_distance_km,
        'worldpop_year': resolved_worldpop['year'] if resolved_worldpop else year,
        'raster_path': raster_path,
        'raster_url': resolved_worldpop['raster_url'] if resolved_worldpop else None,
    }

    run_step(
        step_name='log_etl_success_analysis',
        user_message_on_error='Analysis completed but ETL audit logging failed.',
        fn=log_etl_run,
        session=session,
        filename='analysis_results',
        source_type='internal',
        dataset_type='analysis',
        table_name='analysis_results',
        rows_read=len(analysis_df),
        rows_processed=len(analysis_df),
        rows_loaded=rows_loaded,
        rows_flagged=0,
        status='Success',
        metadata=metadata,
        started_at=started_at,
        completed_at=datetime.utcnow(),
    )

    return {
        'dataset_type': 'analysis',
        'table_name': 'analysis_results',
        'rows_read': len(analysis_df),
        'rows_processed': len(analysis_df),
        'rows_loaded': rows_loaded,
        'rows_flagged': 0,
        'indicators_loaded': 0,
    }

# Separate processing function for flood exposure analysis that can take a flood 
# raster and optional WorldPop population data
def process_flood_dataset(
    session,
    flood_raster_path,
    district_name=None,
    district_names=None,
    worldpop_raster_path=None,
    worldpop_year=DEFAULT_WORLDPOP_YEAR,
    worldpop_timeout=900,
    worldpop_max_attempts=3,
    analysis_date=None,
):
    if not flood_raster_path:
        raise ETLPipelineError(
            user_message='A flood raster file path is required for flood analysis.',
            step_name='validate_flood_raster_path',
        )

    if not os.path.exists(flood_raster_path):
        raise ETLPipelineError(
            user_message=f'Flood raster file not found: {flood_raster_path}. Check the file path and rerun.',
            step_name='validate_flood_raster_path',
        )

    started_at = datetime.utcnow()
    effective_date = analysis_date or datetime.utcnow().date()
    log_step('flood_pipeline', f'flood_raster={flood_raster_path}, analysis_date={effective_date}')

    resolved_worldpop_raster_path = run_step(
        step_name='flood_resolve_worldpop_raster',
        user_message_on_error='Could not resolve a usable WorldPop raster for flood exposure.',
        fn=resolve_population_raster_path,
        worldpop_raster_path=worldpop_raster_path,
        worldpop_year=worldpop_year,
        download_timeout=worldpop_timeout,
        max_attempts=worldpop_max_attempts,
    )

    flood_result = run_step(
        step_name='flood_run_exposure_analysis',
        user_message_on_error='Flood exposure computation failed. Check raster/data inputs and retry.',
        fn=run_flood_exposure_analysis,
        session=session,
        flood_raster_path=flood_raster_path,
        worldpop_raster_path=resolved_worldpop_raster_path,
        district_name=district_name,
        district_names=district_names,
        analysis_date=effective_date,
    )
    processed_count = int(flood_result.get('processed_count', 0))

    metadata = {
        'flood_raster_path': flood_raster_path,
        'worldpop_raster_path': resolved_worldpop_raster_path,
        'worldpop_year': worldpop_year,
        'district_name': district_name,
        'district_names': district_names or [],
        'analysis_date': effective_date.isoformat(),
        'preview_assets': flood_result.get('preview_assets', []),
    }

    run_step(
        step_name='log_etl_success_flood',
        user_message_on_error='Flood exposure completed but ETL audit logging failed.',
        fn=log_etl_run,
        session=session,
        filename=os.path.basename(flood_raster_path),
        source_type='file',
        dataset_type='flood',
        table_name='flood_zones',
        rows_read=processed_count,
        rows_processed=processed_count,
        rows_loaded=processed_count,
        rows_flagged=0,
        status='Success',
        metadata=metadata,
        started_at=started_at,
        completed_at=datetime.utcnow(),
    )

    return {
        'dataset_type': 'flood',
        'table_name': 'flood_zones',
        'rows_read': processed_count,
        'rows_processed': processed_count,
        'rows_loaded': processed_count,
        'rows_flagged': 0,
        'indicators_loaded': 0,
    }

# Helper function to parse API headers from command-line arguments in KEY=VALUE format
def parse_headers(header_values):
    headers = {}
    for item in header_values or []:
        if '=' not in item:
            continue
        key, value = item.split('=', 1)
        headers[key.strip()] = value.strip()
    return headers

# Helper function to determine the appropriate table name for logging based on dataset type
def resolve_table_name_for_failure(dataset_type):
    if dataset_type == 'flood':
        return 'flood_zones'
    if dataset_type == 'routing':
        return 'beneficiary_facility_travel'
    if dataset_type == 'health_access':
        return 'health_facility_access_metrics'
    if dataset_type == 'education_access':
        return 'education_facility_access_metrics'
    if dataset_type == 'analysis':
        return 'analysis_results'
    if dataset_type == 'worldpop':
        return 'districts'
    return DATASET_CONFIG.get(dataset_type, {}).get('table_name', 'unknown')

# Main entry point for the ETL pipeline, with command-line arguments to specify dataset type, source, and processing options
def main():
    setup_logging()
    parser = argparse.ArgumentParser(description='District Intelligence ETL Pipeline')
    parser.add_argument('--type', required=True, choices=list(DATASET_CONFIG.keys()) + ['flood', 'routing', 'health_access', 'education_access'], help='Dataset type')
    parser.add_argument('--source-type', default='file', choices=['file', 'api', 'worldpop', 'overpass'], help='Input source type')
    parser.add_argument('--file', help='Path to CSV, Excel, JSON, or GeoTIFF file')
    parser.add_argument('--api-url', help='Remote API endpoint for extraction')
    parser.add_argument('--api-header', action='append', help='Optional API headers in KEY=VALUE format')
    parser.add_argument('--gazetteer', help='Optional path to a reference gazetteer file')
    parser.add_argument('--district', help='District filter for WorldPop processing')
    parser.add_argument('--district-group', choices=sorted(DISTRICT_GROUPS.keys()), help='Named district group for WorldPop processing')
    parser.add_argument('--worldpop-year', type=int, default=DEFAULT_WORLDPOP_YEAR, help='WorldPop population year to use')
    parser.add_argument('--worldpop-dataset', default=DEFAULT_WORLDPOP_DATASET, choices=['wpgppop', 'wpgpas'], help='WorldPop stats dataset to query')
    parser.add_argument('--worldpop-api-key', help='Optional WorldPop API key')
    parser.add_argument('--worldpop-timeout', type=int, default=900, help='WorldPop raster/API timeout in seconds for flood workflow')
    parser.add_argument('--worldpop-max-attempts', type=int, default=3, help='Maximum WorldPop fetch attempts for flood workflow')
    parser.add_argument('--analysis-date', help='Optional analysis date (YYYY-MM-DD) for flood workflow')
    parser.add_argument('--overpass-url', default=DEFAULT_OVERPASS_URL, help='Overpass API URL for road ingestion')
    parser.add_argument('--overpass-query', help='Overpass query for road ingestion')
    parser.add_argument('--overpass-timeout', type=int, default=DEFAULT_OVERPASS_TIMEOUT, help='Overpass request timeout in seconds')
    parser.add_argument('--road-clip-districts', default=DEFAULT_OVERPASS_DISTRICTS, help='Comma-separated district names for clipping road data')
    parser.add_argument('--school-age-min', type=int, default=DEFAULT_SCHOOL_AGE_MIN, help='Lower bound for school-age population aggregation')
    parser.add_argument('--school-age-max', type=int, default=DEFAULT_SCHOOL_AGE_MAX, help='Upper bound for school-age population aggregation')
    parser.add_argument('--child-class-max', type=int, default=DEFAULT_CHILD_CLASS_MAX, help='Maximum wpgpas class treated as child population')
    parser.add_argument('--analysis-type', action='append', choices=sorted(ANALYSIS_TYPES), help='Spatial analysis to run')
    parser.add_argument('--admin-level', choices=['District', 'TA', 'Village'], help='Administrative level for analysis')
    parser.add_argument('--coverage-distance-km', type=float, default=5.0, help='Coverage buffer distance in kilometers')
    parser.add_argument('--grid-size-m', type=float, default=DEFAULT_HEALTH_ACCESS_GRID_SIZE_M, help='Grid size in meters for health/education access preview rasters')
    parser.add_argument('--program-id', type=int, help='Welfare program id to attach to welfare beneficiary uploads')
    parser.add_argument(
        '--missing-data-strategy',
        default='flag',
        choices=['flag', 'exclude', 'impute'],
        help='How to treat incomplete records',
    )

    args = parser.parse_args()
    session = run_step(
        step_name='open_db_session',
        user_message_on_error='Could not connect to the database. Check database service and credentials.',
        fn=get_session,
    )
    if args.source_type == 'overpass' and args.type != 'roads':
        raise ETLPipelineError(
            user_message='Overpass source type is only supported for road network ingestion.',
            step_name='validate_source_type',
        )
    selected_group_districts = DISTRICT_GROUPS.get(args.district_group, [])
    headers = run_step(
        step_name='parse_api_headers',
        user_message_on_error='Could not parse API headers. Use KEY=VALUE format.',
        fn=parse_headers,
        header_values=args.api_header,
    )

    clip_districts = parse_csv_list(args.road_clip_districts)
    try:
        if args.type == 'worldpop':
            if not args.district and not selected_group_districts:
                selected_group_districts = DISTRICT_GROUPS.get(
                    DEFAULT_WORLDPOP_DISTRICT_GROUP,
                    [],
                )
            result = run_step(
                step_name='dispatch_worldpop_pipeline',
                user_message_on_error='WorldPop pipeline failed. Verify the district filters, year, and source settings.',
                fn=process_worldpop_dataset,
                session=session,
                raster_path=args.file,
                district_name=args.district,
                district_names=selected_group_districts,
                api_url=args.api_url,
                year=args.worldpop_year,
                worldpop_dataset=args.worldpop_dataset,
                api_key=args.worldpop_api_key,
                school_age_min=args.school_age_min,
                school_age_max=args.school_age_max,
                child_class_max=args.child_class_max,
            )
        elif args.type == 'analysis':
            effective_coverage_distance_km = resolve_health_coverage_distance_km(
                args.coverage_distance_km,
                args.analysis_type,
            )
            result = run_step(
                step_name='dispatch_analysis_pipeline',
                user_message_on_error='Spatial analysis pipeline failed. Verify analysis options and input data.',
                fn=process_analysis_dataset,
                session=session,
                analysis_types=args.analysis_type,
                admin_level=args.admin_level,
                coverage_distance_km=effective_coverage_distance_km,
                raster_path=args.file,
                api_url=args.api_url,
                year=args.worldpop_year,
            )
        elif args.type == 'flood':
            selected_district_names = []
            if args.district:
                selected_district_names.append(args.district)
            selected_district_names.extend(selected_group_districts)
            selected_district_names = sorted({name for name in selected_district_names if name})

            if not selected_district_names:
                selected_district_names = ['Zomba']

            primary_district = selected_district_names[0]
            secondary_districts = selected_district_names[1:]
            parsed_analysis_date = run_step(
                step_name='parse_flood_analysis_date',
                user_message_on_error='Invalid analysis date format. Use YYYY-MM-DD (example: 2026-04-18).',
                fn=(lambda: datetime.strptime(args.analysis_date, '%Y-%m-%d').date() if args.analysis_date else None),
            )

            result = run_step(
                step_name='dispatch_flood_pipeline',
                user_message_on_error='Flood pipeline failed. Check flood raster path, district selection, and WorldPop options.',
                fn=process_flood_dataset,
                session=session,
                flood_raster_path=args.file,
                district_name=primary_district,
                district_names=secondary_districts,
                worldpop_raster_path=None,
                worldpop_year=args.worldpop_year,
                worldpop_timeout=args.worldpop_timeout,
                worldpop_max_attempts=args.worldpop_max_attempts,
                analysis_date=parsed_analysis_date,
            )
        elif args.type == 'welfare_beneficiary':
            result = run_step(
                step_name='dispatch_welfare_beneficiary_pipeline',
                user_message_on_error='Welfare beneficiary pipeline failed.',
                fn=process_welfare_beneficiary_dataset,
                session=session,
                file_path=args.file,
                api_url=args.api_url,
                api_headers=headers,
                program_id=args.program_id,
                health_dist_km=args.coverage_distance_km if args.coverage_distance_km != 5.0 else 8.0,
                school_dist_km=args.coverage_distance_km,
            )
            run_step(
                step_name='post_welfare_beneficiary_routing_refresh',
                user_message_on_error='Welfare beneficiaries loaded, but road travel refresh failed.',
                fn=recompute_beneficiary_facility_travel,
                session=session,
                strict=False,
            )
        elif args.type == 'roads':
            if args.source_type == 'overpass' and not args.overpass_query:
                raise ETLPipelineError(
                    user_message='An Overpass query is required for road network ingestion.',
                    step_name='validate_overpass_query',
                )
            if args.source_type != 'overpass' and not args.file:
                raise ETLPipelineError(
                    user_message='A road file path is required for road network ingestion.',
                    step_name='validate_roads_file_path',
                )
            result = run_step(
                step_name='dispatch_roads_pipeline',
                user_message_on_error='Road network pipeline failed. Check the road file and pgRouting setup.',
                fn=process_roads_dataset,
                session=session,
                file_path=args.file,
                missing_data_strategy=args.missing_data_strategy,
                source_type=args.source_type,
                api_url=args.api_url,
                api_headers=headers,
                overpass_url=args.overpass_url,
                overpass_query=args.overpass_query,
                overpass_timeout=args.overpass_timeout,
                clip_districts=clip_districts,
            )
        elif args.type == 'routing':
            result = run_step(
                step_name='dispatch_routing_pipeline',
                user_message_on_error='Road travel routing pipeline failed. Check road network and pgRouting setup.',
                fn=process_routing_dataset,
                session=session,
                strict=True,
            )
        elif args.type == 'health_access':
            selected_district_names = []
            if args.district:
                selected_district_names.append(args.district)
            selected_district_names.extend(selected_group_districts)
            selected_district_names = sorted({name for name in selected_district_names if name})
            primary_district = selected_district_names[0] if selected_district_names else None
            secondary_districts = selected_district_names[1:] if len(selected_district_names) > 1 else []
            result = run_step(
                step_name='dispatch_health_access_pipeline',
                user_message_on_error='Health access visualization pipeline failed. Check beneficiary, road, facility, and WorldPop inputs.',
                fn=process_health_access_visualizations,
                session=session,
                district_name=primary_district,
                district_names=secondary_districts,
                raster_path=args.file,
                api_url=args.api_url,
                year=args.worldpop_year,
                coverage_distance_km=args.coverage_distance_km if args.coverage_distance_km != 5.0 else DEFAULT_HEALTH_ACCESS_DISTANCE_KM,
                grid_size_m=args.grid_size_m,
            )
        elif args.type == 'education_access':
            selected_district_names = []
            if args.district:
                selected_district_names.append(args.district)
            selected_district_names.extend(selected_group_districts)
            if not selected_district_names:
                selected_district_names.extend(DISTRICT_GROUPS.get('zomba_all', []))
            selected_district_names = sorted({name for name in selected_district_names if name})
            primary_district = selected_district_names[0] if selected_district_names else None
            secondary_districts = selected_district_names[1:] if len(selected_district_names) > 1 else []
            result = run_step(
                step_name='dispatch_education_access_pipeline',
                user_message_on_error='Education access visualization pipeline failed. Check beneficiary, road, facility, and WorldPop inputs.',
                fn=process_education_access_visualizations,
                session=session,
                district_name=primary_district,
                district_names=secondary_districts,
                raster_path=args.file,
                api_url=args.api_url,
                year=args.worldpop_year,
                coverage_distance_km=args.coverage_distance_km,
                grid_size_m=args.grid_size_m,
            )
        else:
            source_type = 'api' if args.source_type == 'api' else 'file'
            if source_type == 'file' and not args.file:
                raise ETLPipelineError(
                    user_message='A file path is required for file-based ingestion.',
                    step_name='validate_tabular_file_path',
                )
            if source_type == 'api' and not args.api_url:
                raise ETLPipelineError(
                    user_message='An API URL is required for API-based ingestion.',
                    step_name='validate_tabular_api_url',
                )

            result = run_step(
                step_name='dispatch_tabular_pipeline',
                user_message_on_error='Tabular pipeline failed. Check source data format and required fields.',
                fn=process_tabular_dataset,
                session=session,
                dataset_type=args.type,
                source_type=source_type,
                file_path=args.file,
                api_url=args.api_url,
                api_headers=headers,
                gazetteer_path=args.gazetteer,
                missing_data_strategy=args.missing_data_strategy,
            )
            if args.type in {'education', 'health'}:
                run_step(
                    step_name=f'post_{args.type}_routing_refresh',
                    user_message_on_error=f'{args.type.title()} data loaded, but road travel refresh failed.',
                    fn=recompute_beneficiary_facility_travel,
                    session=session,
                    facility_types=['school'] if args.type == 'education' else ['health'],
                    strict=False,
                )

        print(
            'ETL completed successfully: '
            f"dataset={result['dataset_type']}, rows_loaded={result['rows_loaded']}, indicators_loaded={result['indicators_loaded']}"
        )
    except ETLPipelineError as exc:
        filename = os.path.basename(args.file) if args.file else args.api_url
        table_name = resolve_table_name_for_failure(args.type)
        try:
            log_etl_run(
                session,
                filename=filename,
                source_type=args.source_type,
                dataset_type=args.type,
                table_name=table_name,
                rows_read=0,
                rows_processed=0,
                rows_loaded=0,
                rows_flagged=0,
                status='Failed',
                error=exc.user_message,
                metadata={
                    'district': args.district,
                    'failed_step': exc.step_name,
                    'original_error': str(exc.original_error) if exc.original_error else None,
                },
                started_at=datetime.now(timezone.utc),
                completed_at=datetime.now(timezone.utc),
            )
        except Exception as log_error:
            log_step('log_etl_failure', f'failed to save ETL failure log: {log_error}', level='warning')

        LOGGER.error(
            "Pipeline failed at step '%s'. %s Original error: %s",
            exc.step_name,
            exc.user_message,
            exc.original_error,
        )
        raise SystemExit(f'ETL failed: {exc.user_message}')
    except Exception as exc:
        filename = os.path.basename(args.file) if args.file else args.api_url
        table_name = resolve_table_name_for_failure(args.type)
        try:
            log_etl_run(
                session,
                filename=filename,
                source_type=args.source_type,
                dataset_type=args.type,
                table_name=table_name,
                rows_read=0,
                rows_processed=0,
                rows_loaded=0,
                rows_flagged=0,
                status='Failed',
                error='Unexpected internal error in ETL pipeline.',
                metadata={'district': args.district, 'original_error': str(exc)},
                started_at=datetime.now(timezone.utc),
                completed_at=datetime.now(timezone.utc),
            )
        except Exception as log_error:
            log_step('log_etl_failure', f'failed to save ETL failure log: {log_error}', level='warning')
        LOGGER.exception('Unexpected ETL pipeline failure')
        raise SystemExit('ETL failed due to an unexpected internal error. Please check logs and retry.') from exc
    finally:
        run_step(
            step_name='close_db_session',
            user_message_on_error='Pipeline completed, but closing the database session failed.',
            fn=session.close,
        )


if __name__ == '__main__':
    main()
