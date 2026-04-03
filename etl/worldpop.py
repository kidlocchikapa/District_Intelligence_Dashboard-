import json
import os
import re
import time
import ssl
from urllib.error import HTTPError
from urllib.request import urlopen, Request
from urllib.parse import urlencode

## WorldPop data processing and API interaction functions
import geopandas as gpd 
import pandas as pd
import numpy as np
import rasterio
from rasterio.mask import mask
from sqlalchemy import text

# WorldPop API and dataset configuration
DEFAULT_WORLDPOP_YEAR = 2020
DEFAULT_WORLDPOP_CATALOG_URL = 'https://hub.worldpop.org/rest/data/pop/wpgp?iso3=MWI'
DEFAULT_WORLDPOP_STATS_URL = 'https://api.worldpop.org/v1/services/stats'
DEFAULT_WORLDPOP_TASKS_URL = 'https://api.worldpop.org/v1/tasks'
DEFAULT_WORLDPOP_DATASET = 'wpgppop'
DEFAULT_WORLDPOP_AGE_SEX_DATASET = 'wpgpas'
DEFAULT_SCHOOL_AGE_MIN = 5
DEFAULT_SCHOOL_AGE_MAX = 17
DEFAULT_CHILD_CLASS_MAX = 15
DEFAULT_WORLDPOP_MAX_GEOJSON_CHARS = 12000
DEFAULT_WORLDPOP_MAX_URL_LENGTH = 1800
WORLDPOP_SIMPLIFY_TOLERANCES = [0, 0.0001, 0.0005, 0.001, 0.005, 0.01, 0.02, 0.05, 0.1]



## Helper function to normalize WorldPop catalog URL, ensuring it points to the correct API endpoint
def normalize_world_catalog_url(url):
    if not url:
        return DEFAULT_WORLDPOP_CATALOG_URL
    
    normalized = str(url).strip()
    if not normalized:
        return DEFAULT_WORLDPOP_CATALOG_URL
    
    lowered = normalized.lower()
    if 'api.worldpop.org' in lowered or '/services/stats' in lowered or '/v1/tasks' in lowered:
        return DEFAULT_WORLDPOP_CATALOG_URL
    
    return normalized

## Helper function to extract geometry from a row, checking both 'geometry' and 'geom' fields
def get_row_geometry(row):
    geometry = row.get('geometry') or row.get('geom')
    if geometry is not None:
        return geometry
    
    raise ValueError("Row does not contain 'geometry' or 'geom' field with valid geometry data.")

## Helper function to fetch JSON data with retries and error handling
def fetch_json(url, timeout=60, retries=3, backoff_seconds=2):
    request = Request(url, headers={'User-Agent': 'district-intelligence-etl/1.0'})

    for attempt in range(retries):
        try:
            with urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode('utf-8'))
        except (URLError, ssl.SSLError, TimeoutError) as exc:
            if attempt == retries - 1:
                raise
            time.sleep(backoff_seconds * (attempt + 1))


## Main function to load WorldPop catalog data, normalizing the URL and fetching the JSON data
def load_worldpop_catalog(url=None, timeout=60):
    catalog_url = normalize_world_catalog_url(url)
    return fetch_json(catalog_url, timeout=timeout)


## Function to select the most appropriate WorldPop dataset based on year and ISO3 country code, ensuring it is a GeoTIFF format
def select_worldpop_dataset(catalog, year=DEFAULT_WORLDPOP_YEAR, iso3='MWI'):
    entries = catalog.get('data', []) if isinstance(catalog, dict) else catalog
    if not isinstance(entries, list):
        raise ValueError('Unexpected WorldPop catalog format')

    filtered = []
    for entry in entries:
        if str(entry.get('iso3', '')).upper() != iso3.upper():
            continue
        if str(entry.get('data_format', '')).lower() != 'geotiff':
            continue
        if str(entry.get('popyear', '')).isdigit():
            filtered.append(entry)

    if not filtered:
        raise ValueError(f'No WorldPop GeoTIFF datasets found for {iso3}')

    by_year = {int(entry['popyear']): entry for entry in filtered}
    selected_year = year if year in by_year else max(by_year.keys())
    selected = by_year[selected_year]

    files = selected.get('files') or []
    raster_url = files[0] if files else None
    if not raster_url:
        data_file = selected.get('data_file')
        if data_file:
            raster_url = f"https://data.worldpop.org/{data_file.lstrip('/')}"

    if not raster_url:
        raise ValueError(f'No raster file URL found for WorldPop year {selected_year}')

    return {
        'year': selected_year,
        'title': selected.get('title'),
        'raster_url': raster_url,
        'metadata': selected,
    }


## Function to download a WorldPop raster file from a given URL, saving it to a specified directory with optional filename and timeout settings
def download_worldpop_raster(raster_url, download_dir, filename=None, timeout=300):
    os.makedirs(download_dir, exist_ok=True)
    target_name = filename or os.path.basename(raster_url.split('?', 1)[0])
    target_path = os.path.join(download_dir, target_name)

    if os.path.exists(target_path) and os.path.getsize(target_path) > 0:
        return target_path

    with urlopen(raster_url, timeout=timeout) as response, open(target_path, 'wb') as output:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)

    return target_path

## Main function to resolve the appropriate WorldPop raster dataset for a given year and ISO3 country code, downloading the raster file and returning metadata about the selected dataset
def resolve_worldpop_raster(
    api_url=None,
    year=DEFAULT_WORLDPOP_YEAR,
    iso3='MWI',
    download_dir=None,
):
    catalog = load_worldpop_catalog(api_url=api_url)
    selected = select_worldpop_dataset(catalog, year=year, iso3=iso3)
    target_dir = download_dir or os.path.join(os.path.dirname(__file__), 'data', 'worldpop')
    raster_path = download_worldpop_raster(
        selected['raster_url'],
        download_dir=target_dir,
        filename=f'{iso3.lower()}_worldpop_{selected["year"]}.tif',
    )
    selected['raster_path'] = raster_path
    return selected

