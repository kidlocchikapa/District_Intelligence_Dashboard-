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

    if {'parent_code', 'valid_on', 'boundary_version'}.issubset(set(dataset_config.get('canonical_columns', {}).keys())):
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
            # Do not infer ward_name from a generic name column. District-only
            # boundary files often have a single district label field, and using
            # it here incorrectly reclassifies districts as wards.
            'ward_name': ['ward_name'],
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


def coerce_numeric_columns(df, numeric_columns):
    working = df.copy()

    for column in numeric_columns:
        if column not in working.columns:
            continue

        # Normalize common formatted numeric strings before coercion.
        cleaned = (
            working[column]
            .astype("string")
            .str.replace(",", "", regex=False)
            .str.strip()
        )
        cleaned = cleaned.replace(
            {
                "": pd.NA,
                "nan": pd.NA,
                "NaN": pd.NA,
                "<NA>": pd.NA,
                "None": pd.NA,
                "null": pd.NA,
            }
        )
        working[column] = pd.to_numeric(cleaned, errors="coerce")

    return working

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

def _clean_text_or_na(value):
    if value is None or pd.isna(value):
        return pd.NA

    text = ' '.join(str(value).strip().split())
    return text if text else pd.NA


def _first_present(*values):
    for value in values:
        cleaned = _clean_text_or_na(value)
        if pd.notna(cleaned):
            return cleaned
    return pd.NA


def _coerce_boundary_date(value):
    cleaned = _clean_text_or_na(value)
    if pd.isna(cleaned):
        return pd.NA

    parsed = pd.to_datetime(cleaned, errors='coerce')
    if pd.isna(parsed):
        return pd.NA

    return parsed.date()


def _serialize_boundary_date(value):
    if value is None or value is pd.NA:
        return None

    try:
        if pd.isna(value):
            return None
    except TypeError:
        pass

    if hasattr(value, 'isoformat'):
        return value.isoformat()

    parsed = pd.to_datetime(value, errors='coerce')
    if pd.isna(parsed):
        return None

    return parsed.date().isoformat()


def _build_boundary_metadata(row):
    unit_type = row.get('type')
    traditional_authority = _first_present(row.get('reference_name'), row.get('adm3_ref_n'))
    district_name = _first_present(
        row.get('district_name'),
        row.get('adm2_name'),
        row.get('name') if unit_type == 'District' else pd.NA,
    )
    district_code = _first_present(
        row.get('adm2_pcode'),
        row.get('code') if unit_type == 'District' else pd.NA,
    )
    ward_name = _first_present(
        row.get('adm3_name'),
    )
    ward_code = _first_present(
        row.get('adm3_pcode'),
        row.get('code') if unit_type == 'Ward' else pd.NA,
    )
    village_name = _first_present(
        row.get('village_name'),
        row.get('adm4_name'),
        row.get('name') if unit_type == 'Village' else pd.NA,
    )
    if pd.isna(ward_name) and unit_type == 'Ward':
        fallback_ward_name = _first_present(row.get('ward_name'), row.get('name'))
        if pd.notna(fallback_ward_name):
            if pd.isna(traditional_authority) or normalize_text(fallback_ward_name) != normalize_text(traditional_authority):
                ward_name = fallback_ward_name

    metadata = {
        'parent_code': _first_present(row.get('parent_code')),
        'country': _first_present(row.get('adm0_name')),
        'country_code': _first_present(row.get('adm0_pcode')),
        'region': _first_present(row.get('adm1_name')),
        'region_code': _first_present(
            row.get('adm1_pcode'),
            row.get('parent_code') if unit_type == 'District' else pd.NA,
        ),
        'district': district_name,
        'district_code': district_code,
        'traditional_authority': traditional_authority,
        'ward': ward_name,
        'ward_code': ward_code,
        'village': village_name,
        'district_name': district_name,
        'ward_name': ward_name,
        'village_name': village_name,
        'reference_name': traditional_authority,
        'valid_on': _serialize_boundary_date(row.get('valid_on')),
        'boundary_version': _first_present(row.get('boundary_version'), row.get('version')),
    }

    return {
        key: value
        for key, value in metadata.items()
        if value is not None and pd.notna(value)
    }


