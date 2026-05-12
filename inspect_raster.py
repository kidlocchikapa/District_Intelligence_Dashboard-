import rasterio
try:
    with rasterio.open('sample_data/flood_impact_zomba.tif') as src:
        print(f"CRS: {src.crs}")
        print(f"Bounds: {src.bounds}")
        print(f"Count: {src.count}")
        print(f"Nodata: {src.nodata}")
        print(f"Shape: {src.shape}")
except Exception as e:
    print(f"Error: {e}")
