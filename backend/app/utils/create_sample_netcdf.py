import numpy as np
import xarray as xr
import pandas as pd
import os

def create_sample_netcdf_file():
    """
    Creates a sample NetCDF (.nc) file representing India's climate coordinates.
    Saves it to data/raw/india_climate_sample.nc.
    """
    print("Generating sample NetCDF variables...")
    
    # 1. Dimensions
    lats = np.linspace(8.0, 37.0, 31)
    lons = np.linspace(68.0, 97.0, 31)
    times = pd.date_range(start="2026-06-27", periods=1)
    
    # 2. Allocate variables
    temp_data = np.zeros((1, 31, 31), dtype=np.float32)
    precip_data = np.zeros((1, 31, 31), dtype=np.float32)
    humidity_data = np.zeros((1, 31, 31), dtype=np.float32)
    
    # 3. Populate with realistic geographical climate parameters
    for i, lat in enumerate(lats):
        for j, lon in enumerate(lons):
            # Base Temperature
            t = 32.0 - 0.5 * (lat - 8.0)
            if lat > 28.0 and 74.0 < lon < 85.0:
                t -= 15.0  # Cold Himalayas
            elif lat > 32.0:
                t -= 20.0
            if 24.0 < lat < 28.0 and 68.0 < lon < 74.0:
                t += 5.0   # Thar desert heat
                
            # Base Rainfall
            r = 2.0
            if 8.0 <= lat <= 20.0 and 72.0 <= lon <= 75.0:
                r += 18.0  # Ghats monsoon
            elif 22.0 <= lat <= 28.0 and 88.0 <= lon <= 97.0:
                r += 24.0  # North-East precipitation
            elif 24.0 <= lat <= 28.0 and 68.0 <= lon <= 74.0:
                r = 0.05   # Desert
                
            # Base Humidity
            h = 80.0 if (lon < 74.0 and lat < 20.0) or (lon > 80.0 and lat < 22.0) else 50.0
            if 24.0 <= lat <= 28.0 and 68.0 <= lon <= 74.0:
                h = 20.0
                
            temp_data[0, i, j] = t
            precip_data[0, i, j] = r
            humidity_data[0, i, j] = h

    # 4. Construct xarray Dataset
    ds = xr.Dataset(
        data_vars={
            "temperature": (["time", "latitude", "longitude"], temp_data, {"units": "celsius", "long_name": "Grid Temperature"}),
            "precipitation": (["time", "latitude", "longitude"], precip_data, {"units": "mm", "long_name": "Precipitation volume"}),
            "humidity": (["time", "latitude", "longitude"], humidity_data, {"units": "%", "long_name": "Relative Humidity"}),
        },
        coords={
            "time": times,
            "latitude": lats,
            "longitude": lons,
        },
        attrs={
            "description": "VAYU-DRISHTI gridded climate dataset sample for India",
            "source": "ISRO simulated gridded observation data",
        }
    )
    
    # 5. Ensure output directory exists and save
    # backend/app/utils/create_sample_netcdf.py  ->  3 parents up = project root
    _this_file = os.path.abspath(__file__)
    _utils_dir = os.path.dirname(_this_file)        # backend/app/utils/
    _app_dir   = os.path.dirname(_utils_dir)         # backend/app/
    _backend   = os.path.dirname(_app_dir)            # backend/
    _project   = os.path.dirname(_backend)            # project root
    out_dir = os.path.join(_project, "data", "raw")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "india_climate_sample.nc")
    
    # Write NetCDF
    ds.to_netcdf(out_path, engine="netcdf4")
    print(f"[OK] Created sample NetCDF successfully: {os.path.abspath(out_path)}")

if __name__ == "__main__":
    create_sample_netcdf_file()
