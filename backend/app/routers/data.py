"""
data.py  — /api/data
---------------------
Returns telemetry data for the 31×31 climate grid over India.

Source priority:
  1. Real IMD .npy arrays (2024+2025 data)   ← NEW
  2. NetCDF file in data/raw/
  3. Synthetic data generator (fallback)

For positive day_offset (forecast), real today data is used as
the seed and the CNN ML model provides the prediction.
"""

from fastapi import APIRouter, Query
from app.utils.data_generator import get_grid_telemetry
from app.utils.netcdf_parser import load_netcdf_grid, find_latest_netcdf
from app.utils.npy_loader import get_npy_grid, is_available as npy_available
from app.models import ml_predictor
import numpy as np
import os
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

_BASE_DIR    = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DATA_RAW_DIR = os.path.join(_BASE_DIR, "data", "raw")


def apply_insat_satellite_calibration(grid: list) -> list:
    """
    Applies INSAT-3D/3R satellite sensor calibration formulas to simulate
    atmospheric surface temperature (LST), Sea Surface Temperature (SST), and 3RIMG rainfall.
    """
    calibrated = []
    for cell in grid:
        lat = cell["lat"]
        lon = cell["lon"]
        is_sea = (lat < 20.0) and (lon < 72.5 or lon > 85.0)

        # INSAT LST: diurnal land surface skin temperature (higher amplitude than air temp)
        insat_lst = round(cell["temp"] + (3.4 if not is_sea else 0.0), 2)
        # INSAT SST: sea surface temperature (cooler, thermal inertia buffer)
        insat_sst = round(cell["temp"] - (1.2 if is_sea else 0.0), 2) if is_sea else None
        # INSAT IMC Rainfall: cloud-top microwave estimation proxy
        insat_rain = round(cell["rain"] * 1.06 + (0.12 if cell["rain"] > 0 else 0.0), 2)

        c_temp = insat_sst if is_sea else insat_lst
        c_rain = insat_rain
        humidity = cell["humidity"]
        heat_stress = round(c_temp + 0.05 * humidity, 2)

        if heat_stress > 38.0 or c_rain > 22.0:
            risk_zone = "CRITICAL"
        elif heat_stress > 34.0 or c_rain > 12.0:
            risk_zone = "WARNING"
        elif heat_stress < 10.0:
            risk_zone = "LOW"
        else:
            risk_zone = "MODERATE"

        new_cell = {
            **cell,
            "insat_lst": insat_lst,
            "insat_sst": insat_sst,
            "insat_rain": insat_rain,
            "temp": c_temp,
            "rain": c_rain,
            "heat_stress": heat_stress,
            "risk_zone": risk_zone,
            "sensor": "insat_satellite"
        }
        calibrated.append(new_cell)
    return calibrated


@router.get("/data")
def get_climate_data(
    day_offset:  int = Query(0,         description="Offset from today. Neg for history, Pos for ML forecast."),
    source:      str = Query("auto",    description="Data source: 'auto', 'npy', 'netcdf', or 'synthetic'."),
    sensor_type: str = Query("ground",  description="Sensor overlay type: 'ground' (IMD observations) or 'satellite' (INSAT 3RIMG).")
):
    """
    Returns telemetry for the 31×31 climate grid over India.

    Source priority when source='auto':
      1. Real .npy IMD arrays (today or historical)
      2. Latest .nc NetCDF file
      3. Synthetic data generator

    For positive day_offset, the CNN model auto-regressively predicts
    forward from the latest real observation.
    """
    grid        = None
    data_source = "synthetic"

    # ── 1. Real .npy arrays ────────────────────────────────────────────────
    if source in ("auto", "npy") and npy_available():
        if day_offset <= 0:
            # Historical or today → serve from real .npy data
            grid        = get_npy_grid(day_offset=day_offset)
            data_source = "npy_real"
        else:
            # Future offset → start from today's real data, run ML model
            today_grid = get_npy_grid(day_offset=0)
            if today_grid and ml_predictor.is_available():
                grid        = ml_predictor.predict_multi_step(today_grid, steps=day_offset)
                data_source = "npy_real+cnn_ml"
            elif today_grid:
                # ML not available — shift synthetic on top of real today
                grid        = get_grid_telemetry(day_offset=day_offset)
                data_source = "npy_real+synthetic_forecast"

    # ── 2. NetCDF fallback ─────────────────────────────────────────────────
    if grid is None and source in ("auto", "netcdf"):
        nc_file = find_latest_netcdf(DATA_RAW_DIR)
        if nc_file:
            logger.info(f"Loading NetCDF: {nc_file}")
            grid = load_netcdf_grid(nc_file, day_offset=max(0, day_offset))
            if grid:
                data_source = f"netcdf:{os.path.basename(nc_file)}"
            else:
                logger.warning("NetCDF parse failed — falling back to synthetic.")

    # ── 3. Synthetic fallback ──────────────────────────────────────────────
    if grid is None:
        grid        = get_grid_telemetry(day_offset)
        data_source = "synthetic"

    # ── 4. Apply Satellite Sensor Calibration if requested ──────────────────
    if sensor_type == "satellite":
        grid = apply_insat_satellite_calibration(grid)
        data_source += "+insat_satellite"

    # ── Summary statistics ─────────────────────────────────────────────────
    temps      = [c["temp"]        for c in grid]
    rains      = [c["rain"]        for c in grid]
    humidities = [c["humidity"]    for c in grid]
    stresses   = [c["heat_stress"] for c in grid]

    summary = {
        "avg_temp":        round(float(np.mean(temps)),      2),
        "max_temp":        round(float(np.max(temps)),       2),
        "min_temp":        round(float(np.min(temps)),       2),
        "avg_rain":        round(float(np.mean(rains)),      2),
        "total_rain":      round(float(np.sum(rains)),       1),
        "avg_humidity":    round(float(np.mean(humidities)), 1),
        "avg_heat_stress": round(float(np.mean(stresses)),   2),
        "critical_alerts": sum(1 for c in grid if c["risk_zone"] == "CRITICAL"),
        "warning_alerts":  sum(1 for c in grid if c["risk_zone"] == "WARNING"),
        "total_nodes":     len(grid),
    }

    return {
        "status":      "success",
        "day_offset":  day_offset,
        "data_source": data_source,
        "sensor_type": sensor_type,
        "summary":     summary,
        "grid":        grid,
    }
