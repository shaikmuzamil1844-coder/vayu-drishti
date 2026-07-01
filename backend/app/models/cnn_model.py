import numpy as np
from typing import List, Dict, Any
from app.utils.data_generator import get_grid_telemetry

def apply_climate_simulation(
    temp_delta: float,
    rain_delta: float,
    drought_mode: bool,
    flood_mode: bool
) -> List[Dict[str, Any]]:
    """
    Simulates climate transitions over India's 31x31 grid using a cellular
    automata / convolutional kernel approach in NumPy.
    
    1. Grid values (temp, rain, humidity) are mapped to 2D tensors.
    2. Inputs are perturbed by climate sliders (temp_delta, rain_delta).
    3. Global modes are applied (drought_mode lowers humidity and rain; flood_mode spikes rain and humidity).
    4. A convolutional dispersion kernel propagates thermal gradients and rainfall runoff to neighboring cells.
    5. The final output is flat-mapped back to a JSON-ready list.
    """
    # 1. Fetch current baseline (today)
    today_grid = get_grid_telemetry(day_offset=0)
    
    # 2. Reshape into 31x31 arrays for tensor-style CNN operations
    temp_grid = np.zeros((31, 31))
    rain_grid = np.zeros((31, 31))
    humidity_grid = np.zeros((31, 31))
    lats = np.zeros((31, 31))
    lons = np.zeros((31, 31))
    
    for cell in today_grid:
        idx = cell["id"]
        r = idx // 31
        c = idx % 31
        temp_grid[r, c] = cell["temp"]
        rain_grid[r, c] = cell["rain"]
        humidity_grid[r, c] = cell["humidity"]
        lats[r, c] = cell["lat"]
        lons[r, c] = cell["lon"]
        
    # 3. Apply baseline perturbations
    temp_grid += temp_delta
    rain_grid += rain_delta
    
    if drought_mode:
        temp_grid += 1.8  # Drought raises heat
        rain_grid *= 0.1  # Negligible rain
        humidity_grid *= 0.4  # Dry air
    
    if flood_mode:
        rain_grid += 8.0  # Spike rainfall
        humidity_grid = np.clip(humidity_grid + 25.0, 10, 100)
        temp_grid -= 1.0  # Clouds cool things slightly
        
    # 4. Convolutional Dispersion (simulate heatwaves spreading and monsoon wind runoff)
    # Define a 3x3 diffusion kernel
    kernel = np.array([
        [0.05, 0.1, 0.05],
        [0.1,  0.4, 0.1],
        [0.05, 0.1, 0.05]
    ])
    
    # Pad borders to avoid index errors during convolution
    padded_temp = np.pad(temp_grid, 1, mode='edge')
    padded_rain = np.pad(rain_grid, 1, mode='edge')
    
    sim_temp = np.zeros((31, 31))
    sim_rain = np.zeros((31, 31))
    
    for r in range(31):
        for c in range(31):
            # Extract 3x3 sub-grid
            temp_patch = padded_temp[r:r+3, c:c+3]
            rain_patch = padded_rain[r:r+3, c:c+3]
            
            # Element-wise multiplication & sum (conv-like operator)
            sim_temp[r, c] = np.sum(temp_patch * kernel)
            sim_rain[r, c] = np.sum(rain_patch * kernel)
            
    # Apply bounds and recalculate secondary indexes
    sim_rain = np.clip(sim_rain, 0.0, 100.0)
    sim_temp = np.clip(sim_temp, -10.0, 55.0)
    
    # 5. Build final grid list
    updated_grid = []
    for r in range(31):
        for c in range(31):
            c_id = r * 31 + c
            curr_temp = float(sim_temp[r, c])
            curr_rain = float(sim_rain[r, c])
            curr_humidity = float(np.clip(humidity_grid[r, c], 10, 100))
            
            # Recalculate risk indexes
            heat_stress = curr_temp + 0.05 * curr_humidity
            
            # Classify risk zones
            risk_zone = "MODERATE"
            if drought_mode and curr_temp > 35.0:
                risk_zone = "CRITICAL"  # High drought threat
            elif flood_mode and curr_rain > 15.0:
                risk_zone = "CRITICAL"  # High flood threat
            elif heat_stress > 38.0 or curr_rain > 22.0:
                risk_zone = "CRITICAL"
            elif heat_stress > 34.0 or curr_rain > 12.0:
                risk_zone = "WARNING"
            elif heat_stress < 10.0:
                risk_zone = "LOW"
                
            updated_grid.append({
                "id": c_id,
                "lat": float(lats[r, c]),
                "lon": float(lons[r, c]),
                "temp": round(curr_temp, 2),
                "rain": round(curr_rain, 2),
                "humidity": round(curr_humidity, 1),
                "heat_stress": round(heat_stress, 2),
                "risk_zone": risk_zone
            })
            
    return updated_grid
