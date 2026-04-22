import os
import json
import numpy as np
import rasterio
import rasterio.mask
import geopandas as gpd
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
from rasterio.plot import reshape_as_image

def generate_zomba_preview():
    # Database connection and geometry retrieval
    load_dotenv()
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        print("Error: DATABASE_URL not found in .env")
        return
        
    engine = create_engine(db_url)
    
    query = "SELECT ST_Union(geom) as geom FROM districts WHERE name IN ('Zomba', 'Zomba City')"
    gdf = gpd.read_postgis(text(query), engine, geom_col='geom')
    
    if gdf.empty or gdf.geometry.iloc[0] is None:
        print("Error: Could not find geometry for Zomba/Zomba City")
        return

    geometry = [gdf.geometry.iloc[0]]
    
    #Open source raster
    raster_path = os.path.join(os.path.dirname(__file__), 'data', 'worldpop', 'mwi_worldpop_2020.tif')
    if not os.path.exists(raster_path):
        print(f"Error: Source raster not found at {raster_path}")
        return

    with rasterio.open(raster_path) as src:
        # Clip the raster
        # Ensure CRS matches
        if gdf.crs is None:
            gdf.crs = "EPSG:4326"
        if gdf.crs != src.crs:
            gdf = gdf.to_crs(src.crs)
            geometry = [gdf.geometry.iloc[0]]
            
        out_image, out_transform = rasterio.mask.mask(src, geometry, crop=True)
        out_meta = src.meta.copy()
        
        # Calculate bounds for Leaflet ImageOverlay
        # Leaflet expects [[lat_min, lon_min], [lat_max, lon_max]]
        bounds = rasterio.transform.array_bounds(out_image.shape[1], out_image.shape[2], out_transform)
        # bounds is (lon_min, lat_min, lon_max, lat_max)
        leaflet_bounds = [[bounds[1], bounds[0]], [bounds[3], bounds[2]]]

    # Process the data for visualization
    data = out_image[0]
    
    # Handle nodata
    nodata = out_meta.get('nodata')
    mask = (data == nodata) | np.isnan(data)
    
    # Transform: log1p as in the original
    # We add a small epsilon to avoid log(0) if not using log1p
    # The original uses log1p
    transformed = np.log1p(np.where(mask, 0, data))
    
    # Normalize to [0, 1]
    # Use percentiles to clip outliers for better contrast, similar to original's 99.85
    valid_data = transformed[~mask]
    if valid_data.size > 0:
        vmin = 0 # Assume 0 is min for population
        vmax = np.percentile(valid_data, 99.85)
        normalized = np.clip((transformed - vmin) / (vmax - vmin), 0, 1)
    else:
        normalized = transformed
        vmax = 1.0

    # Apply colormap
    colors = ["#fff78a", "#aff04a", "#5cd661", "#31aaa4", "#2874d6", "#1f2379"]
    cmap = mcolors.ListedColormap(colors)
    
    # Create the RGBA image
    rgba_image = cmap(normalized)
    
    # Set transparency for masked areas
    rgba_image[mask, 3] = 0
    
    # Save as PNG
    output_dir = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'public', 'worldpop')
    os.makedirs(output_dir, exist_ok=True)
    
    png_path = os.path.join(output_dir, 'zomba_ppp_2020.preview.png')
    plt.imsave(png_path, rgba_image)
    print(f"Saved preview image to {png_path}")
    
    # Save metadata JSON
    metadata = {
        "source": "mwi_worldpop_2020.tif (clipped to Zomba)",
        "image": "zomba_ppp_2020.preview.png",
        "bounds": leaflet_bounds,
        "legend": {
            "label": "Estimated people per grid cell",
            "lowLabel": "Low",
            "highLabel": "High",
            "colors": colors
        },
        "render": {
            "clipPercentile": 99.85,
            "clipMax": float(vmax),
            "transform": "log1p",
            "gamma": 0.85
        }
    }
    
    json_path = os.path.join(output_dir, 'zomba_ppp_2020.preview.json')
    with open(json_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"Saved metadata to {json_path}")

if __name__ == "__main__":
    generate_zomba_preview()
