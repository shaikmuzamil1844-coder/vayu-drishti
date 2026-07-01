"""
test_netcdf.py
--------------
Tests the full NetCDF ingestion pipeline:
 1. Creates a sample india_climate_sample.nc file
 2. Parses it through netcdf_parser.py
 3. Validates the output grid format
"""

import sys
import os

# Resolve paths
# backend/test_netcdf.py  →  project root is one level up
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BACKEND_DIR)
sys.path.insert(0, BACKEND_DIR)

from app.utils.create_sample_netcdf import create_sample_netcdf_file
from app.utils.netcdf_parser import load_netcdf_grid, find_latest_netcdf

DATA_RAW_DIR = os.path.join(ROOT_DIR, "data", "raw")
NC_PATH = os.path.join(DATA_RAW_DIR, "india_climate_sample.nc")

PASS = 0
FAIL = 0

def check(condition: bool, label: str):
    global PASS, FAIL
    if condition:
        print(f"  [PASS] {label}")
        PASS += 1
    else:
        print(f"  [FAIL] {label}")
        FAIL += 1

print("=" * 60)
print("VAYU-DRISHTI  ::  NetCDF Ingestion Test Suite")
print("=" * 60)

# --- TEST 1: Generate sample NetCDF ---
print("\n[TEST 1] Generate sample NetCDF file")
try:
    create_sample_netcdf_file()
    check(os.path.exists(NC_PATH), "NetCDF file created at data/raw/india_climate_sample.nc")
    size_kb = os.path.getsize(NC_PATH) / 1024
    check(size_kb > 1.0, f"File size is reasonable ({size_kb:.1f} KB)")
except Exception as e:
    print(f"  [ERROR] {e}")
    FAIL += 1

# --- TEST 2: Auto-discovery ---
print("\n[TEST 2] Auto-discovery of latest .nc file")
found = find_latest_netcdf(DATA_RAW_DIR)
check(found is not None, "find_latest_netcdf() returns a file path")
check(found is not None and found.endswith(".nc"), "Discovered file has .nc extension")

# --- TEST 3: Parse grid ---
print("\n[TEST 3] Parse NetCDF into 31x31 grid")
grid = load_netcdf_grid(NC_PATH, day_offset=0)
check(grid is not None, "Parsing returned a grid (not None)")

if grid is not None:
    check(len(grid) == 961, f"Grid has exactly 961 nodes — got {len(grid)}")

    # Validate first and last nodes
    first = grid[0]
    last = grid[-1]
    check("id" in first, "Nodes have 'id' field")
    check("lat" in first and "lon" in first, "Nodes have lat/lon fields")
    check("temp" in first, "Nodes have 'temp' field")
    check("rain" in first, "Nodes have 'rain' field")
    check("humidity" in first, "Nodes have 'humidity' field")
    check("heat_stress" in first, "Nodes have 'heat_stress' field")
    check("risk_zone" in first, "Nodes have 'risk_zone' field")
    check(first.get("source") == "netcdf", "Source annotated as 'netcdf'")

    # Temperature range sanity checks
    temps = [n["temp"] for n in grid]
    rains = [n["rain"] for n in grid]
    check(min(temps) > -30, f"Min temp sanity: {min(temps):.1f}C > -30C")
    check(max(temps) < 70,  f"Max temp sanity: {max(temps):.1f}C < 70C")
    check(min(rains) >= 0,  f"Min rain sanity: {min(rains):.2f} >= 0")

    # Risk zone coverage
    risk_counts = {}
    for n in grid:
        z = n["risk_zone"]
        risk_counts[z] = risk_counts.get(z, 0) + 1
    print(f"\n  Risk Zone Distribution: {risk_counts}")
    check(len(risk_counts) > 0, "At least one risk zone category present")

    # Lat/Lon bounds check
    check(abs(first["lat"] - 8.0) < 0.01, f"First node lat ~ 8.0N, got {first['lat']}")
    check(abs(first["lon"] - 68.0) < 0.01, f"First node lon ~ 68.0E, got {first['lon']}")
    check(abs(last["lat"] - 37.0) < 0.1,  f"Last node lat ~ 37.0N, got {last['lat']}")
    check(abs(last["lon"] - 97.0) < 0.1,  f"Last node lon ~ 97.0E, got {last['lon']}")

# --- Summary ---
print("\n" + "=" * 60)
print(f"Results: {PASS} PASSED   {FAIL} FAILED")
print("=" * 60)

if FAIL > 0:
    sys.exit(1)
