"""
ml_predictor.py
---------------
Singleton loader for the trained VAYU-DRISHTI CNN model.

Loads the model and normalization stats ONCE at startup.
Exposes:
  - predict_next_day(today_grid)  → tomorrow's grid cells
  - predict_multi_step(today_grid, steps) → list of future grids
"""

import os
import numpy as np
from typing import List, Dict, Any

# ── lazy TF import so the rest of the backend still works if TF is missing ──
_model = None
_norm  = None
_tf_available = False

MODEL_PATH = os.path.join(os.path.dirname(__file__), "climate_cnn_model_v2_best.h5")
NORM_PATH  = os.path.join(os.path.dirname(__file__), "norm_stats.npy")

# India grid constants
LAT_MIN, LAT_MAX = 8.0,  37.0
LON_MIN, LON_MAX = 68.0, 97.0
GRID_N = 31


def _load():
    """Load model + norm stats (called once on first use)."""
    global _model, _norm, _tf_available
    if _model is not None:
        return True
    try:
        import tensorflow as tf
        if not os.path.exists(MODEL_PATH):
            return False
        _model = tf.keras.models.load_model(MODEL_PATH, compile=False)
        _norm  = np.load(NORM_PATH, allow_pickle=True).item() if os.path.exists(NORM_PATH) else None
        _tf_available = True
        print(f"[ML] Loaded CNN model from {MODEL_PATH}")
        return True
    except Exception as e:
        print(f"[ML] Could not load CNN model: {e}")
        return False


# ── normalization helpers ──────────────────────────────────────────────────

def _normalize(arr: np.ndarray, mn: float, mx: float) -> np.ndarray:
    return (arr - mn) / (mx - mn + 1e-8)


def _denormalize(arr: np.ndarray, mn: float, mx: float) -> np.ndarray:
    return arr * (mx - mn + 1e-8) + mn


# ── grid ↔ tensor conversion ──────────────────────────────────────────────

def _grid_to_tensor(grid: List[Dict[str, Any]]) -> np.ndarray:
    """Convert flat list of 961 cells → (31,31,3) float32 tensor."""
    maxtemp  = np.zeros((GRID_N, GRID_N), dtype=np.float32)
    mintemp  = np.zeros((GRID_N, GRID_N), dtype=np.float32)
    rainfall = np.zeros((GRID_N, GRID_N), dtype=np.float32)

    for cell in grid:
        r = cell["id"] // GRID_N
        c = cell["id"] %  GRID_N
        # Map temp → maxtemp/mintemp proxy, rain → rainfall
        maxtemp[r, c]  = cell["temp"] + 2.0     # rough proxy for daily max
        mintemp[r, c]  = cell["temp"] - 4.0     # rough proxy for daily min
        rainfall[r, c] = cell["rain"]

    if _norm:
        maxtemp  = _normalize(maxtemp,  _norm["maxtemp_min"],  _norm["maxtemp_max"])
        mintemp  = _normalize(mintemp,  _norm["mintemp_min"],  _norm["mintemp_max"])
        rainfall = _normalize(rainfall, _norm["rainfall_min"], _norm["rainfall_max"])

    return np.stack([maxtemp, mintemp, rainfall], axis=-1)  # (31,31,3)


def _tensor_to_cells(
    tensor: np.ndarray,
    lat_grid: np.ndarray,
    lon_grid: np.ndarray,
) -> List[Dict[str, Any]]:
    """Convert (31,31,3) normalized tensor → flat list of cell dicts."""
    # Denormalize channels
    if _norm:
        maxtemp  = _denormalize(tensor[:, :, 0], _norm["maxtemp_min"],  _norm["maxtemp_max"])
        mintemp  = _denormalize(tensor[:, :, 1], _norm["mintemp_min"],  _norm["mintemp_max"])
        rainfall = _denormalize(tensor[:, :, 2], _norm["rainfall_min"], _norm["rainfall_max"])
    else:
        maxtemp  = tensor[:, :, 0]
        mintemp  = tensor[:, :, 1]
        rainfall = tensor[:, :, 2]

    rainfall = np.clip(rainfall, 0.0, None)

    cells = []
    for r in range(GRID_N):
        for c in range(GRID_N):
            cell_id   = r * GRID_N + c
            avg_temp  = float((maxtemp[r, c] + mintemp[r, c]) / 2.0)
            curr_rain = float(rainfall[r, c])
            humidity  = float(np.clip(60.0 + curr_rain * 0.5, 10, 100))  # proxy
            heat_stress = avg_temp + 0.05 * humidity

            # Risk classification (same thresholds as data_generator)
            if heat_stress > 38.0 or curr_rain > 22.0:
                risk_zone = "CRITICAL"
            elif heat_stress > 34.0 or curr_rain > 12.0:
                risk_zone = "WARNING"
            elif heat_stress < 10.0:
                risk_zone = "LOW"
            else:
                risk_zone = "MODERATE"

            cells.append({
                "id":          cell_id,
                "lat":         float(lat_grid[r, c]),
                "lon":         float(lon_grid[r, c]),
                "temp":        round(avg_temp,    2),
                "rain":        round(curr_rain,   2),
                "humidity":    round(humidity,    1),
                "wind_u":      3.0,
                "wind_v":      4.0,
                "heat_stress": round(heat_stress, 2),
                "risk_zone":   risk_zone,
            })
    return cells


