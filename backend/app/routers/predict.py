"""
predict.py  — /api/predict
---------------------------
Returns AI forecasting summaries powered by the real trained CNN model.

Horizons: T+1, T+7, T+30 (auto-regressive multi-step inference).
Falls back to the synthetic data generator if the model is unavailable.
"""

from fastapi import APIRouter
from app.utils.data_generator import get_grid_telemetry
from app.models import ml_predictor
import numpy as np

router = APIRouter()


def _summarise(grid: list, label: str) -> dict:
    temps  = [c["temp"]  for c in grid]
    rains  = [c["rain"]  for c in grid]
    return {
        "label":           label,
        "avg_temp":        round(float(np.mean(temps)),  2),
        "max_temp":        round(float(np.max(temps)),   2),
        "avg_rain":        round(float(np.mean(rains)),  2),
        "critical_alerts": sum(1 for c in grid if c["risk_zone"] == "CRITICAL"),
        "warning_alerts":  sum(1 for c in grid if c["risk_zone"] == "WARNING"),
        "model_source":    "cnn_ml" if ml_predictor.is_available() else "synthetic",
    }


@router.get("/predict")
def get_predictions():
    """
    Returns AI forecasting summaries for T+1, T+7, and T+30 days.
    Uses the trained CNN model when available; falls back to the
    synthetic data generator otherwise.
    """
    # Base: today's grid (used as the seed for multi-step inference)
    today_grid = get_grid_telemetry(day_offset=0)

    if ml_predictor.is_available():
        # Real model predictions
        grid_t1  = ml_predictor.predict_next_day(today_grid)
        grid_t7  = ml_predictor.predict_multi_step(today_grid, steps=7)
        grid_t30 = ml_predictor.predict_multi_step(today_grid, steps=30)
    else:
        # Synthetic fallback
        grid_t1  = get_grid_telemetry(day_offset=1)
        grid_t7  = get_grid_telemetry(day_offset=7)
        grid_t30 = get_grid_telemetry(day_offset=30)

    return {
        "status":     "success",
        "model_ready": ml_predictor.is_available(),
        "predictions": {
            "T_1":  _summarise(grid_t1,  "Today + 1 Day"),
            "T_7":  _summarise(grid_t7,  "Today + 7 Days"),
            "T_30": _summarise(grid_t30, "Today + 30 Days"),
        },
    }
