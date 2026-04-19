## Importing libaries
import json
import logging
import os
import re
import time
import ssl
from urllib.error import URLError
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


LOGGER = logging.getLogger('etl.worldpop')


class WorldPopError(Exception):
    def __init__(self, user_message, step_name, original_error=None):
        self.user_message = user_message
        self.step_name = step_name
        self.original_error = original_error
        super().__init__(f"{user_message} (step: {step_name})")


def log_step(step_name, message, level='info'):
    log_method = getattr(LOGGER, level, LOGGER.info)
    log_method(f"[{step_name}] {message}")


def run_step(step_name, user_message_on_error, fn, *args, **kwargs):
    log_step(step_name, 'started')
    try:
        result = fn(*args, **kwargs)
    except WorldPopError:
        raise
    except Exception as exc:
        log_step(step_name, f"failed: {exc}", level='error')
        raise WorldPopError(
            user_message=user_message_on_error,
            step_name=step_name,
            original_error=exc,
        ) from exc
    log_step(step_name, 'completed')
    return result



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
            log_step('fetch_json', f'fetching URL (attempt {attempt + 1}/{retries}): {url}')
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


## Function to select the most appropriate WorldPop dataset based on year a
# nd ISO3 country code, ensuring it is a GeoTIFF format
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


## Function to download a WorldPop raster file from a given URL, saving it to a specified 
# directory with optional filename and timeout settings
def download_worldpop_raster(raster_url, download_dir, filename=None, timeout=300):
    try:
        os.makedirs(download_dir, exist_ok=True)
        target_name = filename or os.path.basename(raster_url.split('?', 1)[0])
        target_path = os.path.join(download_dir, target_name)

        if os.path.exists(target_path) and os.path.getsize(target_path) > 0:
            log_step('download_worldpop_raster', f'using cached raster: {target_path}')
            return target_path

        log_step('download_worldpop_raster', f'downloading raster from {raster_url}')
        with urlopen(raster_url, timeout=timeout) as response, open(target_path, 'wb') as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)

        return target_path
    except Exception as exc:
        raise WorldPopError(
            user_message='Could not download WorldPop raster file. Check internet access and URL availability.',
            step_name='download_worldpop_raster',
            original_error=exc,
        ) from exc

## Function to resolve the appropriate WorldPop raster dataset for a given year 
# and ISO3 country code, downloading the raster file and returning metadata about the selected dataset
def resolve_worldpop_raster(
    api_url=None,
    year=DEFAULT_WORLDPOP_YEAR,
    iso3='MWI',
    download_dir=None,
):
    catalog = load_worldpop_catalog(url=api_url)
    selected = select_worldpop_dataset(catalog, year=year, iso3=iso3)
    target_dir = download_dir or os.path.join(os.path.dirname(__file__), 'data', 'worldpop')
    raster_path = download_worldpop_raster(
        selected['raster_url'],
        download_dir=target_dir,
        filename=f'{iso3.lower()}_worldpop_{selected["year"]}.tif',
    )
    selected['raster_path'] = raster_path
    return selected

## Helper function to convert a geometry object to a GeoJSON FeatureCollection format,
#  ensuring it is compatible with WorldPop API requirements
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


## Helper function to serialize a geometry object into a GeoJSON FeatureCollection string
# , using compact separators to minimize the resulting string length for API usage
def serialize_geojson_feature_collection(geometry):
    return json.dumps(geometry_to_feature_collection(geometry), separators=(',', ':'))


## Function to build a WorldPop statistics API URL with the appropriate query parameters, including 
# dataset, year, GeoJSON payload, API key, and asynchronous execution flag
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


## Main function to prepare a geometry for a WorldPop API request, attempting various 
# simplification tolerances to reduce the GeoJSON payload size while ensuring it remains valid for the API,
#  and falling back to the geometry's envelope if necessary
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

## Function to wait for a WorldPop asynchronous task to complete by polling the task status endpoint, 
# with error handling and timeout support
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


