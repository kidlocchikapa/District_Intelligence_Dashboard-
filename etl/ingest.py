#import libaries
import json
import logging
import os
import shutil
import tempfile
import zipfile
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import geopandas as gpd
import pandas as pd
from shapely.geometry import LineString

#importing third-party libaries
from db_utils import read_table
from pipeline_config import MISSING_VALUE_TOKENS

# Define supported file extensions for geospatial and tabular data
GEOSPATIAL_FILE_EXTENSIONS = ['.shp', '.geojson', '.gpkg']
TABULAR_FILE_EXTENSIONS = ['.csv', '.xls', '.xlsx', '.json']
SUPPORTED_FILE_EXTENSIONS = GEOSPATIAL_FILE_EXTENSIONS + TABULAR_FILE_EXTENSIONS

# Set up logging for the ingest module
LOGGER = logging.getLogger('etl.ingest')
DEFAULT_OVERPASS_USER_AGENT = os.getenv(
    'OVERPASS_USER_AGENT',
    'DistrictIntelligence/1.0 (+https://example.org)'
)

# Error handler
class IngestError(Exception):
    def __init__(self, user_message, step_name, original_error=None):
        self.user_message = user_message
        self.step_name = step_name
        self.original_error = original_error
        super().__init__(f"{user_message} (step: {step_name})")

# Helper function to log the start and completion of each step in the ingest process, and to handle errors gracefully
def log_step(step_name, message, level='info'):
    log_method = getattr(LOGGER, level, LOGGER.info)
    log_method(f"[{step_name}] {message}")

# Run a specific step in the ingest process, logging its start and completion
def run_step(step_name, user_message_on_error, fn, *args, **kwargs):
    log_step(step_name, 'started')
    try:
        result = fn(*args, **kwargs)
    except IngestError:
        raise
    except Exception as exc:
        log_step(step_name, f"failed: {exc}", level='error')
        raise IngestError(
            user_message=user_message_on_error,
            step_name=step_name,
            original_error=exc,
        ) from exc
    log_step(step_name, 'completed')
    return result

# normalize column names by converting to lowercase, replacing non-alphanumeric characters with underscores,
# and collapsing multiple underscores
def normalize_column_name(name):
    sanitized = ''.join(char if char.isalnum() else '_' for char in str(name).strip().lower())
    while '__' in sanitized:
        sanitized = sanitized.replace('__', '_')
    return sanitized.strip('_')

# Normalize missing values by converting None, NaN, empty strings, and specific tokens to pd.NA
def normalize_missing_values(df):
    def normalize_cell(value):
        if value is None or pd.isna(value):
            return pd.NA

        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                return pd.NA
            if normalized.lower() in MISSING_VALUE_TOKENS:
                return pd.NA

        return value

    working = df.copy()

    if isinstance(working, gpd.GeoDataFrame):
        geometry_column = working.geometry.name
        target_columns = [column for column in working.columns if column != geometry_column]
    else:
        target_columns = list(working.columns)

    for column in target_columns:
        working[column] = working[column].map(normalize_cell)

    return working

# Read a file based on its extension and return a prepared DataFrame or GeoDataFrame
def read_file(file_path):
    ext = os.path.splitext(file_path)[1].lower()

    if ext == '.csv':
        df = pd.read_csv(file_path)
    elif ext in ['.xls', '.xlsx']:
        df = pd.read_excel(file_path)
    elif ext == '.json':
        df = pd.read_json(file_path)
    elif ext in ['.geojson', '.gpkg', '.shp']:
        df = gpd.read_file(file_path)
    elif ext == '.zip':
        return read_archive(file_path)
    else:
        raise ValueError(f'Unsupported file format: {ext}')

    return prepare_dataframe(df)

# Extract files from a zip archive while ensuring security by validating file paths 
# and preventing directory traversal
def extract_zip_archive(zip_path, destination_dir):
    with zipfile.ZipFile(zip_path) as archive:
        members = [member for member in archive.infolist() if not member.is_dir()]
        if not members:
            raise ValueError('The uploaded zip archive is empty')

        extracted_paths = []
        destination_root = os.path.abspath(destination_dir)

        for member in members:
            normalized_name = os.path.normpath(member.filename)
            if normalized_name.startswith('..') or os.path.isabs(normalized_name):
                raise ValueError('The uploaded zip archive contains an invalid file path')

            target_path = os.path.abspath(os.path.join(destination_root, normalized_name))
            if os.path.commonpath([destination_root, target_path]) != destination_root:
                raise ValueError('The uploaded zip archive contains an unsafe file path')

            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            with archive.open(member) as source, open(target_path, 'wb') as output:
                shutil.copyfileobj(source, output)
            extracted_paths.append(target_path)

    return extracted_paths

