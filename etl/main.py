#imort standard libraries
import argparse
import os
from datetime import datetime

import pandas as pd

##import third-party libraries
from db_utils import get_session, log_etl_run
from analytics import ANALYSIS_TYPES, run_spatial_analyses
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
from pipeline_config import DATASET_CONFIG
from transform import (
    add_harmonized_names,
    coerce_numeric_columns,
    derive_indicators,
    ensure_multipolygon,
    handle_missing_data,
    normalize_health_dataset,
    parse_coordinates,
    standardize_geography,
    standardize_schema,
    transform_boundary_dataset,
    transform_disaster_dataset,
    to_gdf,
    to_polygon_gdf,
    validate_schema,
)
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


DISTRICT_GROUPS = {
    'zomba_all': ['Zomba', 'Zomba City'],
}


##main ETL processing functions
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

    raw_df = extract_source(source_type, file_path=file_path, api_url=api_url, api_headers=api_headers)
    rows_read = len(raw_df)

    transformed_df = standardize_schema(raw_df, dataset_config)
    transformed_df = validate_schema(transformed_df, dataset_config)

    if dataset_type == 'boundaries':
        boundary_gdf = transform_boundary_dataset(transformed_df)
        rows_processed = len(boundary_gdf)
        rows_loaded, table_name = load_to_postgis(session, boundary_gdf, dataset_type)

        metadata = {
            'source_name': source_name,
            'accepted_types': ['District', 'TA', 'Village'],
        }

