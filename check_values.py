import rasterio
import numpy as np
try:
    with rasterio.open('sample_data/flood_impact_zomba.tif') as src:
        data = src.read(1)
        unique_values = np.unique(data)
        print(f"Unique values: {unique_values}")
except Exception as e:
    print(f"Error: {e}")