## Helper function to convert a geometry object to a GeoJSON FeatureCollection format, ensuring it is compatible with WorldPop API requirements
def geometry_to_feature_collection(geometry):
    return {
        'type': 'FeatureCollection',
        'features': [
            {
                'type': 'Feature',
                'properties': {},
                'geometry': geometry.__geo_interface__,
            }
        ],
    }


## Helper function to serialize a geometry object into a GeoJSON FeatureCollection string, using compact separators to minimize the resulting string length for API usage
def serialize_geojson_feature_collection(geometry):
    return json.dumps(geometry_to_feature_collection(geometry), separators=(',', ':'))


## Function to build a WorldPop statistics API URL with the appropriate query parameters, including dataset, year, GeoJSON payload, API key, and asynchronous execution flag
def build_worldpop_stats_url(api_url, dataset, year, geojson_payload, api_key=None, run_async=False):
    params = {
        'dataset': dataset,
        'year': year,
        'geojson': geojson_payload,
        'runasync': str(run_async).lower(),
    }
    if api_key:
        params['key'] = api_key
    return f"{(api_url or DEFAULT_WORLDPOP_STATS_URL).rstrip('?')}?{urlencode(params)}"


## Main function to prepare a geometry for a WorldPop API request, attempting various simplification tolerances to reduce the GeoJSON payload size while ensuring it remains valid for the API, and falling back to the geometry's envelope if necessary
def prepare_worldpop_request_geometry(
    geometry,
    api_url,
    dataset,
    year,
    api_key=None,
    run_async=False,
    max_chars=DEFAULT_WORLDPOP_MAX_GEOJSON_CHARS,
    max_url_length=DEFAULT_WORLDPOP_MAX_URL_LENGTH,
):
    fallback_geometry = geometry

    for tolerance in WORLDPOP_SIMPLIFY_TOLERANCES:
        candidate = fallback_geometry if tolerance == 0 else fallback_geometry.simplify(tolerance, preserve_topology=True)
        if candidate is None or candidate.is_empty:
            continue

        payload = serialize_geojson_feature_collection(candidate)
        target_url = build_worldpop_stats_url(api_url, dataset, year, payload, api_key=api_key, run_async=run_async)
        if len(payload) <= max_chars and len(target_url) <= max_url_length:
            return candidate, payload, tolerance, target_url

    envelope = fallback_geometry.envelope
    payload = serialize_geojson_feature_collection(envelope)
    target_url = build_worldpop_stats_url(api_url, dataset, year, payload, api_key=api_key, run_async=run_async)
    if len(target_url) > max_url_length:
        raise ValueError(f'WorldPop request URL remains too large after simplification ({len(target_url)} chars)')
    return envelope, payload, 'envelope', target_url

## Function to wait for a WorldPop asynchronous task to complete by polling the task status endpoint, with error handling and timeout support
def wait_for_worldpop_task(task_id, tasks_url=None, timeout=180, poll_interval=2):
    target_base = (tasks_url or DEFAULT_WORLDPOP_TASKS_URL).rstrip('/')
    target_url = f'{target_base}/{task_id}'
    deadline = time.time() + timeout

    while time.time() < deadline:
        payload = fetch_json(target_url, timeout=max(poll_interval + 5, 10))
        if payload.get('error'):
            raise ValueError(payload.get('error_message') or f'WorldPop task {task_id} failed')

        status = str(payload.get('status', '')).lower()
        if status == 'finished':
            return payload
        if status in {'failed', 'error'}:
            raise ValueError(payload.get('error_message') or f'WorldPop task {task_id} failed')

        time.sleep(poll_interval)

    raise TimeoutError(f'WorldPop task {task_id} did not finish within {timeout} seconds')

## Main function to request WorldPop statistics for a given geometry, dataset, and year, preparing the geometry for the API request, handling asynchronous execution if needed, and returning the resulting statistics payload with metadata about the request
def request_worldpop_stats(
    geometry,
    dataset=DEFAULT_WORLDPOP_DATASET,
    year=DEFAULT_WORLDPOP_YEAR,
    api_url=None,
    api_key=None,
    run_async=False,
    timeout=60,
    poll_timeout=180,
    poll_interval=2,
):
    _, geojson_payload, simplify_tolerance, target_url = prepare_worldpop_request_geometry(
        geometry,
        api_url=api_url or DEFAULT_WORLDPOP_STATS_URL,
        dataset=dataset,
        year=year,
        api_key=api_key,
        run_async=run_async,
    )
    payload = fetch_json(target_url, timeout=timeout)

    if payload.get('error'):
        raise ValueError(payload.get('error_message') or 'WorldPop stats request failed')

    status = str(payload.get('status', '')).lower()
    if status == 'finished':
        payload.setdefault('request_metadata', {})
        payload['request_metadata'].update(
            {
                'geojson_chars': len(geojson_payload),
                'request_url_chars': len(target_url),
                'simplify_tolerance': simplify_tolerance,
            }
        )
        return payload

    task_id = payload.get('taskid')
    if not task_id:
        raise ValueError('WorldPop response did not include result data or a task id')

    response_payload = wait_for_worldpop_task(
        task_id,
        timeout=poll_timeout,
        poll_interval=poll_interval,
    )
    response_payload.setdefault('request_metadata', {})
    response_payload['request_metadata'].update(
        {
            'geojson_chars': len(geojson_payload),
            'request_url_chars': len(target_url),
            'simplify_tolerance': simplify_tolerance,
        }
    )
    return response_payload