def _derive_health_name(row):
    for candidate in [row.get('name'), row.get('name:en'), row.get('name:ny')]:
        cleaned = _clean_text_or_na(candidate)
        if pd.notna(cleaned):
            return cleaned

    base_label = None
    for candidate in [row.get('healthcare'), row.get('amenity'), row.get('type')]:
        cleaned = _clean_text_or_na(candidate)
        if pd.notna(cleaned):
            base_label = str(cleaned).replace('_', ' ').title()
            break

    osm_id = row.get('osm_id')
    if base_label and pd.notna(osm_id):
        return f'{base_label} (OSM {int(osm_id)})'
    if base_label:
        return base_label
    if pd.notna(osm_id):
        return f'Health Facility (OSM {int(osm_id)})'
    return pd.NA


def normalize_health_dataset(df):
    working = df.copy()

    if 'name' not in working.columns:
        working['name'] = pd.NA
    if 'common_name' not in working.columns:
        working['common_name'] = pd.NA
    if 'code' not in working.columns:
        working['code'] = pd.NA
    if 'ownership' not in working.columns:
        working['ownership'] = pd.NA
    if 'zone' not in working.columns:
        working['zone'] = pd.NA
    if 'district' not in working.columns:
        working['district'] = pd.NA
    if 'type' not in working.columns:
        working['type'] = pd.NA
    if 'services_offered' not in working.columns:
        working['services_offered'] = pd.NA

    working['name'] = working.apply(_derive_health_name, axis=1)

    working['type'] = working['type'].fillna(working.get('healthcare'))
    working['type'] = working['type'].fillna(working.get('amenity'))
    working['type'] = working['type'].apply(
        lambda value: str(value).replace('_', ' ').title() if pd.notna(value) else pd.NA
    )

    working['common_name'] = working['common_name'].fillna(working.get('name:en'))
    working['ownership'] = working['ownership'].fillna(working.get('operator:type'))
    working['zone'] = working['zone'].fillna(working.get('addr:city'))
    working['district'] = working['district'].fillna(working.get('district_name'))
    working['code'] = working['code'].fillna(working.get('osm_id'))

    working['services_offered'] = working['services_offered'].fillna(working.get('healthcare'))
    working['services_offered'] = working['services_offered'].fillna(working.get('healthcare:speciality'))
    return working

def to_gdf(df, lon_col='longitude', lat_col='latitude', crs='EPSG:4326'):
    working = df.copy()
    valid_points = working[lon_col].notna() & working[lat_col].notna()
    geometries = []
    for _, row in working.iterrows():
        if valid_points.loc[row.name]:
            geometries.append(Point(row[lon_col], row[lat_col]))
        else:
            geometries.append(None)
    return gpd.GeoDataFrame(working, crs=crs, geometry=geometries)


def to_polygon_gdf(df, geometry_column='geometry', crs='EPSG:4326'):
    working = df.copy()
    return gpd.GeoDataFrame(working, crs=crs, geometry=geometry_column)

def normalize_admin_unit_type(value):
    normalized = normalize_text(value)
    mapping = {
        'district': 'District',
        'ta': 'TA',
        'traditional_authority': 'TA',
        'traditional authority': 'TA',
        'ward': 'Ward',
        'village': 'Village',
        'adm1': 'District',
        'adm2': 'District',
        'adm3': 'Ward',
        'admin1': 'District',
        'admin2': 'District',
        'admin3': 'Ward',
        'level1': 'District',
        'level2': 'District',
        'level3': 'Ward',
    }
    return mapping.get(normalized, value.title() if isinstance(value, str) else value)

