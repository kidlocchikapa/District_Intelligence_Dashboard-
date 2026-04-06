import math
import re
from difflib import get_close_matches

import geopandas as gpd
import pandas as pd
from shapely.geometry import MultiPolygon, Point, Polygon
from shapely.validation import make_valid

from pipeline_config import GEOGRAPHIC_COLUMNS


def normalize_text(value):
    if value is None or pd.isna(value):
        return pd.NA

    compact = ' '.join(str(value).strip().split())
    if not compact:
        return pd.NA

    compact = compact.lower()
    compact = re.sub(r'[^a-z0-9\s]', ' ', compact)
    compact = re.sub(r'\s+', ' ', compact).strip()
    return compact or pd.NA

def standardize_schema(df, dataset_config):
    working = df.copy()
    original_columns = set(working.columns)
    rename_map = {}
    matched_columns = set()
    claimed_aliases = set()

    for canonical_name, aliases in dataset_config['canonical_columns'].items():
        for alias in aliases:
            if alias in claimed_aliases:
                continue
            if alias in working.columns:
                rename_map[alias] = canonical_name
                matched_columns.add(canonical_name)
                claimed_aliases.add(alias)
                break

    working = working.rename(columns=rename_map)

    if dataset_config.get('table_name') == 'administrative_units':
        working, matched_columns = infer_boundary_schema(working, matched_columns, original_columns)

    for column in dataset_config['canonical_columns']:
        if column not in working.columns:
            working[column] = pd.NA

    working.attrs['matched_columns'] = matched_columns
    return working

def infer_boundary_schema(df, matched_columns, original_columns=None):
    working = df.copy()
    source_columns = set(working.columns)
    original_columns = set(original_columns or set())
    all_columns = source_columns | original_columns

    def set_if_missing(column_name, candidate_columns):
        if column_name in matched_columns:
            return

        for candidate in candidate_columns:
            if candidate in source_columns:
                working[column_name] = working[candidate]
                matched_columns.add(column_name)
                return

        # After schema renaming, some signals are only available through their
        # canonical columns, so fall back to those when the original aliases
        # are no longer present in the current frame.
        canonical_fallbacks = {
            'code': ['code'],
            'name': ['name'],
            'district_name': ['district_name', 'name'],
            'ward_name': ['ward_name', 'name'],
            'parent_code': ['parent_code'],
        }
        for fallback in canonical_fallbacks.get(column_name, []):
            if fallback in source_columns and working[fallback].notna().any():
                if fallback != column_name:
                    working[column_name] = working[fallback]
                matched_columns.add(column_name)
                return

    set_if_missing('code', ['adm3_pcode', 'adm2_pcode', 'adm1_pcode'])
    set_if_missing('name', ['adm3_name', 'adm3_ref_n', 'adm2_name', 'adm1_name'])
    set_if_missing('district_name', ['adm2_name'])
    set_if_missing('ward_name', ['adm3_name', 'adm3_ref_n'])

    if 'parent_code' not in matched_columns:
        if 'parent_code' in source_columns and working['parent_code'].notna().any():
            matched_columns.add('parent_code')
        elif 'adm2_pcode' in all_columns and ('adm3_pcode' in all_columns or 'adm3_name' in all_columns):
            working['parent_code'] = working['adm2_pcode']
            matched_columns.add('parent_code')
        elif 'adm1_pcode' in all_columns and ('adm2_pcode' in all_columns or 'adm2_name' in all_columns):
            working['parent_code'] = working['adm1_pcode']
            matched_columns.add('parent_code')

    if 'type' not in matched_columns:
        if 'type' in source_columns and working['type'].notna().any():
            matched_columns.add('type')
        elif 'adm3_pcode' in all_columns or 'adm3_name' in all_columns or ('ward_name' in source_columns and working['ward_name'].notna().any()):
            working['type'] = 'Ward'
            matched_columns.add('type')
        elif 'adm2_pcode' in all_columns or 'adm2_name' in all_columns or ('district_name' in source_columns and working['district_name'].notna().any()):
            working['type'] = 'District'
            matched_columns.add('type')
        elif 'adm1_pcode' in all_columns or 'adm1_name' in all_columns:
            working['type'] = 'District'
            matched_columns.add('type')

    if 'level' not in matched_columns:
        if 'adm3_pcode' in all_columns or 'adm3_name' in all_columns:
            working['level'] = 'ADM3'
        elif 'adm2_pcode' in all_columns or 'adm2_name' in all_columns:
            working['level'] = 'ADM2'
        elif 'adm1_pcode' in all_columns or 'adm1_name' in all_columns:
            working['level'] = 'ADM1'

    return working, matched_columns

def validate_schema(df, dataset_config):
    matched_columns = df.attrs.get('matched_columns', set())
    missing_columns = []

    for column in dataset_config['required_columns']:
        if column in matched_columns:
            continue

        if column in df.columns and df[column].notna().any():
            continue

        missing_columns.append(column)

    if missing_columns:
        raise ValueError(f'Missing required columns: {missing_columns}')

    return df
