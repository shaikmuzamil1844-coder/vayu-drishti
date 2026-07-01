"""
netcdf_parser.py
----------------
Ingests and parses climate NetCDF (.nc) files using xarray.
Interpolates data onto the standard 31x31 India coordinate grid.
Supports ERA5, IMD, and custom VAYU-DRISHTI formatted datasets.

Variable name conventions handled:
  Temperature : 'temperature', 't2m', 'tmp', 'T'
  Precipitation: 'precipitation', 'tp', 'prcp', 'rain', 'P'
  Humidity    : 'humidity', 'rh', 'r', 'RH'
"""

import os
import glob
import logging
import numpy as np

logger = logging.getLogger(__name__)

# Target India grid (31x31)
TARGET_LATS = np.linspace(8.0, 37.0, 31)
TARGET_LONS = np.linspace(68.0, 97.0, 31)

# Ordered list of variable name aliases to try
TEMP_ALIASES = ["temperature", "t2m", "tmp", "T", "temp"]
RAIN_ALIASES = ["precipitation", "tp", "prcp", "rain", "P", "precip"]
HUM_ALIASES  = ["humidity", "rh", "r", "RH", "relative_humidity"]


def _find_var(ds, aliases: list):
    """Return first variable name in ds that matches any alias."""
    for alias in aliases:
        if alias in ds.data_vars:
            return alias
    return None


def _compute_risk_zone(temp: float, rain: float, humidity: float, heat_stress: float) -> str:
    if heat_stress > 38.0 or rain > 22.0:
        return "CRITICAL"
    if heat_stress > 34.0 or rain > 12.0:
        return "WARNING"
    if heat_stress < 10.0:
        return "LOW"
    return "MODERATE"


def load_netcdf_grid(nc_path: str, day_offset: int = 0) -> list[dict] | None:
    """
    Load a NetCDF file and return a 31x31 grid list compatible with
    the /api/data endpoint format. Returns None if the file fails to parse.
    """
    try:
        import xarray as xr
    except ImportError:
        logger.error("xarray is not installed. Run: pip install xarray netCDF4")
        return None

    if not os.path.exists(nc_path):
        logger.info(f"NetCDF file not found: {nc_path}")
        return None

    try:
        ds = xr.open_dataset(nc_path, engine="netcdf4")
    except Exception as e:
        logger.error(f"Failed to open NetCDF file '{nc_path}': {e}")
        return None

    # --- Detect dimension names (lat/lon can have various names) ---
    lat_dim = None
    lon_dim = None
    for candidate in ["latitude", "lat", "LAT", "Latitude", "y"]:
        if candidate in ds.coords or candidate in ds.dims:
            lat_dim = candidate
            break
    for candidate in ["longitude", "lon", "LON", "Longitude", "x"]:
        if candidate in ds.coords or candidate in ds.dims:
            lon_dim = candidate
            break

    if lat_dim is None or lon_dim is None:
        logger.error(f"Could not identify lat/lon dimensions in '{nc_path}'. Found: {list(ds.dims)}")
        ds.close()
        return None

    # --- Detect variable names ---
    temp_var = _find_var(ds, TEMP_ALIASES)
    rain_var = _find_var(ds, RAIN_ALIASES)
    hum_var  = _find_var(ds, HUM_ALIASES)

    logger.info(f"NetCDF vars: temp='{temp_var}', rain='{rain_var}', hum='{hum_var}'")

    # --- Select time slice based on day_offset ---
    def select_time(da, offset):
        if "time" in da.dims and len(da.time) > 0:
            idx = max(0, min(offset, len(da.time) - 1))
            return da.isel(time=idx)
        return da

    # --- Interpolate each variable onto target 31x31 grid ---
    def interp_to_grid(da):
        """Bilinear interpolation onto TARGET_LATS/TARGET_LONS."""
        try:
            interp_kwargs = {lat_dim: TARGET_LATS, lon_dim: TARGET_LONS}
            return da.interp(**interp_kwargs, method="linear").values
        except Exception as e:
            logger.warning(f"Interpolation failed, using nearest: {e}")
            try:
                interp_kwargs = {lat_dim: TARGET_LATS, lon_dim: TARGET_LONS}
                return da.interp(**interp_kwargs, method="nearest").values
            except Exception as e2:
                logger.error(f"All interpolation methods failed: {e2}")
                return None

    # --- Extract arrays ---
    temp_arr = None
    rain_arr = None
    hum_arr  = None

    if temp_var:
        da = select_time(ds[temp_var], day_offset)
        temp_arr = interp_to_grid(da)
        # Kelvin to Celsius conversion
        if temp_arr is not None and np.nanmean(temp_arr) > 200:
            temp_arr = temp_arr - 273.15

    if rain_var:
        da = select_time(ds[rain_var], day_offset)
        rain_arr = interp_to_grid(da)
        if rain_arr is not None:
            rain_arr = np.maximum(0.0, rain_arr)

    if hum_var:
        da = select_time(ds[hum_var], day_offset)
        hum_arr = interp_to_grid(da)

    ds.close()

    # If critical arrays failed, abort
    if temp_arr is None:
        logger.warning("Temperature variable missing or failed; falling back to synthetic.")
        return None

    # --- Build grid list ---
    grid = []
    node_id = 0
    for r, lat in enumerate(TARGET_LATS):
        for c, lon in enumerate(TARGET_LONS):
            temp = float(temp_arr[r, c]) if temp_arr is not None else 28.0
            rain = float(rain_arr[r, c]) if rain_arr is not None else 2.0
            humidity = float(hum_arr[r, c]) if hum_arr is not None else 55.0

            # Clamp ranges
            temp = max(-40.0, min(60.0, temp))
            rain = max(0.0, rain)
            humidity = max(0.0, min(100.0, humidity))

            # Wind placeholders (requires u/v wind variables not always present)
            wind_u = 3.0
            wind_v = 4.0

            heat_stress = round(temp + 0.05 * humidity, 2)
            risk_zone = _compute_risk_zone(temp, rain, humidity, heat_stress)

            grid.append({
                "id": node_id,
                "lat": round(float(lat), 4),
                "lon": round(float(lon), 4),
                "temp": round(temp, 2),
                "rain": round(rain, 2),
                "humidity": round(humidity, 1),
                "wind_u": wind_u,
                "wind_v": wind_v,
                "heat_stress": heat_stress,
                "risk_zone": risk_zone,
                "source": "netcdf"  # Annotate data source
            })
            node_id += 1

    logger.info(f"NetCDF parser: loaded {len(grid)} grid cells from '{nc_path}'")
    return grid


def find_latest_netcdf(data_raw_dir: str) -> str | None:
    """
    Scan data/raw/ directory and return the most recently modified .nc file.
    """
    pattern = os.path.join(data_raw_dir, "*.nc")
    files = glob.glob(pattern)
    if not files:
        return None
    return max(files, key=os.path.getmtime)
