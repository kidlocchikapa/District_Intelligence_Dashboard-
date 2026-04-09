import json

import pandas as pd
from geoalchemy2 import Geometry, WKTElement
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import text

from pipeline_config import DATASET_CONFIG


def fetch_admin_unit_lookup(session):
    query = text(
        """
        SELECT id, code, name, type, parent_id
        FROM administrative_units
        """
    )
    rows = session.execute(query).mappings().all()
    lookup = {}
    by_id = {}
    for row in rows:
        normalized_name = str(row['name']).strip().lower() if row['name'] else None
        record = {
            'id': row['id'],
            'code': row['code'],
            'type': (row['type'] or '').strip().lower(),
            'parent_id': row['parent_id'],
        }
        by_id[row['id']] = record
        if normalized_name:
            lookup[(normalized_name, (row['type'] or '').strip().lower())] = record
            lookup[(normalized_name, '')] = record
    return {'by_name': lookup, 'by_id': by_id}


def assign_ward_ids(df, admin_lookup):
    working = df.copy()
    ward_ids = []
    district_ids = []
    geo_codes = []
    lookup_by_name = admin_lookup['by_name']
    lookup_by_id = admin_lookup['by_id']

    for _, row in working.iterrows():
        ward_name = (row.get('ward_name') or '').strip().lower() if pd.notna(row.get('ward_name')) else ''
        district_name = (row.get('district_name') or '').strip().lower() if pd.notna(row.get('district_name')) else ''

        ward_match = lookup_by_name.get((ward_name, 'ward')) or lookup_by_name.get((ward_name, ''))
        district_match = lookup_by_name.get((district_name, 'district')) or lookup_by_name.get((district_name, ''))

        ward_id = ward_match['id'] if ward_match and ward_match['type'] == 'ward' else None
        district_id = district_match['id'] if district_match and district_match['type'] == 'district' else None

        if ward_match and ward_match.get('parent_id'):
            parent = lookup_by_id.get(ward_match['parent_id'])
            if parent and parent['type'] == 'district':
                district_id = parent['id']

        chosen = ward_match or district_match
        ward_ids.append(ward_id)
        district_ids.append(district_id)
        geo_codes.append(row.get('geo_code') if pd.notna(row.get('geo_code')) else (chosen['code'] if chosen else None))

    working['ward_id'] = ward_ids
    working['district_id'] = district_ids
    working['geo_code'] = geo_codes
    return working


def prepare_dataframe_for_load(df, dataset_type):
    working = df.copy()
    load_columns = DATASET_CONFIG[dataset_type]['load_columns']

    for column in load_columns:
        if column not in working.columns:
            working[column] = pd.NA

    if 'geometry' in working.columns:
        working['geom'] = working['geometry'].apply(
            lambda geom: WKTElement(geom.wkt, srid=4326) if geom is not None else None
        )

    if 'centroid' in working.columns:
        working['centroid'] = working['centroid'].apply(
            lambda geom: WKTElement(geom.wkt, srid=4326) if geom is not None else None
        )

    if 'simplified_geom' in working.columns:
        working['simplified_geom'] = working['simplified_geom'].apply(
            lambda geom: WKTElement(geom.wkt, srid=4326) if geom is not None else None
        )

    if 'services_offered' in working.columns:
        working['services_offered'] = working['services_offered'].apply(_coerce_array)

    if 'metadata' in working.columns:
        working['metadata'] = working['metadata'].apply(_sanitize_json_value)

    return working[load_columns]


