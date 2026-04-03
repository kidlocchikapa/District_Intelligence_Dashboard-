import pandas as pd
import geopandas as gpd
from shapely.geometry import Point
import logging

logger = logging.getLogger(__name__)

class DataHarmonizer:
    def __init__(self, mappings):
        self.mappings = mappings

    def process(self, df, dataset_type):
        """
        Harmonizes the DataFrame/GeoDataFrame based on mapped columns.
        """
        if df is None or df.empty:
            logger.warning(f"Empty dataframe passed to harmonizer for {dataset_type}.")
            return df
            
        logger.info(f"Harmonizing data for {dataset_type}")
        
        # 1. Rename columns based on mapping
        mapping = self.mappings.get(dataset_type, {})
        rename_dict = {col: target for col, target in mapping.items() if col in df.columns}
        df = df.rename(columns=rename_dict)
        
        # 2. Make all column names lowercase and replace spaces with underscores
        df.columns = [str(c).lower().strip().replace(' ', '_') for c in df.columns]
        
        # 3. Create 'geom' if latitude and longitude exist but no geometry is present
        # This occurs if the source was a CSV, not a GeoJSON
        if not isinstance(df, gpd.GeoDataFrame) and 'latitude' in df.columns and 'longitude' in df.columns:
            logger.info("Converting tabular data to spatial GeoDataFrame using latitude and longitude. Missing coordinates will be preserved as non-spatial.")
            df['latitude'] = pd.to_numeric(df['latitude'], errors='coerce')
            df['longitude'] = pd.to_numeric(df['longitude'], errors='coerce')
            
            # Use Shapely Point if coords exist, else None
            geometry = []
            for lat, lon in zip(df['latitude'], df['longitude']):
                if pd.isna(lat) or pd.isna(lon):
                    geometry.append(None)
                else:
                    geometry.append(Point(lon, lat))
            
            df = gpd.GeoDataFrame(df, geometry=geometry, crs="EPSG:4326")
            
            # Since our database column is 'geom', let's set it as the active geometry and rename
            df = df.rename_geometry('geom')
        
        # If it's already a GeoDataFrame from shapefile/geojson, ensure CRS and right geometry column name
        if isinstance(df, gpd.GeoDataFrame):
            if df.crs is None or df.crs.to_string() != "EPSG:4326":
                # Assuming unprojected data is WGS84, otherwise project it
                try:
                    df = df.to_crs("EPSG:4326")
                except:
                    df.set_crs("EPSG:4326", inplace=True)
                    
            # Ensure the geometry column is named 'geom' to match PostGIS
            active_geom_name = df.geometry.name
            if active_geom_name != 'geom':
                df = df.rename_geometry('geom')

        # Drop original lat/lon columns if they exist as 'geom' now represents them
        if 'latitude' in df.columns:
            df = df.drop(columns=['latitude'])
        if 'longitude' in df.columns:
            df = df.drop(columns=['longitude'])

        return df