def infer_boundary_type(row):
    direct_type = normalize_admin_unit_type(row.get('type'))
    if isinstance(direct_type, str) and direct_type in {'District', 'TA', 'Ward', 'Village'}:
        return direct_type

    level_type = normalize_admin_unit_type(row.get('level'))
    if isinstance(level_type, str) and level_type in {'District', 'TA', 'Ward', 'Village'}:
        return level_type

    district_name = row.get('district_name')
    ward_name = row.get('ward_name')
    parent_code = row.get('parent_code')
    name = row.get('name')
    reference_name = _first_present(row.get('reference_name'), row.get('adm3_ref_n'))

    if pd.notna(reference_name):
        normalized_reference = normalize_text(reference_name)
        normalized_name = normalize_text(name)
        normalized_ward_name = normalize_text(ward_name)
        if normalized_reference and normalized_reference != normalized_ward_name:
            if normalized_name == normalized_reference or pd.isna(ward_name):
                return 'TA'

    if pd.notna(ward_name) and pd.notna(district_name):
        if pd.notna(name) and str(name).strip().lower() == str(ward_name).strip().lower():
            return 'Ward'

    if pd.notna(parent_code):
        if pd.notna(reference_name) and (
            pd.isna(ward_name) or normalize_text(reference_name) != normalize_text(ward_name)
        ):
            return 'TA'
        return 'Ward'

    return 'District'

def ensure_valid_multipolygon(geometry):
    if geometry is None:
        return None
    fixed = make_valid(geometry)
    if isinstance(fixed, Polygon):
        return MultiPolygon([fixed])
    if isinstance(fixed, MultiPolygon):
        return fixed
    if hasattr(fixed, 'geoms'):
        polygons = [geom for geom in fixed.geoms if isinstance(geom, Polygon)]
        if polygons:
            return MultiPolygon(polygons)
    return None

def transform_boundary_dataset(df):
    if 'geometry' not in df.columns:
        raise ValueError('Boundary dataset must include polygon geometry')

    working = gpd.GeoDataFrame(df.copy(), geometry='geometry', crs=getattr(df, 'crs', None) or 'EPSG:4326')
    if working.crs is None:
        working = working.set_crs('EPSG:4326')
    elif working.crs.to_string() != 'EPSG:4326':
        working = working.to_crs('EPSG:4326')

    working['type'] = working.apply(infer_boundary_type, axis=1)
    valid_types = {'District', 'TA', 'Ward', 'Village'}
    invalid_types = working['type'].isin(valid_types) == False
    if invalid_types.any():
        bad_types = sorted(set(working.loc[invalid_types, 'type'].dropna().astype(str)))
        raise ValueError(f'Unsupported administrative unit types: {bad_types}')

    working['code'] = working['code'].apply(
        lambda value: str(value).strip() if pd.notna(value) else pd.NA
    )
    working['code'] = working['code'].replace({
        '': pd.NA,
        'nan': pd.NA,
        'NaN': pd.NA,
        '<NA>': pd.NA,
        'None': pd.NA,
        'null': pd.NA,
    })
    for column in ['parent_code', 'valid_on', 'boundary_version', 'reference_name']:
        if column not in working.columns:
            working[column] = pd.NA

    working['parent_code'] = working['parent_code'].apply(lambda value: str(value).strip() if pd.notna(value) else pd.NA)
    working['valid_on'] = working['valid_on'].apply(_coerce_boundary_date)
    working['boundary_version'] = working.apply(
        lambda row: _first_present(row.get('boundary_version'), row.get('version')),
        axis=1,
    )
    working['reference_name'] = working.apply(
        lambda row: _first_present(row.get('reference_name'), row.get('adm3_ref_n')),
        axis=1,
    )
    if 'name' not in working.columns:
        working['name'] = pd.NA

    if 'ward_name' in working.columns:
        working['name'] = working['name'].fillna(working['ward_name'])
    if 'district_name' in working.columns:
        working['name'] = working['name'].fillna(working['district_name'])
    working['name'] = working['name'].fillna(working['code'])
    working['name'] = working['name'].apply(lambda value: value.title() if isinstance(value, str) else value)
    working['geometry'] = working['geometry'].apply(ensure_valid_multipolygon)

    if working['geometry'].isna().any():
        raise ValueError('Boundary dataset contains invalid or non-polygon geometries')

    if working['code'].isna().any():
        raise ValueError(
            'Boundary dataset contains rows with missing codes. '
            'Map a unique boundary code field such as code, gid, adm2_pcode, or adm3_pcode.'
        )

    if working['code'].duplicated().any():
        duplicates = working.loc[working['code'].duplicated(), 'code'].dropna().tolist()
        raise ValueError(f'Duplicate administrative unit codes found: {duplicates}')

    if working['name'].isna().any():
        raise ValueError('Boundary dataset contains rows with missing names')

    projected = working.to_crs('EPSG:3857')
    working['area_sq_km'] = projected.geometry.area / 10**6
    working['centroid'] = projected.geometry.centroid.to_crs('EPSG:4326')
    working['simplified_geom'] = projected.geometry.simplify(30).to_crs('EPSG:4326').apply(ensure_valid_multipolygon)
    working['population_total'] = 0
    working['population_density'] = 0.0
    working['metadata'] = working.apply(_build_boundary_metadata, axis=1)

    return working

