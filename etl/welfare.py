import logging
import os
from datetime import datetime

import pandas as pd
import geopandas as gpd
from sqlalchemy import text
from shapely.ops import unary_union

from ingest import extract_source
from db_utils import log_etl_run
from load import (
    fetch_admin_unit_lookup,
    fetch_spatial_admin_lookup,
    assign_ward_ids,
    load_to_postgis,
    load_welfare_beneficiary_indicators,
    fetch_welfare_programs,
    run_step,
    log_step,
)
from transform import (
    standardize_schema,
    to_gdf,
)
from pipeline_config import DATASET_CONFIG

LOGGER = logging.getLogger('etl.welfare')

def normalize_welfare_beneficiary(df):
    """Standardizes demographic and status fields for welfare beneficiaries."""
    working = df.copy()

    if 'gender' in working.columns:
        working['gender'] = working['gender'].astype(str).str.strip().str.capitalize()
        working['gender'] = working['gender'].apply(
            lambda x: 'Male' if x in ['M', 'Male'] else ('Female' if x in ['F', 'Female'] else 'Other')
        )

    if 'age' in working.columns:
        working['age'] = pd.to_numeric(working['age'], errors='coerce').fillna(0).astype(int)

    if 'household_size' in working.columns:
        working['household_size'] = (
            pd.to_numeric(working['household_size'], errors='coerce').fillna(1).astype(int)
        )

    for column in ['start_date', 'end_date']:
        if column in working.columns:
            numeric_dates = pd.to_numeric(working[column], errors='coerce')
            excel_mask = numeric_dates.notna()
            parsed_dates = pd.to_datetime(working[column], errors='coerce')
            if excel_mask.any():
                parsed_dates.loc[excel_mask] = pd.to_datetime(
                    numeric_dates.loc[excel_mask],
                    unit='D',
                    origin='1899-12-30',
                    errors='coerce',
                )
            working[column] = parsed_dates.dt.date

    if 'status' in working.columns:
        working['status'] = working['status'].astype(str).str.strip().str.lower()
        working['status'] = working['status'].replace({'': pd.NA, 'nan': pd.NA, '<na>': pd.NA})

    return working

def compute_welfare_indicators(
    beneficiaries_gdf,
    flood_gdf,
    health_gdf,
    school_gdf,
    health_dist_km=8.0,
    school_dist_km=3.0,
):
    """Calculates spatial indicators for beneficiaries based on proximity to services and hazards."""
    # Ensure project to metric CRS for distance calculations
    beneficiaries_proj = beneficiaries_gdf.to_crs('EPSG:3857')

    # Affected by flood
    if flood_gdf is not None and not flood_gdf.empty:
        high_risk = flood_gdf[flood_gdf['risk_level'].isin(['High', 'Critical'])]
        if not high_risk.empty:
            flood_union = unary_union(high_risk.to_crs('EPSG:3857').geometry.tolist())
            beneficiaries_gdf['affected_by_flood'] = beneficiaries_proj.geometry.intersects(
                flood_union
            )
        else:
            beneficiaries_gdf['affected_by_flood'] = False
    else:
        beneficiaries_gdf['affected_by_flood'] = False

    # Health access
    if health_gdf is not None and not health_gdf.empty:
        health_proj = health_gdf.to_crs('EPSG:3857')
        health_buffer = unary_union(health_proj.geometry.buffer(health_dist_km * 1000).tolist())
        beneficiaries_gdf['has_health_facility_access'] = beneficiaries_proj.geometry.intersects(
            health_buffer
        )
    else:
        beneficiaries_gdf['has_health_facility_access'] = False

    # School access
    if school_gdf is not None and not school_gdf.empty:
        school_proj = school_gdf.to_crs('EPSG:3857')
        school_buffer = unary_union(school_proj.geometry.buffer(school_dist_km * 1000).tolist())
        beneficiaries_gdf['has_school_access'] = beneficiaries_proj.geometry.intersects(
            school_buffer
        )
    else:
        beneficiaries_gdf['has_school_access'] = False

    return beneficiaries_gdf