# Choose the most appropriate file from the extracted paths based on supported extensions and a preferred order
def choose_archive_entry(extracted_paths):
    supported = [
        path for path in extracted_paths
        if os.path.splitext(path)[1].lower() in SUPPORTED_FILE_EXTENSIONS
    ]
    if not supported:
        raise ValueError(
            'No supported data file was found inside the zip archive. '
            'Include a .shp/.shx/.dbf shapefile set, GeoJSON, GeoPackage, CSV, Excel, or JSON file.'
        )

    preferred_order = {
        '.shp': 0,
        '.gpkg': 1,
        '.geojson': 2,
        '.csv': 3,
        '.xlsx': 4,
        '.xls': 5,
        '.json': 6,
    }

    return sorted(
        supported,
        key=lambda path: (
            preferred_order.get(os.path.splitext(path)[1].lower(), 999),
            len(path),
            path.lower(),
        ),
    )[0]

# Validate that a .shp file has its required companion files (.shx and .dbf) in the same directory
def validate_shapefile_bundle(shapefile_path):
    base_path, _ = os.path.splitext(shapefile_path)
    required_extensions = ['.shp', '.shx', '.dbf']
    missing = [
        ext for ext in required_extensions
        if not os.path.exists(f'{base_path}{ext}') and not os.path.exists(f'{base_path}{ext.upper()}')
    ]
    if missing:
        missing_labels = ', '.join(missing)
        raise ValueError(
            f'The shapefile bundle is incomplete. Missing companion files: {missing_labels}. '
            'Upload a zip file containing at least the .shp, .shx, and .dbf files together.'
        )

# Read and process a zip archive by extracting its contents, selecting the appropriate file,
# validating it if it's a shapefile, and returning the prepared DataFrame or GeoDataFrame
def read_archive(file_path):
    with tempfile.TemporaryDirectory(prefix='district_ingest_') as temp_dir:
        extracted_paths = extract_zip_archive(file_path, temp_dir)
        selected_path = choose_archive_entry(extracted_paths)

        if os.path.splitext(selected_path)[1].lower() == '.shp':
            validate_shapefile_bundle(selected_path)

        return read_file(selected_path)

# Extract data from an API endpoint, handle different response formats, and return a prepared DataFrame
def extract_from_api(api_url, headers=None, timeout=30):
    request = Request(api_url, headers=headers or {})

    with urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode('utf-8'))

    if isinstance(payload, list):
        df = pd.DataFrame(payload)
    elif isinstance(payload, dict):
        if isinstance(payload.get('data'), list):
            df = pd.DataFrame(payload['data'])
        else:
            df = pd.json_normalize(payload)
    else:
        raise ValueError('Unsupported API response format')

    return prepare_dataframe(df)


def normalize_overpass_query(query):
    if not query:
        return query
    normalized = str(query).strip()
    if '[out:xml]' in normalized:
        normalized = normalized.replace('[out:xml]', '[out:json]')
    if 'out geom' not in normalized:
        normalized = f"{normalized}\nout geom;"
    return normalized


def extract_from_overpass(api_url, query, timeout=60, user_agent=None):
    if not api_url:
        raise ValueError('overpass_url is required for Overpass extraction')
    if not query:
        raise ValueError('overpass_query is required for Overpass extraction')

    normalized_query = normalize_overpass_query(query)
    payload = urlencode({'data': normalized_query}).encode('utf-8')
    request = Request(
        api_url,
        data=payload,
        headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'User-Agent': user_agent or DEFAULT_OVERPASS_USER_AGENT,
        },
    )

    with urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode('utf-8'))

    elements = payload.get('elements', []) if isinstance(payload, dict) else []
    rows = []
    for element in elements:
        if element.get('type') != 'way':
            continue
        geometry = element.get('geometry') or []
        coords = [
            (point.get('lon'), point.get('lat'))
            for point in geometry
            if point.get('lon') is not None and point.get('lat') is not None
        ]
        if len(coords) < 2:
            continue
        tags = element.get('tags') or {}
        rows.append(
            {
                'osm_id': element.get('id'),
                'road_name': tags.get('name') or tags.get('ref'),
                'road_class': tags.get('highway'),
                'surface': tags.get('surface'),
                'speed_kmh': tags.get('maxspeed'),
                'oneway': tags.get('oneway'),
                'geometry': LineString(coords),
            }
        )

    if not rows:
        raise ValueError('Overpass response did not include any road ways.')

    road_gdf = gpd.GeoDataFrame(rows, geometry='geometry', crs='EPSG:4326')
    return prepare_dataframe(road_gdf)

