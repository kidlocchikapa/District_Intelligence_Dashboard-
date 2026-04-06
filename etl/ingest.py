import os
import pandas as pd
import geopandas as gpd
import logging

logger = logging.getLogger(__name__)

class DataIngestor:
    def __init__(self, raw_data_dir):
        self.raw_data_dir = raw_data_dir

    def read_file(self, filename):
        """
        Reads a file from the raw data directory based on its extension.
        Supports .csv, .xlsx, .geojson.
        Returns a pandas DataFrame or geopandas GeoDataFrame.
        """
        filepath = os.path.join(self.raw_data_dir, filename)
        
        if not os.path.exists(filepath):
            logger.error(f"File not found: {filepath}")
            raise FileNotFoundError(f"File not found: {filepath}")
            
        ext = os.path.splitext(filename)[1].lower()
        
        try:
            if ext == '.csv':
                logger.info(f"Ingesting CSV file: {filename}")
                return pd.read_csv(filepath)
            elif ext == '.xlsx':
                logger.info(f"Ingesting Excel file: {filename}")
                return pd.read_excel(filepath, engine='openpyxl')
            elif ext in ['.geojson', '.json', '.shp']:
                logger.info(f"Ingesting spatial file: {filename}")
                return gpd.read_file(filepath)
            else:
                logger.error(f"Unsupported file format: {ext}")
                raise ValueError(f"Unsupported file format: {ext}")
        except Exception as e:
            logger.error(f"Error reading {filename}: {e}")
            raise