def _sanitize_json_value(value):
    if value is None or value is pd.NA:
        return None

    try:
        if pd.isna(value):
            return None
    except TypeError:
        pass

    if isinstance(value, dict):
        return {
            key: _sanitize_json_value(item)
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [_sanitize_json_value(item) for item in value]

    return value


def _coerce_array(value):
    if value is None or pd.isna(value):
        return None
    if isinstance(value, list):
        return value
    return [item.strip() for item in str(value).split(',') if item.strip()]


def load_to_postgis(session, gdf, dataset_type, if_exists='append'):
    engine = session.bind
    table_name = DATASET_CONFIG[dataset_type]['table_name']
    load_df = prepare_dataframe_for_load(gdf, dataset_type)

    if dataset_type == 'boundaries':
        truncate_table(session, table_name)
        load_df.to_sql(
            table_name,
            engine,
            if_exists='append',
            index=False,
            dtype={
                'geom': Geometry('MULTIPOLYGON', srid=4326),
                'centroid': Geometry('POINT', srid=4326),
                'simplified_geom': Geometry('MULTIPOLYGON', srid=4326),
                'metadata': JSONB,
            },
        )
        resolve_boundary_parent_ids(session)
        return len(load_df), table_name

    geom_type = 'MULTIPOLYGON' if dataset_type == 'disaster' else 'POINT'
    load_df.to_sql(
        table_name,
        engine,
        if_exists=if_exists,
        index=False,
        dtype={'geom': Geometry(geom_type, srid=4326)},
    )
    return len(load_df), table_name


def load_unified_indicators(session, indicators_df, source_filename=None):
    if indicators_df is None or indicators_df.empty:
        return 0

    engine = session.bind
    working = indicators_df.copy()
    working['source_filename'] = source_filename
    working['metadata'] = working['metadata'].apply(_sanitize_json_value)

    working.to_sql('unified_indicators', engine, if_exists='append', index=False, dtype={'metadata': JSONB})
    return len(working)


def load_worldpop_age_sex(session, age_sex_df):
    if age_sex_df is None or age_sex_df.empty:
        return 0

    engine = session.bind
    working = age_sex_df.copy()
    working['metadata'] = working['metadata'].apply(_sanitize_json_value)

    years = [int(year) for year in working['worldpop_year'].dropna().unique().tolist()]
    admin_unit_ids = [int(admin_id) for admin_id in working['admin_unit_id'].dropna().unique().tolist()]

    if years and admin_unit_ids:
        session.execute(
            text(
                """
                DELETE FROM worldpop_age_sex
                WHERE worldpop_year = ANY(:years)
                  AND admin_unit_id = ANY(:admin_unit_ids)
                """
            ),
            {
                'years': years,
                'admin_unit_ids': admin_unit_ids,
            },
        )
        session.commit()

    working.to_sql(
        'worldpop_age_sex',
        engine,
        if_exists='append',
        index=False,
        dtype={'metadata': JSONB},
    )
    return len(working)


def load_analysis_results(session, analysis_df):
    if analysis_df is None or analysis_df.empty:
        return 0

    engine = session.bind
    working = analysis_df.copy()
    working['metadata'] = working['metadata'].apply(_sanitize_json_value)
    working['geom'] = working['geom'].apply(
        lambda geom: WKTElement(geom.wkt, srid=4326) if geom is not None else None
    )

    analysis_types = working['analysis_type'].dropna().unique().tolist()
    if analysis_types:
        session.execute(
            text("DELETE FROM analysis_results WHERE analysis_type = ANY(:analysis_types)"),
            {'analysis_types': analysis_types},
        )
        session.commit()

    working.to_sql(
        'analysis_results',
        engine,
        if_exists='append',
        index=False,
        dtype={
            'geom': Geometry('MULTIPOLYGON', srid=4326),
            'metadata': JSONB,
        },
    )
    return len(working)


def truncate_table(session, table_name):
    session.execute(text(f'TRUNCATE TABLE {table_name} CASCADE'))
    session.commit()


def resolve_boundary_parent_ids(session):
    session.execute(
        text(
            """
            UPDATE administrative_units child
            SET parent_id = parent.id
            FROM administrative_units parent
            WHERE child.metadata ->> 'parent_code' = parent.code
            """
        )
    )
    session.commit()