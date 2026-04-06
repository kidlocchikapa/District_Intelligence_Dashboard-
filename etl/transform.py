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