'''
Function to request WorldPop statistics for a given geometry, dataset, and year, preparing the geometry for
the API request, handling asynchronous execution if needed, and returning the 
resulting statistics payload with metadata about the request
'''
## 
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
    try:
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
    except Exception as exc:
        raise WorldPopError(
            user_message='Could not retrieve WorldPop statistics for one or more areas.',
            step_name='request_worldpop_stats',
            original_error=exc,
        ) from exc

## Helper function to extract the total population value from a WorldPop statistics response payload, 
# handling different possible structures of the input data
def extract_total_population(stats_data):
    payload = stats_data.get('data') if isinstance(stats_data, dict) and 'data' in stats_data else stats_data
    return float((payload or {}).get('total_population') or 0.0)


## Additional helper function to parse age band labels from WorldPop age
def parse_age_band(age_label):
    text_value = str(age_label or '').strip().lower()
    if not text_value:
        return None, None

    match = re.match(r'(?P<start>\d+)\s+to\s+(?P<end>\d+)', text_value)
    if match:
        return int(match.group('start')), int(match.group('end'))

    match = re.match(r'(?P<start>\d+)\s+and\s+over', text_value)
    if match:
        return int(match.group('start')), 120

    if text_value.isdigit():
        start = int(text_value)
        return start, start + 1

    return None, None


## Function to aggregate school-age population from a WorldPop age pyramid
def aggregate_school_age_population(agesex_pyramid, school_age_min=DEFAULT_SCHOOL_AGE_MIN, school_age_max=DEFAULT_SCHOOL_AGE_MAX):
    school_age_upper = school_age_max + 1
    male_total = 0.0
    female_total = 0.0

    for bucket in agesex_pyramid or []:
        lower, upper = parse_age_band(bucket.get('age'))
        if lower is None or upper is None or upper <= lower:
            continue

        overlap_lower = max(lower, school_age_min)
        overlap_upper = min(upper, school_age_upper)
        overlap = max(overlap_upper - overlap_lower, 0)
        span = upper - lower
        if overlap <= 0 or span <= 0:
            continue

        overlap_ratio = overlap / span
        male_total += float(bucket.get('male') or 0.0) * overlap_ratio
        female_total += float(bucket.get('female') or 0.0) * overlap_ratio

    total = male_total + female_total
    return {
        'school_age_population_total': total,
        'school_age_population_male': male_total,
        'school_age_population_female': female_total,
    }


## Function to aggregate child population from a WorldPop age
def aggregate_child_population_from_classes(agesex_pyramid, max_class=DEFAULT_CHILD_CLASS_MAX):
    male_total = 0.0
    female_total = 0.0

    for bucket in agesex_pyramid or []:
        try:
            class_value = int(bucket.get('class'))
        except (TypeError, ValueError):
            continue

        if class_value > max_class:
            continue

        male_total += float(bucket.get('male') or 0.0)
        female_total += float(bucket.get('female') or 0.0)

    total = male_total + female_total
    return {
        'child_population_total': total,
        'child_population_male': male_total,
        'child_population_female': female_total,
    }

## Helper function to build a standardized indicator record from a WorldPop statistics response, 
# including dataset type, indicator name, geographic information, indicator value, source filename, and optional metadata
def build_indicator_record(row, indicator_name, indicator_value, source_filename, metadata=None):
    return {
        'dataset_type': 'worldpop',
        'indicator_name': indicator_name,
        'geographic_level': (row.get('type') or 'administrative_unit').lower(),
        'geographic_name': row['name'],
        'geographic_code': row.get('code'),
        'indicator_value': float(indicator_value or 0.0),
        'source_filename': source_filename,
        'metadata': metadata or {},
    }