def process_welfare_beneficiary_dataset(
    session,
    file_path=None,
    api_url=None,
    api_headers=None,
    program_id=None,
    health_dist_km=8.0,
    school_dist_km=3.0,
):
    """Main orchestration for the welfare beneficiary ETL pipeline."""
    started_at = datetime.utcnow()
    dataset_type = 'welfare_beneficiary'
    dataset_config = DATASET_CONFIG[dataset_type]
    source_name = os.path.basename(file_path) if file_path else api_url

    raw_df = run_step(
        step_name='extract_source',
        user_message_on_error='Could not read input data.',
        fn=extract_source,
        source_type='file' if file_path else 'api',
        file_path=file_path,
        api_url=api_url,
        api_headers=api_headers,
    )

    transformed_df = run_step(
        step_name='standardize_schema',
        user_message_on_error='Input columns do not match the expected schema.',
        fn=standardize_schema,
        df=raw_df,
        dataset_config=dataset_config,
    )

    transformed_df = run_step(
        step_name='normalize_welfare_beneficiary',
        user_message_on_error='Could not normalize beneficiary data.',
        fn=normalize_welfare_beneficiary,
        df=transformed_df,
    )

    programs_lookup = run_step(
        step_name='fetch_welfare_programs',
        user_message_on_error='Could not fetch welfare programs from database.',
        fn=fetch_welfare_programs,
        session=session,
    )
    valid_program_ids = set(programs_lookup.values())

    if program_id is not None:
        if int(program_id) not in valid_program_ids:
            raise ValueError(f'Program id {program_id} was not found in welfare_programs')
        transformed_df['program_id'] = int(program_id)
    else:
        if 'program_name' not in transformed_df.columns or transformed_df['program_name'].isna().all():
            raise ValueError(
                'A welfare beneficiary upload must include program_name in the file or provide program_id at upload time'
            )

        def map_program_id(name):
            return programs_lookup.get(str(name).strip().lower())

        transformed_df['program_id'] = transformed_df['program_name'].apply(map_program_id)

        missing_programs = transformed_df[transformed_df['program_id'].isna()]['program_name'].dropna().unique()
        if len(missing_programs) > 0:
            log_step(
                'process_welfare',
                f"Warning: Found {len(missing_programs)} programs not in DB: {missing_programs}",
                level='warning',
            )

    # Geography assignment
    admin_lookup = run_step(
        step_name='fetch_admin_unit_lookup',
        user_message_on_error='Could not load admin lookup data.',
        fn=fetch_admin_unit_lookup,
        session=session,
    )
    spatial_lookup = run_step(
        step_name='fetch_spatial_admin_lookup',
        user_message_on_error='Could not load spatial lookup data.',
        fn=fetch_spatial_admin_lookup,
        session=session,
    )
    transformed_df = run_step(
        step_name='assign_geography',
        user_message_on_error='Geography assignment failed.',
        fn=assign_ward_ids,
        df=transformed_df,
        admin_lookup=admin_lookup,
        spatial_lookup=spatial_lookup,
    )

    gdf = run_step(
        step_name='to_gdf',
        user_message_on_error='Could not convert to geospatial format.',
        fn=to_gdf,
        df=transformed_df,
    )

    # Indicator computation
    log_step('process_welfare', 'Fetching reference layers for indicator computation...')
    flood_gdf = gpd.read_postgis(
        text("SELECT id, risk_level, geom FROM flood_zones"), session.bind, geom_col='geom'
    )
    health_gdf = gpd.read_postgis(
        text("SELECT id, geom FROM health_facilities"), session.bind, geom_col='geom'
    )
    school_gdf = gpd.read_postgis(
        text("SELECT school_id as id, geom FROM education_facilities"),
        session.bind,
        geom_col='geom',
    )

    gdf = run_step(
        step_name='compute_welfare_indicators',
        user_message_on_error='Could not compute welfare indicators.',
        fn=compute_welfare_indicators,
        beneficiaries_gdf=gdf,
        flood_gdf=flood_gdf,
        health_gdf=health_gdf,
        school_gdf=school_gdf,
        health_dist_km=health_dist_km,
        school_dist_km=school_dist_km,
    )

    # Loading
    rows_loaded, table_name = run_step(
        step_name='load_beneficiaries',
        user_message_on_error='Failed to save beneficiaries.',
        fn=load_to_postgis,
        session=session,
        gdf=gdf,
        dataset_type=dataset_type,
    )

    # Get the generated IDs to link to indicators
    new_records_df = pd.read_sql(
        text(
            f"SELECT id as beneficiary_id, firstname, lastname, program_id FROM {table_name} ORDER BY id DESC LIMIT :count"
        ),
        session.bind,
        params={'count': rows_loaded},
    )

    # Merge indicators back
    indicators_df = gdf[
        [
            'firstname',
            'lastname',
            'program_id',
            'ta_id',
            'district_id',
            'affected_by_flood',
            'has_school_access',
            'has_health_facility_access',
        ]
    ].copy()
    indicators_df = indicators_df.merge(new_records_df, on=['firstname', 'lastname', 'program_id'])

    indicators_loaded = run_step(
        step_name='load_indicators',
        user_message_on_error='Failed to save welfare indicators.',
        fn=load_welfare_beneficiary_indicators,
        session=session,
        indicators_df=indicators_df,
    )

    log_etl_run(
        session,
        filename=source_name,
        source_type='file' if file_path else 'api',
        dataset_type=dataset_type,
        table_name=table_name,
        rows_read=len(raw_df),
        rows_processed=len(transformed_df),
        rows_loaded=rows_loaded,
        rows_flagged=0,
        status='Success',
        metadata={
            'indicator_rows_loaded': indicators_loaded,
            'program_id': int(program_id) if program_id is not None else None,
            'health_dist_km': health_dist_km,
            'school_dist_km': school_dist_km,
        },
        started_at=started_at,
        completed_at=datetime.utcnow(),
    )

    return {
        'dataset_type': dataset_type,
        'table_name': table_name,
        'rows_read': len(raw_df),
        'rows_processed': len(transformed_df),
        'rows_loaded': rows_loaded,
        'rows_flagged': 0,
        'indicators_loaded': indicators_loaded,
    }