def normalize_risk_level(value):
    normalized = normalize_text(value)
    mapping = {
        'low': 'Low',
        'medium': 'Medium',
        'high': 'High',
    }
    return mapping.get(normalized, value.title() if isinstance(value, str) else value)

def transform_disaster_dataset(df):
    if 'geometry' not in df.columns:
        raise ValueError('Disaster dataset must include polygon geometry')

    working = gpd.GeoDataFrame(df.copy(), geometry='geometry', crs=getattr(df, 'crs', None) or 'EPSG:4326')
    if working.crs is None:
        working = working.set_crs('EPSG:4326')
    elif working.crs.to_string() != 'EPSG:4326':
        working = working.to_crs('EPSG:4326')

    working['risk_level'] = working['risk_level'].apply(normalize_risk_level)
    valid_levels = {'Low', 'Medium', 'High'}
    invalid_levels = working['risk_level'].isin(valid_levels) == False
    if invalid_levels.any():
        bad_levels = sorted(set(working.loc[invalid_levels, 'risk_level'].dropna().astype(str)))
        raise ValueError(f'Unsupported disaster risk levels: {bad_levels}')

    working['geometry'] = working['geometry'].apply(ensure_valid_multipolygon)
    if working['geometry'].isna().any():
        raise ValueError('Disaster dataset contains invalid or non-polygon geometries')

    return working

