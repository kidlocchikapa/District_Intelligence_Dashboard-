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

def dms_to_decimal(value):
    pattern = re.compile(
        r'^\s*(?P<deg>-?\d+(?:\.\d+)?)'
        r'(?:[^\dA-Za-z]+(?P<min>\d+(?:\.\d+)?))?'
        r'(?:[^\dA-Za-z]+(?P<sec>\d+(?:\.\d+)?))?'
        r'\s*(?P<hem>[NSEW])?\s*$',
        re.IGNORECASE,
    )
    match = pattern.match(str(value))
    if not match:
        return None

    degrees = float(match.group('deg'))
    minutes = float(match.group('min') or 0)
    seconds = float(match.group('sec') or 0)
    hemisphere = (match.group('hem') or '').upper()

    decimal = abs(degrees) + minutes / 60 + seconds / 3600
    if degrees < 0 or hemisphere in {'S', 'W'}:
        decimal *= -1
    return decimal


def parse_coordinate_value(value):
    if value is None or pd.isna(value):
        return None

    if isinstance(value, (int, float)) and not math.isnan(value):
        return float(value)

    text = str(value).strip()
    if not text:
        return None

    try:
        return float(text)
    except ValueError:
        return dms_to_decimal(text)


def parse_coordinates(df, lon_col='longitude', lat_col='latitude', compound_col='coordinates'):
    working = df.copy()

    if compound_col in working.columns:
        extracted = working[compound_col].astype(str).str.extract(
            r'(?P<latitude>-?\d+(?:\.\d+)?)\s*[,/]\s*(?P<longitude>-?\d+(?:\.\d+)?)'
        )
        working['latitude'] = working['latitude'].fillna(extracted['latitude']) if 'latitude' in working.columns else extracted['latitude']
        working['longitude'] = working['longitude'].fillna(extracted['longitude']) if 'longitude' in working.columns else extracted['longitude']

    if lon_col not in working.columns:
        working[lon_col] = pd.NA
    if lat_col not in working.columns:
        working[lat_col] = pd.NA

    if 'geometry' in working.columns:
        point_geometries = working['geometry'].apply(
            lambda geom: geom if isinstance(geom, Point) else None
        )
        working[lon_col] = working[lon_col].fillna(point_geometries.apply(lambda geom: geom.x if geom is not None else pd.NA))
        working[lat_col] = working[lat_col].fillna(point_geometries.apply(lambda geom: geom.y if geom is not None else pd.NA))

    working[lon_col] = working[lon_col].apply(parse_coordinate_value)
    working[lat_col] = working[lat_col].apply(parse_coordinate_value)

    valid_bounds = (
        working[lon_col].between(-180, 180, inclusive='both')
        & working[lat_col].between(-90, 90, inclusive='both')
    )

    working['coordinate_status'] = valid_bounds.map(lambda is_valid: 'valid' if is_valid else 'missing_or_invalid')
    return working

def build_gazetteer_index(gazetteer_df):
    if gazetteer_df.empty:
        return {}

    index = {'district_name': {}, 'ward_name': {}, 'village_name': {}}
    for _, row in gazetteer_df.iterrows():
        for column, normalized_column in [
            ('district_name', 'normalized_district_name'),
            ('ward_name', 'normalized_ward_name'),
            ('village_name', 'normalized_village_name'),
        ]:
            normalized_value = row.get(normalized_column)
            if pd.isna(normalized_value):
                normalized_value = normalize_text(row.get(column))
            if pd.notna(normalized_value):
                index[column][normalized_value] = row.to_dict()

    return index


def match_geography(value, index):
    normalized = normalize_text(value)
    if pd.isna(normalized):
        return None, 'missing'

    if normalized in index:
        return index[normalized], 'exact'

    closest = get_close_matches(normalized, list(index.keys()), n=1, cutoff=0.85)
    if closest:
        return index[closest[0]], 'fuzzy'

    return None, 'unmatched'


def standardize_geography(df, gazetteer_df):
    working = df.copy()
    gazetteer_index = build_gazetteer_index(gazetteer_df)

    for geo_column in GEOGRAPHIC_COLUMNS:
        if geo_column not in working.columns:
            working[geo_column] = pd.NA

        working[f'input_{geo_column}'] = working[geo_column]
        working[geo_column] = working[geo_column].apply(normalize_text)

    working['geo_match_status'] = 'not_checked'
    working['geo_code'] = pd.NA

    if gazetteer_df.empty:
        return working

    matched_rows = []
    for _, row in working.iterrows():
        best_match = None
        statuses = []

        for geo_column in GEOGRAPHIC_COLUMNS:
            matched, status = match_geography(row.get(geo_column), gazetteer_index.get(geo_column, {}))
            statuses.append(status)
            if matched and not best_match:
                best_match = matched

        merged_row = row.to_dict()
        if best_match:
            merged_row['district_name'] = (
                best_match.get('normalized_district_name')
                if pd.notna(best_match.get('normalized_district_name'))
                else merged_row.get('district_name')
            )
            merged_row['ward_name'] = (
                best_match.get('normalized_ward_name')
                if pd.notna(best_match.get('normalized_ward_name'))
                else merged_row.get('ward_name')
            )
            merged_row['village_name'] = (
                best_match.get('normalized_village_name')
                if pd.notna(best_match.get('normalized_village_name'))
                else merged_row.get('village_name')
            )
            merged_row['geo_code'] = best_match.get('geo_code')
            merged_row['geo_match_status'] = 'matched'
            if 'fuzzy' in statuses:
                merged_row['geo_match_status'] = 'fuzzy_matched'
        else:
            merged_row['geo_match_status'] = 'unmatched' if any(status == 'unmatched' for status in statuses) else 'missing'

        matched_rows.append(merged_row)

    return pd.DataFrame(matched_rows)

def handle_missing_data(df, required_columns, strategy='flag'):
    working = df.copy()
    row_issues = []
    keep_mask = []

    for _, row in working.iterrows():
        missing_fields = []
        for column in required_columns:
            value = row.get(column)
            if pd.isna(value) or value == '':
                missing_fields.append(column)

        if row.get('coordinate_status') == 'missing_or_invalid':
            missing_fields.extend(['longitude', 'latitude'])

        row_issues.append(','.join(sorted(set(missing_fields))))

        if strategy == 'exclude' and missing_fields:
            keep_mask.append(False)
        else:
            keep_mask.append(True)

    working['etl_missing_fields'] = row_issues
    working['is_flagged'] = working['etl_missing_fields'].astype(str).str.len() > 0

    if strategy == 'impute':
        numeric_columns = working.select_dtypes(include=['number']).columns.tolist()
        for column in numeric_columns:
            if working[column].isna().any():
                median = working[column].median()
                if pd.notna(median):
                    working[column] = working[column].fillna(median)

    if strategy == 'exclude':
        working = working.loc[keep_mask].reset_index(drop=True)

    return working


def add_harmonized_names(df):
    working = df.copy()
    for column in ['district_name', 'ward_name', 'village_name', 'name', 'program_name', 'event_type', 'risk_level', 'type']:
        if column in working.columns:
            working[column] = working[column].apply(
                lambda value: value.title() if isinstance(value, str) and value == value.lower() else value
            )
    return working