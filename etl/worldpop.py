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
