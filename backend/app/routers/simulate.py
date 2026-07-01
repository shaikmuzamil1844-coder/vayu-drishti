"""
simulate.py  — /api/simulate
------------------------------
What-If climate simulation endpoint.

Uses the real trained CNN model (via ml_predictor) to propagate
user-defined perturbations through the climate grid.
Falls back to the NumPy convolution simulator if TF is unavailable.
"""

from fastapi import APIRouter, Query
from app.models import ml_predictor
from app.models.cnn_model import apply_climate_simulation
from app.utils.data_generator import get_grid_telemetry
from app.routers.data import apply_insat_satellite_calibration
import numpy as np

router = APIRouter()


@router.get("/simulate")
def run_simulation(
    temp_delta:   float = Query(0.0,   description="Temperature adjustment offset in Celsius"),
    rain_delta:   float = Query(0.0,   description="Rainfall adjustment offset in mm"),
    drought_mode: bool  = Query(False, description="Enable extreme drought condition"),
    flood_mode:   bool  = Query(False, description="Enable flash flood warning scenario"),
    sensor_type:  str   = Query("ground",  description="Sensor overlay type: 'ground' or 'satellite'")
):
    """
    Computes a What-If climate simulation based on user configurations.

    When the trained CNN model is available, it applies the perturbations
    and feeds the modified grid through the neural network for physically
    consistent propagation.  Falls back to the NumPy kernel simulator otherwise.
    """
    today_grid = get_grid_telemetry(day_offset=0)

    if ml_predictor.is_available():
        sim_grid = ml_predictor.predict_with_perturbation(
            today_grid,
            temp_delta=temp_delta,
            rain_delta=rain_delta,
            drought_mode=drought_mode,
            flood_mode=flood_mode,
        )
        model_source = "cnn_ml"
    else:
        sim_grid     = apply_climate_simulation(temp_delta, rain_delta, drought_mode, flood_mode)
        model_source = "numpy_kernel"

    # Apply Satellite Sensor Calibration if requested
    if sensor_type == "satellite":
        sim_grid = apply_insat_satellite_calibration(sim_grid)
        model_source += "+insat_satellite"

    # Summary statistics
    temps      = [c["temp"]  for c in sim_grid]
    rains      = [c["rain"]  for c in sim_grid]
    humidities = [c["humidity"] for c in sim_grid]

    summary = {
        "avg_temp":        round(float(np.mean(temps)),       2),
        "max_temp":        round(float(np.max(temps)),        2),
        "avg_rain":        round(float(np.mean(rains)),       2),
        "total_rain":      round(float(np.sum(rains)),        1),
        "avg_humidity":    round(float(np.mean(humidities)),  1),
        "critical_alerts": sum(1 for c in sim_grid if c["risk_zone"] == "CRITICAL"),
        "warning_alerts":  sum(1 for c in sim_grid if c["risk_zone"] == "WARNING"),
        "total_nodes":     len(sim_grid),
        "model_source":    model_source,
    }

    return {
        "status":  "success",
        "inputs": {
            "temp_delta":   temp_delta,
            "rain_delta":   rain_delta,
            "drought_mode": drought_mode,
            "flood_mode":   flood_mode,
            "sensor_type":  sensor_type,
        },
        "summary": summary,
        "grid":    sim_grid,
    }