## Helper function to build a standardized age and sex disaggregated record from a WorldPop 
# statistics response, including geographic information, age and
def build_age_sex_record(row, year, bucket, response_payload):
    task_id = response_payload.get('taskid')
    start_time = response_payload.get('startTime')
    end_time = response_payload.get('endTime')
    execution_time = response_payload.get('executionTime')
    age_class = str(bucket.get('class') or '').strip()
    age_label = str(bucket.get('age') or '').strip()
    male_value = float(bucket.get('male') or 0.0)
    female_value = float(bucket.get('female') or 0.0)
    total_value = male_value + female_value

    return {
        'admin_unit_id': int(row['id']),
        'admin_unit_code': row.get('code'),
        'admin_unit_name': row['name'],
        'admin_unit_type': row['type'],
        'worldpop_year': int(year),
        'dataset_name': DEFAULT_WORLDPOP_AGE_SEX_DATASET,
        'age_class': age_class,
        'age_label': age_label,
        'male_population': male_value,
        'female_population': female_value,
        'total_population': total_value,
        'task_id': task_id,
        'start_time': start_time,
        'end_time': end_time,
        'execution_time': float(execution_time) if execution_time is not None else None,
        'metadata': {
            'worldpop_dataset': DEFAULT_WORLDPOP_AGE_SEX_DATASET,
            'worldpop_year': year,
            'class': age_class,
            'age': age_label,
            **(response_payload.get('request_metadata') or {}),
        },
    }

## Function to process a GeoDataFrame of administrative units, requesting WorldPop 
# population statistics for each unit, and calculating total population and population density 
# for each unit based on the retrieved statistics and the area of the unit's geometry
def process_population_stats(
    api_url,
    admin_units_gdf,
    year=DEFAULT_WORLDPOP_YEAR,
    api_key=None,
    dataset=DEFAULT_WORLDPOP_DATASET,
):
    try:
        working = admin_units_gdf.copy()
        populations = []

        for _, row in working.iterrows():
            geometry = get_row_geometry(row)
            stats_data = request_worldpop_stats(
                geometry,
                dataset=dataset,
                year=year,
                api_url=api_url,
                api_key=api_key,
            )
            populations.append(round(extract_total_population(stats_data)))

        working['population_total'] = populations
        projected = working.to_crs('EPSG:3857')
        area_km2 = projected.geometry.area / 10**6
        working['population_density'] = [
            (population / area if area else 0)
            for population, area in zip(working['population_total'], area_km2)
        ]
        log_step('process_population_stats', f'processed_admin_units={len(working)}')
        return working
    except Exception as exc:
        raise WorldPopError(
            user_message='Could not compute population stats from WorldPop API for the selected areas.',
            step_name='process_population_stats',
            original_error=exc,
        ) from exc

