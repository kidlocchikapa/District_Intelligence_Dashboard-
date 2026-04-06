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