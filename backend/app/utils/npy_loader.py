"""
npy_loader.py
-------------
Loads the real IMD .npy climate arrays (maxtemp/mintemp/rainfall)
and serves them as the /api/data source for today and historical offsets.

Priority in data.py:
  1. Real .npy arrays (this module)
  2. NetCDF file (existing parser)
  3. Synthetic generator (fallback)
"""

import os
import numpy as np
from typing import List, Dict, Any, Optional

LAT_MIN, LAT_MAX = 8.0,  37.0
LON_MIN, LON_MAX = 68.0, 97.0
GRID_N = 31
SENTINEL = 99.0

# Locate data/raw directory (two levels up from this file: app/utils/ → app/ → backend/)
_HERE     = os.path.dirname(os.path.abspath(__file__))
_DATA_RAW = os.path.normpath(os.path.join(_HERE, "..", "..", "..", "data", "raw"))

# Lazy-loaded cache
_cache: Optional[np.ndarray] = None  # shape (N_days, 31, 31, 3)  channels: maxtemp, mintemp, rain
_total_days = 0


def _clean(arr: np.ndarray, clip_min=None, clip_max=None, sentinel=SENTINEL) -> np.ndarray:
    arr = arr.copy()
    mask = arr >= sentinel
    arr[mask] = arr[~mask].mean() if (~mask).any() else 0.0
    if clip_min is not None:
        arr = np.clip(arr, clip_min, None)
    if clip_max is not None:
        arr = np.clip(arr, None, clip_max)
    return arr


def _load_npy_tensor() -> Optional[np.ndarray]:
    """Load and concatenate 2024+2025 .npy files into a (N, 31, 31, 3) tensor."""
    files = {
        "maxtemp":  ["maxtemp_2024.npy",        "maxtemp_2025.npy"],
        "mintemp":  ["mintemp_2024.npy",         "mintemp_2025.npy"],
        "rainfall": ["rainfall_2024_small.npy",  "rainfall_2025_small.npy"],
    }

    arrays = {}
    for key, fnames in files.items():
        parts = []
        for fn in fnames:
            fp = os.path.join(_DATA_RAW, fn)
            if not os.path.exists(fp):
                return None   # any missing file → skip
            parts.append(np.load(fp).astype(np.float32))
        arrays[key] = np.concatenate(parts, axis=0)   # (N, 31, 31)

    # Clean channels
    arrays["maxtemp"]  = _clean(arrays["maxtemp"],  clip_min=-10, clip_max=60)
    arrays["mintemp"]  = _clean(arrays["mintemp"],  clip_min=-20, clip_max=55)
    arrays["rainfall"] = _clean(arrays["rainfall"], clip_min=0,   sentinel=300)

    # Stack → (N, 31, 31, 3)
    tensor = np.stack([arrays["maxtemp"], arrays["mintemp"], arrays["rainfall"]], axis=-1)
    return tensor


def _get_cache() -> Optional[np.ndarray]:
    global _cache, _total_days
    if _cache is None:
        _cache = _load_npy_tensor()
        if _cache is not None:
            _total_days = _cache.shape[0]
    return _cache


def _compute_risk(temp, rain, humidity) -> str:
    heat_stress = temp + 0.05 * humidity
    if heat_stress > 38.0 or rain > 22.0:
        return "CRITICAL"
    if heat_stress > 34.0 or rain > 12.0:
        return "WARNING"
    if heat_stress < 10.0:
        return "LOW"
    return "MODERATE"


def is_available() -> bool:
    return _get_cache() is not None


def get_npy_grid(day_offset: int = 0) -> Optional[List[Dict[str, Any]]]:
    """
    Return the real 31×31 grid for today ± day_offset.
    day_offset=0  → last available observation day
    day_offset>0  → we use the ML predictor (caller's responsibility)
    day_offset<0  → historical day
    """
    tensor = _get_cache()
    if tensor is None:
        return None

    # Map day_offset to an index in the tensor
    # Index 0 = oldest day, index -1 = latest (today)
    today_idx = _total_days - 1
    idx = today_idx + day_offset           # negative offset → older days
    idx = max(0, min(_total_days - 1, idx))

    day_data = tensor[idx]                 # (31, 31, 3)

    lats = np.linspace(LAT_MIN, LAT_MAX, GRID_N)
    lons = np.linspace(LON_MIN, LON_MAX, GRID_N)

    grid = []
    for r in range(GRID_N):
        for c in range(GRID_N):
            max_t = float(day_data[r, c, 0])
            min_t = float(day_data[r, c, 1])
            rain  = float(day_data[r, c, 2])

            avg_temp = (max_t + min_t) / 2.0
            humidity = float(np.clip(60.0 + rain * 0.4, 10, 100))
            heat_stress = avg_temp + 0.05 * humidity

            grid.append({
                "id":          r * GRID_N + c,
                "lat":         round(float(lats[r]), 4),
                "lon":         round(float(lons[c]), 4),
                "temp":        round(avg_temp,    2),
                "rain":        round(rain,         2),
                "humidity":    round(humidity,     1),
                "wind_u":      3.0,
                "wind_v":      4.0,
                "heat_stress": round(heat_stress,  2),
                "risk_zone":   _compute_risk(avg_temp, rain, humidity),
                "source":      "npy_real",
            })
    return grid