def derive_indicators(df, dataset_type, admin_units_df):
    working = df.copy()
    indicators = []

    if admin_units_df is None or admin_units_df.empty:
        return pd.DataFrame(indicators)

    population_lookup = {'ward': {}, 'district': {}}
    for _, row in admin_units_df.iterrows():
        geo_name = normalize_text(row.get('name'))
        geo_level = normalize_text(row.get('type'))
        if pd.notna(geo_name):
            population_lookup['ward' if geo_level == 'ward' else 'district'][geo_name] = {
                'population_total': row.get('population_total') or 0,
                'code': row.get('code'),
            }

    geographic_column, geographic_level = infer_geographic_level(working)
    if not geographic_column:
        return pd.DataFrame(indicators)

    if dataset_type == 'education':
        grouped = working.groupby(geographic_column, dropna=True).agg(
            facilities=('name', 'count'),
            student_enrollment_total=('student_enrollment_total', 'sum'),
            teacher_count=('teacher_count', 'sum'),
        )
        for geographic_name, row in grouped.iterrows():
            population = population_lookup[geographic_level].get(normalize_text(geographic_name), {}).get('population_total', 0) or 0
            code = population_lookup[geographic_level].get(normalize_text(geographic_name), {}).get('code')
            if population:
                indicators.append(
                    indicator_record(dataset_type, 'schools_per_1000_population', geographic_level, geographic_name, code, row['facilities'] * 1000 / population)
                )
            indicators.append(
                indicator_record(dataset_type, 'student_enrollment_total', geographic_level, geographic_name, code, row['student_enrollment_total'] or 0)
            )
            if row['student_enrollment_total']:
                indicators.append(
                    indicator_record(dataset_type, 'teachers_per_100_students', geographic_level, geographic_name, code, row['teacher_count'] * 100 / row['student_enrollment_total'])
                )

    if dataset_type == 'health':
        grouped = working.groupby(geographic_column, dropna=True).agg(
            facilities=('name', 'count'),
            beds_count=('beds_count', 'sum'),
            patient_visits_total=('patient_visits_total', 'sum'),
        )
        for geographic_name, row in grouped.iterrows():
            population = population_lookup[geographic_level].get(normalize_text(geographic_name), {}).get('population_total', 0) or 0
            code = population_lookup[geographic_level].get(normalize_text(geographic_name), {}).get('code')
            if population:
                indicators.append(
                    indicator_record(dataset_type, 'health_facilities_per_1000_population', geographic_level, geographic_name, code, row['facilities'] * 1000 / population)
                )
                indicators.append(
                    indicator_record(dataset_type, 'beds_per_1000_population', geographic_level, geographic_name, code, row['beds_count'] * 1000 / population)
                )
            indicators.append(
                indicator_record(dataset_type, 'patient_visits_total', geographic_level, geographic_name, code, row['patient_visits_total'] or 0)
            )

    if dataset_type == 'welfare':
        grouped = working.groupby(geographic_column, dropna=True).agg(
            beneficiary_count=('beneficiary_count', 'sum'),
        )
        for geographic_name, row in grouped.iterrows():
            population = population_lookup[geographic_level].get(normalize_text(geographic_name), {}).get('population_total', 0) or 0
            code = population_lookup[geographic_level].get(normalize_text(geographic_name), {}).get('code')
            if population:
                indicators.append(
                    indicator_record(dataset_type, 'beneficiaries_per_1000_population', geographic_level, geographic_name, code, row['beneficiary_count'] * 1000 / population)
                )

    if dataset_type == 'disaster' and 'population_at_risk' in working.columns:
        grouped = working.groupby(geographic_column, dropna=True).agg(
            population_at_risk=('population_at_risk', 'sum'),
        )
        for geographic_name, row in grouped.iterrows():
            code = population_lookup[geographic_level].get(normalize_text(geographic_name), {}).get('code')
            indicators.append(
                indicator_record(dataset_type, 'population_at_risk_total', geographic_level, geographic_name, code, row['population_at_risk'])
            )

    return pd.DataFrame(indicators)

def infer_geographic_level(df):
    if 'ward_name' in df.columns and df['ward_name'].notna().any():
        return 'ward_name', 'ward'
    if 'district_name' in df.columns and df['district_name'].notna().any():
        return 'district_name', 'district'
    return None, None

def indicator_record(dataset_type, indicator_name, geographic_level, geographic_name, geographic_code, indicator_value):
    return {
        'dataset_type': dataset_type,
        'indicator_name': indicator_name,
        'geographic_level': geographic_level,
        'geographic_name': geographic_name,
        'geographic_code': geographic_code,
        'indicator_value': float(indicator_value),
        'metadata': {},
    }

def spatial_join(points_gdf, polygons_gdf, join_type='left', op='within'):
    return gpd.sjoin(points_gdf, polygons_gdf, how=join_type, predicate=op)

def ensure_multipolygon(geometry):
    if geometry is None:
        return None
    if isinstance(geometry, MultiPolygon):
        return geometry
    if isinstance(geometry, Polygon):
        return MultiPolygon([geometry])
    return geometry