def _build_lat_lon_grids():
    import numpy as np
    lats = np.linspace(LAT_MIN, LAT_MAX, GRID_N)
    lons = np.linspace(LON_MIN, LON_MAX, GRID_N)
    lon_grid, lat_grid = np.meshgrid(lons, lats)
    return lat_grid, lon_grid


# ── public API ────────────────────────────────────────────────────────────

def is_available() -> bool:
    return _load()


def predict_next_day(today_grid: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Run the CNN model for T+1.
    Falls back to synthetic shift if model is unavailable.
    """
    if not _load():
        from app.utils.data_generator import get_grid_telemetry
        return get_grid_telemetry(day_offset=1)

    lat_grid, lon_grid = _build_lat_lon_grids()
    tensor = _grid_to_tensor(today_grid)                    # (31,31,3)
    inp    = np.expand_dims(tensor, axis=0).astype(np.float32)  # (1,31,31,3)
    pred   = _model.predict(inp, verbose=0)[0]              # (31,31,3)
    return _tensor_to_cells(pred, lat_grid, lon_grid)


def predict_multi_step(
    today_grid: List[Dict[str, Any]],
    steps: int = 7,
) -> List[Dict[str, Any]]:
    """
    Auto-regressive multi-step prediction.
    Feeds each prediction back as input for the next step.
    Returns the grid at step `steps` ahead.
    """
    if not _load():
        from app.utils.data_generator import get_grid_telemetry
        return get_grid_telemetry(day_offset=steps)

    lat_grid, lon_grid = _build_lat_lon_grids()
    current_tensor = _grid_to_tensor(today_grid)

    for _ in range(steps):
        inp = np.expand_dims(current_tensor, axis=0).astype(np.float32)
        current_tensor = _model.predict(inp, verbose=0)[0]

    return _tensor_to_cells(current_tensor, lat_grid, lon_grid)


def predict_with_perturbation(
    today_grid: List[Dict[str, Any]],
    temp_delta: float = 0.0,
    rain_delta: float = 0.0,
    drought_mode: bool = False,
    flood_mode: bool = False,
) -> List[Dict[str, Any]]:
    """
    Run model prediction after applying user-defined perturbations.
    Used by the What-If simulator.
    """
    if not _load():
        from app.models.cnn_model import apply_climate_simulation
        return apply_climate_simulation(temp_delta, rain_delta, drought_mode, flood_mode)

    lat_grid, lon_grid = _build_lat_lon_grids()
    tensor = _grid_to_tensor(today_grid)   # (31,31,3) normalized

    # Apply perturbations in physical space then re-normalize
    if _norm:
        # Denormalize
        mt  = _denormalize(tensor[:,:,0], _norm["maxtemp_min"],  _norm["maxtemp_max"])
        mnt = _denormalize(tensor[:,:,1], _norm["mintemp_min"],  _norm["mintemp_max"])
        rf  = _denormalize(tensor[:,:,2], _norm["rainfall_min"], _norm["rainfall_max"])

        # Perturb
        mt  += temp_delta
        mnt += temp_delta
        rf  += rain_delta

        if drought_mode:
            mt  += 1.8;  mnt += 1.8
            rf  *= 0.1
        if flood_mode:
            rf  += 8.0
            mt  -= 1.0;  mnt -= 1.0

        # Re-normalize
        mt  = _normalize(np.clip(mt,  -10, 60), _norm["maxtemp_min"],  _norm["maxtemp_max"])
        mnt = _normalize(np.clip(mnt, -10, 55), _norm["mintemp_min"],  _norm["mintemp_max"])
        rf  = _normalize(np.clip(rf,    0, 400),_norm["rainfall_min"], _norm["rainfall_max"])
        tensor = np.stack([mt, mnt, rf], axis=-1)

    inp  = np.expand_dims(tensor, axis=0).astype(np.float32)
    pred = _model.predict(inp, verbose=0)[0]
    return _tensor_to_cells(pred, lat_grid, lon_grid)