# Function to build age andd sex disaggregated outputs from a GeoDataFrame of administrative units, r
# equesting WorldPop age and sex pyramid statistics for each unit, and constructing standardized records for both 
# theage and sex disaggregated data and the aggregated indicators for school-age and child populations, including metadata about the 
# WorldPop dataset and request parameters used for each record
def build_age_sex_outputs(
    admin_units_gdf,
    year=DEFAULT_WORLDPOP_YEAR,
    api_url=None,
    api_key=None,
    school_age_min=DEFAULT_SCHOOL_AGE_MIN,
    school_age_max=DEFAULT_SCHOOL_AGE_MAX,
    child_class_max=DEFAULT_CHILD_CLASS_MAX,
):
    try:
        indicator_records = []
        age_sex_records = []
        source_filename = f'worldpop_{DEFAULT_WORLDPOP_AGE_SEX_DATASET}_{year}'

        for _, row in admin_units_gdf.iterrows():
            geometry = get_row_geometry(row)
            response_payload = request_worldpop_stats(
                geometry,
                dataset=DEFAULT_WORLDPOP_AGE_SEX_DATASET,
                year=year,
                api_url=api_url,
                api_key=api_key,
            )
        stats_data = response_payload.get('data') or {}
        agesex_pyramid = stats_data.get('agesexpyramid') or []

        for bucket in agesex_pyramid:
            bucket_class = str(bucket.get('class') or '').strip()
            age_label = str(bucket.get('age') or '').strip()
            if not bucket_class:
                continue

            age_sex_records.append(build_age_sex_record(row, year, bucket, response_payload))

            bucket_metadata = {
                'worldpop_dataset': DEFAULT_WORLDPOP_AGE_SEX_DATASET,
                'worldpop_year': year,
                'class': bucket_class,
                'age': age_label,
            }
            male_value = float(bucket.get('male') or 0.0)
            female_value = float(bucket.get('female') or 0.0)
            total_value = male_value + female_value

            indicator_records.append(
                build_indicator_record(
                    row,
                    indicator_name=f'agesex_class_{bucket_class}_male',
                    indicator_value=male_value,
                    source_filename=source_filename,
                    metadata={**bucket_metadata, 'sex': 'male'},
                )
            )
            indicator_records.append(
                build_indicator_record(
                    row,
                    indicator_name=f'agesex_class_{bucket_class}_female',
                    indicator_value=female_value,
                    source_filename=source_filename,
                    metadata={**bucket_metadata, 'sex': 'female'},
                )
            )
            indicator_records.append(
                build_indicator_record(
                    row,
                    indicator_name=f'agesex_class_{bucket_class}_total',
                    indicator_value=total_value,
                    source_filename=source_filename,
                    metadata={**bucket_metadata, 'sex': 'total'},
                )
            )

        school_age_metrics = aggregate_school_age_population(
            agesex_pyramid,
            school_age_min=school_age_min,
            school_age_max=school_age_max,
        )
        child_population_metrics = aggregate_child_population_from_classes(
            agesex_pyramid,
            max_class=child_class_max,
        )

        for indicator_name, indicator_value in {**school_age_metrics, **child_population_metrics}.items():
            indicator_records.append(
                build_indicator_record(
                    row,
                    indicator_name=indicator_name,
                    indicator_value=indicator_value,
                    source_filename=source_filename,
                    metadata={
                        'worldpop_dataset': DEFAULT_WORLDPOP_AGE_SEX_DATASET,
                        'worldpop_year': year,
                        'school_age_min': school_age_min,
                        'school_age_max': school_age_max,
                        'child_class_max': child_class_max,
                    },
                )
            )

        log_step('build_age_sex_outputs', f'age_sex_records={len(age_sex_records)}, indicators={len(indicator_records)}')
        return pd.DataFrame(age_sex_records), pd.DataFrame(indicator_records)
    except Exception as exc:
        raise WorldPopError(
            user_message='Could not build age/sex outputs from WorldPop responses.',
            step_name='build_age_sex_outputs',
            original_error=exc,
        ) from exc


'''
function to compute zonal statistics for a given raster file and a GeoDataFrame of polygons,
calculating the specified statistic (sum or mean) for the raster values that fall within each polygon,
and returning a list of results corresponding to each polygon
'''
def get_zonal_stats(raster_path, polygons_gdf, stat='sum'):
    try:
        results = []
        with rasterio.open(raster_path) as src:
            working_polygons = polygons_gdf
            if working_polygons.crs != src.crs:
                working_polygons = working_polygons.to_crs(src.crs)

            for _, row in working_polygons.iterrows():
                try:
                    geometry = [get_row_geometry(row)]
                    out_image, _ = mask(src, geometry, crop=True)
                    data = out_image[0]

                    if src.nodata is not None:
                        data = data[data != src.nodata]
                    data = data[~np.isnan(data)]

                    if data.size == 0:
                        results.append(0.0)
                    elif stat == 'mean':
                        results.append(float(np.mean(data)))
                    else:
                        results.append(float(np.sum(data)))
                except Exception as exc:
                    log_step('get_zonal_stats', f'polygon processing failed: {exc}', level='warning')
                    results.append(0.0)

        return results
    except Exception as exc:
        raise WorldPopError(
            user_message='Could not compute raster zonal statistics for provided polygons.',
            step_name='get_zonal_stats',
            original_error=exc,
        ) from exc