##logging the ETL run for boundary datasets without indicator derivation
        log_etl_run(
            session,
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

    if dataset_type == 'disaster' and 'geometry' in transformed_df.columns:
        disaster_gdf = transform_disaster_dataset(transformed_df)
        rows_processed = len(disaster_gdf)
        rows_loaded, table_name = load_to_postgis(session, disaster_gdf, dataset_type)

        indicators_df = derive_indicators(disaster_gdf, dataset_type, fetch_admin_units_for_indicators(session))
        indicators_loaded = load_unified_indicators(session, indicators_df, source_filename=source_name)

        metadata = {
            'source_name': source_name,
            'geometry_type': 'polygon',
            'indicator_rows_loaded': indicators_loaded,
        }

        log_etl_run(
            session,
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
            'indicators_loaded': indicators_loaded,
        }

##For other dataset types, continue with standard transformations and indicator derivation
    transformed_df = coerce_numeric_columns(transformed_df, dataset_config['numeric_columns'])
    transformed_df = parse_coordinates(transformed_df)

    gazetteer_df = load_reference_gazetteer(session, gazetteer_path)
    transformed_df = standardize_geography(transformed_df, gazetteer_df)
    transformed_df = handle_missing_data(
        transformed_df,
        required_columns=dataset_config['required_columns'],
        strategy=missing_data_strategy,
    )
    transformed_df = add_harmonized_names(transformed_df)

    if dataset_type == 'health':
        transformed_df = normalize_health_dataset(transformed_df)

    admin_units_df = fetch_admin_units_for_indicators(session)
    admin_lookup = fetch_admin_unit_lookup(session)
    spatial_lookup = fetch_spatial_admin_lookup(session)
    transformed_df = assign_ward_ids(transformed_df, admin_lookup, spatial_lookup=spatial_lookup)
    gdf = to_gdf(transformed_df)
    if dataset_type == 'disaster' and 'geometry' in gdf.columns:
        gdf['geometry'] = gdf['geometry'].apply(ensure_multipolygon)

    rows_flagged = int(transformed_df['is_flagged'].sum()) if 'is_flagged' in transformed_df.columns else 0
    rows_processed = len(transformed_df)
    rows_loaded, table_name = load_to_postgis(session, gdf, dataset_type)
    enrichment_result = run_post_load_spatial_fk_enrichment(
        session,
        dataset_type,
        started_at=started_at,
        completed_at=datetime.utcnow(),
    )

    indicators_df = derive_indicators(transformed_df, dataset_type, admin_units_df)
    indicators_loaded = load_unified_indicators(session, indicators_df, source_filename=source_name)

    metadata = {
        'missing_data_strategy': missing_data_strategy,
        'gazetteer_rows': len(gazetteer_df),
        'indicator_rows_loaded': indicators_loaded,
        'source_name': source_name,
        'post_load_spatial_fk_enrichment': enrichment_result,
    }

    log_etl_run(
        session,
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


## Separate processing function for WorldPop datasets to handle both raster and 
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
    selected_districts = []
    if district_name:
        selected_districts.append(district_name)
    if district_names:
        selected_districts.extend(district_names)
    selected_districts = sorted({name for name in selected_districts if name})

## For raster-based WorldPop processing, fetch admin units, process the raster, and derive indicators
    if raster_path:
        source_name = os.path.basename(raster_path)
        admin_units_gdf = fetch_admin_units(
            session,
            district_name=district_name,
            district_names=selected_districts,
        )
        if admin_units_gdf.empty:
            raise ValueError('No administrative units with geometry were found for WorldPop processing')

        population_gdf = process_population_data(raster_path, admin_units_gdf)
        rows_loaded = update_population_metrics(session, population_gdf)
        indicators_df = build_population_indicators(population_gdf, source_filename=source_name)
        indicators_loaded = load_unified_indicators(session, indicators_df, source_filename=source_name)
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
        admin_units_gdf = fetch_admin_units(
            session,
            district_name=district_name,
            district_names=selected_districts,
        )
        if admin_units_gdf.empty:
            raise ValueError('No administrative units with geometry were found for WorldPop processing')

        population_gdf = process_population_stats(
            api_url=api_url or DEFAULT_WORLDPOP_STATS_URL,
            admin_units_gdf=admin_units_gdf,
            year=year,
            api_key=api_key,
            dataset=worldpop_dataset,
        )
        rows_loaded = update_population_metrics(session, population_gdf)
        indicators_df = build_population_indicators(population_gdf, source_filename=source_name)
        indicators_loaded = load_unified_indicators(session, indicators_df, source_filename=source_name)
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
        admin_units_gdf = fetch_admin_units(
            session,
            district_name=district_name,
            district_names=selected_districts,
        )
        if admin_units_gdf.empty:
            raise ValueError('No administrative units with geometry were found for WorldPop processing')

        age_sex_df, indicators_df = build_age_sex_outputs(
            admin_units_gdf,
            year=year,
            api_url=api_url or DEFAULT_WORLDPOP_STATS_URL,
            api_key=api_key,
            school_age_min=school_age_min,
            school_age_max=school_age_max,
            child_class_max=child_class_max,
        )
        rows_loaded = load_worldpop_age_sex(session, age_sex_df)
        indicators_loaded = load_unified_indicators(session, indicators_df, source_filename=source_name)
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

    log_etl_run(
        session,
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

## Separate processing function for spatial analyses that can be run on demand
#  with flexible parameters, including optional WorldPop raster input for population-served calculations
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
    resolved_worldpop = None

    if 'health_population_served' in selected_analysis_types and not raster_path:
        resolved_worldpop = resolve_worldpop_raster(
            api_url=api_url,
            year=year,
        )
        raster_path = resolved_worldpop['raster_path']

    analysis_df = run_spatial_analyses(
        session,
        analysis_types=sorted(selected_analysis_types),
        admin_level=admin_level,
        coverage_distance_km=coverage_distance_km,
        raster_path=raster_path,
    )
    rows_loaded = load_analysis_results(session, analysis_df)

    metadata = {
        'analysis_types': sorted(selected_analysis_types),
        'admin_level': admin_level,
        'coverage_distance_km': coverage_distance_km,
        'worldpop_year': resolved_worldpop['year'] if resolved_worldpop else year,
        'raster_path': raster_path,
        'raster_url': resolved_worldpop['raster_url'] if resolved_worldpop else None,
    }

    log_etl_run(
        session,
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

## Helper function to parse API headers from command-line arguments in KEY=VALUE format
def parse_headers(header_values):
    headers = {}
    for item in header_values or []:
        if '=' not in item:
            continue
        key, value = item.split('=', 1)
        headers[key.strip()] = value.strip()
    return headers

## Main entry point for the ETL pipeline, with command-line arguments to specify dataset type, source, and processing options
def main():
    parser = argparse.ArgumentParser(description='District Intelligence ETL Pipeline')
    parser.add_argument('--type', required=True, choices=list(DATASET_CONFIG.keys()), help='Dataset type')
    parser.add_argument('--source-type', default='file', choices=['file', 'api', 'worldpop'], help='Input source type')
    parser.add_argument('--file', help='Path to CSV, Excel, JSON, or GeoTIFF file')
    parser.add_argument('--api-url', help='Remote API endpoint for extraction')
    parser.add_argument('--api-header', action='append', help='Optional API headers in KEY=VALUE format')
    parser.add_argument('--gazetteer', help='Optional path to a reference gazetteer file')
    parser.add_argument('--district', help='District filter for WorldPop processing')
    parser.add_argument('--district-group', choices=sorted(DISTRICT_GROUPS.keys()), help='Named district group for WorldPop processing')
    parser.add_argument('--worldpop-year', type=int, default=DEFAULT_WORLDPOP_YEAR, help='WorldPop population year to use')
    parser.add_argument('--worldpop-dataset', default=DEFAULT_WORLDPOP_DATASET, choices=['wpgppop', 'wpgpas'], help='WorldPop stats dataset to query')
    parser.add_argument('--worldpop-api-key', help='Optional WorldPop API key')
    parser.add_argument('--school-age-min', type=int, default=DEFAULT_SCHOOL_AGE_MIN, help='Lower bound for school-age population aggregation')
    parser.add_argument('--school-age-max', type=int, default=DEFAULT_SCHOOL_AGE_MAX, help='Upper bound for school-age population aggregation')
    parser.add_argument('--child-class-max', type=int, default=DEFAULT_CHILD_CLASS_MAX, help='Maximum wpgpas class treated as child population')
    parser.add_argument('--analysis-type', action='append', choices=sorted(ANALYSIS_TYPES), help='Spatial analysis to run')
    parser.add_argument('--admin-level', choices=['District', 'TA', 'Village'], help='Administrative level for analysis')
    parser.add_argument('--coverage-distance-km', type=float, default=5.0, help='Coverage buffer distance in kilometers')
    parser.add_argument(
        '--missing-data-strategy',
        default='flag',
        choices=['flag', 'exclude', 'impute'],
        help='How to treat incomplete records',
    )

    args = parser.parse_args()
    session = get_session()
    selected_group_districts = DISTRICT_GROUPS.get(args.district_group, [])

    try:
        if args.type == 'worldpop':
            result = process_worldpop_dataset(
                session,
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
            result = process_analysis_dataset(
                session,
                analysis_types=args.analysis_type,
                admin_level=args.admin_level,
                coverage_distance_km=args.coverage_distance_km,
                raster_path=args.file,
                api_url=args.api_url,
                year=args.worldpop_year,
            )
        else:
            source_type = 'api' if args.source_type == 'api' else 'file'
            if source_type == 'file' and not args.file:
                raise ValueError('A file path is required for file-based ingestion')
            if source_type == 'api' and not args.api_url:
                raise ValueError('An API URL is required for API-based ingestion')

            result = process_tabular_dataset(
                session,
                dataset_type=args.type,
                source_type=source_type,
                file_path=args.file,
                api_url=args.api_url,
                api_headers=parse_headers(args.api_header),
                gazetteer_path=args.gazetteer,
                missing_data_strategy=args.missing_data_strategy,
            )

        print(
            'ETL completed successfully: '
            f"dataset={result['dataset_type']}, rows_loaded={result['rows_loaded']}, indicators_loaded={result['indicators_loaded']}"
        )
    except Exception as exc:
        filename = os.path.basename(args.file) if args.file else args.api_url
        try:
            log_etl_run(
                session,
                filename=filename,
                source_type=args.source_type,
                dataset_type=args.type,
                table_name=DATASET_CONFIG[args.type]['table_name'],
                rows_read=0,
                rows_processed=0,
                rows_loaded=0,
                rows_flagged=0,
                status='Failed',
                error=str(exc),
                metadata={'district': args.district},
                started_at=datetime.utcnow(),
                completed_at=datetime.utcnow(),
            )
        except Exception:
            pass
        print(f'ETL failed: {exc}')
        raise
    finally:
        session.close()


if __name__ == '__main__':
    main()