# Main extraction function that determines the source type and calls the appropriate extraction method
def extract_source(
    source_type,
    file_path=None,
    api_url=None,
    api_headers=None,
    overpass_url=None,
    overpass_query=None,
    overpass_timeout=60,
):
    if source_type == 'file':
        if not file_path:
            raise ValueError('file_path is required for file extraction')
        return run_step(
            step_name='extract_source_file',
            user_message_on_error='Could not read the provided file. Verify file path and format.',
            fn=read_file,
            file_path=file_path,
        )

    if source_type == 'api':
        if not api_url:
            raise ValueError('api_url is required for API extraction')
        return run_step(
            step_name='extract_source_api',
            user_message_on_error='Could not fetch data from API. Check URL, headers, and network access.',
            fn=extract_from_api,
            api_url=api_url,
            headers=api_headers,
        )

    if source_type == 'overpass':
        return run_step(
            step_name='extract_source_overpass',
            user_message_on_error='Could not fetch data from Overpass API. Check query and network access.',
            fn=extract_from_overpass,
            api_url=overpass_url,
            query=overpass_query,
            timeout=overpass_timeout,
        )

    raise ValueError(f'Unsupported source type for tabular extraction: {source_type}')

# Prepare a DataFrame by normalizing column names, handling missing values, and ensuring geometry 
# columns are properly set for GeoDataFrames
def prepare_dataframe(df):
    if df is None:
        return pd.DataFrame()

    working = df.copy()
    geometry_column = working.geometry.name if isinstance(working, gpd.GeoDataFrame) else None
    working.columns = [normalize_column_name(column) for column in working.columns]
    if geometry_column:
        normalized_geometry_column = normalize_column_name(geometry_column)
        if normalized_geometry_column != 'geometry':
            working = working.rename(columns={normalized_geometry_column: 'geometry'})
            normalized_geometry_column = 'geometry'
    else:
        normalized_geometry_column = None

    working = normalize_missing_values(working)
    working = working.dropna(how='all').drop_duplicates()

    if normalized_geometry_column is not None:
        working = gpd.GeoDataFrame(working, geometry=normalized_geometry_column, crs=df.crs)

    return working

# Load a reference gazetteer from a specified path or from the database, and return it as a prepared DataFrame
def load_reference_gazetteer(session, gazetteer_path=None):
    try:
        if gazetteer_path and os.path.exists(gazetteer_path):
            log_step('load_reference_gazetteer', f'using gazetteer file: {gazetteer_path}')
            return run_step(
                step_name='load_reference_gazetteer_from_file',
                user_message_on_error='Could not read gazetteer file. Verify the file path and format.',
                fn=read_file,
                file_path=gazetteer_path,
            )

        gazetteer_df = run_step(
            step_name='load_reference_gazetteer_from_db',
            user_message_on_error='Could not load gazetteer reference data from the database.',
            fn=read_table,
            session=session,
            table_name='master_gazetteer',
            columns='geo_code, district_name, ward_name, village_name, normalized_district_name, normalized_ward_name, normalized_village_name',
        )

        if gazetteer_df.empty:
            return pd.DataFrame(
                columns=[
                    'geo_code',
                    'district_name',
                    'ward_name',
                    'village_name',
                    'normalized_district_name',
                    'normalized_ward_name',
                    'normalized_village_name',
                ]
            )

        return run_step(
            step_name='prepare_gazetteer_dataframe',
            user_message_on_error='Gazetteer data was loaded but could not be normalized.',
            fn=prepare_dataframe,
            df=gazetteer_df,
        )
    except IngestError:
        raise
    except Exception as exc:
        raise IngestError(
            user_message='Failed to prepare reference gazetteer data.',
            step_name='load_reference_gazetteer',
            original_error=exc,
        ) from exc