## Function to fetch administrative units from a database session, optionally filtering by district name, 
## and returning the results as a GeoDataFrame with geometry column named 'geom'
def fetch_admin_units(session, district_name=None, district_names=None):
    query = """
        SELECT
            u.id,
            u.code,
            u.name,
            u.type,
            u.population_total,
            u.geom
        FROM (
            SELECT
                d.id,
                d.code,
                d.name,
                'District'::VARCHAR AS type,
                COALESCE(d.population_total, 0)::INTEGER AS population_total,
                d.geom,
                d.id AS district_id
            FROM districts d
            WHERE d.geom IS NOT NULL

            UNION ALL

            SELECT
                a.id,
                a.code,
                a.name,
                'TA'::VARCHAR AS type,
                COALESCE(a.population_total, 0)::INTEGER AS population_total,
                a.geom,
                a.district_id
            FROM admin3_units a
            WHERE a.geom IS NOT NULL
              AND LOWER(a.type) = 'ta'
        ) u
        LEFT JOIN districts d ON d.id = u.district_id
    """
    params = {}
    selected_district_names = []
    if district_name:
        selected_district_names.append(str(district_name).strip().lower())
    if district_names:
        selected_district_names.extend(
            str(name).strip().lower()
            for name in district_names
            if str(name).strip()
        )

    selected_district_names = sorted(set(selected_district_names))

    if selected_district_names:
        query += """
            WHERE
                (LOWER(u.type) = 'district' AND LOWER(u.name) = ANY(:district_names))
                OR
                (LOWER(u.type) = 'ta' AND LOWER(d.name) = ANY(:district_names))
        """
        params['district_names'] = selected_district_names

    return gpd.read_postgis(text(query), session.bind, geom_col='geom', params=params)


##function to process population data for a GeoDataFrame of administrative units, calculating total population and population density for each unit
#based on zonal statistics from a WorldPop raster file, and returning an updated GeoDataFrame with the new population metrics
def process_population_data(raster_path, admin_units_gdf):
    pop_sums = get_zonal_stats(raster_path, admin_units_gdf, stat='sum')
    working = admin_units_gdf.copy()
    working['population_total'] = [round(value) for value in pop_sums]

    projected = working.to_crs('EPSG:3857')
    area_km2 = projected.geometry.area / 10**6
    working['population_density'] = [
        (population / area if area else 0)
        for population, area in zip(working['population_total'], area_km2)
    ]
    return working


## Function to update population metrics in the database for a GeoDataFrame of administrative units, executing an UPDATE statement for each 
## unit to set the population_total and population_density fields based on the calculated values
def update_population_metrics(session, population_gdf):
    updated = 0
    for _, row in population_gdf.iterrows():
        row_type = str(row.get('type') or '').strip().lower()
        params = {
            'id': int(row['id']),
            'population_total': int(row['population_total'] or 0),
            'population_density': float(row['population_density'] or 0),
        }

        if row_type == 'district':
            session.execute(
                text(
                    """
                    UPDATE districts
                    SET population_total = :population_total,
                        population_density = :population_density
                    WHERE id = :id
                    """
                ),
                params,
            )
        elif row_type == 'ta':
            session.execute(
                text(
                    """
                    UPDATE admin3_units
                    SET population_total = :population_total,
                        population_density = :population_density
                    WHERE id = :id
                      AND LOWER(type) = 'ta'
                    """
                ),
                params,
            )
        else:
            continue

        updated += 1

    session.commit()
    return updated


## Function to build standardized population indicator records from a GeoDataFrame of administrative units with population metrics,
## including dataset type, indicator name, geographic information, indicator value, source filename, and optional metadata
def build_population_indicators(population_gdf, source_filename=None):
    indicators = []
    for _, row in population_gdf.iterrows():
        indicators.append(
            {
                'dataset_type': 'worldpop',
                'indicator_name': 'population_total',
                'geographic_level': (row.get('type') or 'administrative_unit').lower(),
                'geographic_name': row['name'],
                'geographic_code': row.get('code'),
                'indicator_value': float(row.get('population_total') or 0),
                'source_filename': source_filename,
                'metadata': {},
            }
        )
        indicators.append(
            {
                'dataset_type': 'worldpop',
                'indicator_name': 'population_density',
                'geographic_level': (row.get('type') or 'administrative_unit').lower(),
                'geographic_name': row['name'],
                'geographic_code': row.get('code'),
                'indicator_value': float(row.get('population_density') or 0),
                'source_filename': source_filename,
                'metadata': {},
            }
        )
    return pd.DataFrame(indicators)
