import numpy as np
from typing import Dict, Any, List

# Define India boundary coordinates for 31x31 grid
LAT_MIN, LAT_MAX = 8.0, 37.0
LON_MIN, LON_MAX = 68.0, 97.0

def generate_base_grid() -> List[Dict[str, Any]]:
    """
    Generates a 31x31 grid of coordinates representing India.
    Includes realistic geographical climate baselines:
    - Cooler temperatures in the North (Himalayas).
    - Higher rainfall in the West Coast (Western Ghats) and North-East.
    - Dry/arid climate in the North-West (Thar Desert).
    """
    lats = np.linspace(LAT_MIN, LAT_MAX, 31)
    lons = np.linspace(LON_MIN, LON_MAX, 31)
    
    grid = []
    
    # We want to check if a coordinate falls roughly inside or near India's landmass
    # Simplified bounding polygon representing India's landmass shape to mask out oceans
    # (though for digital twin visuals, showing ocean points is fine too, but we can flag them)
    for i, lat in enumerate(lats):
        for j, lon in enumerate(lons):
            # 1. Base Temperature: decreases with latitude (North is colder)
            # Baseline temp between 15C and 38C
            base_temp = 32.0 - 0.5 * (lat - 8.0)
            
            # Himalayan altitude correction
            if lat > 28.0 and 74.0 < lon < 85.0:
                base_temp -= 15.0  # Cold mountains
            elif lat > 32.0:
                base_temp -= 20.0  # Very cold North
                
            # Add desert heat in West India
            if 24.0 < lat < 28.0 and 68.0 < lon < 74.0:
                base_temp += 5.0
                
            # 2. Base Rainfall (mm):
            # High in Western Ghats (lat 8-20, lon 72-74)
            # High in North-East (lat 22-28, lon 88-97)
            # Low in Thar desert (lat 24-28, lon 68-73)
            base_rain = 2.0  # background level
            if 8.0 <= lat <= 20.0 and 72.0 <= lon <= 75.0:
                base_rain += 15.0  # Heavy monsoon
            elif 22.0 <= lat <= 28.0 and 88.0 <= lon <= 97.0:
                base_rain += 20.0  # Wet North-East
            elif 24.0 <= lat <= 28.0 and 68.0 <= lon <= 74.0:
                base_rain = 0.1   # Arid desert
                
            # 3. Base Humidity (%): high near coasts, low in inland deserts
            is_coastal = (lon < 74.0 and lat < 20.0) or (lon > 80.0 and lat < 22.0)
            base_humidity = 80.0 if is_coastal else 50.0
            if 24.0 <= lat <= 28.0 and 68.0 <= lon <= 74.0:
                base_humidity = 20.0
                
            # 4. Wind Vectors (U, V components for particle overlay animations)
            # Baseline wind blowing from Southwest (Monsoon direction)
            wind_u = 3.0 + np.sin(lat/10) * 2.0
            wind_v = 4.0 + np.cos(lon/10) * 2.0
            
            grid.append({
                "id": i * 31 + j,
                "lat": float(lat),
                "lon": float(lon),
                "temp_base": float(base_temp),
                "rain_base": float(base_rain),
                "humidity_base": float(base_humidity),
                "wind_u": float(wind_u),
                "wind_v": float(wind_v)
            })
            
    return grid

def get_grid_telemetry(day_offset: int = 0) -> List[Dict[str, Any]]:
    """
    Computes active climate telemetry for a given day offset.
    - Negative offset: historical data.
    - Zero offset: today's real-time observation.
    - Positive offset: AI predictions (T+1 to T+30).
    Adds periodic fluctuations and seasonal cycles.
    """
    base_grid = generate_base_grid()
    active_grid = []
    
    for cell in base_grid:
        lat = cell["lat"]
        lon = cell["lon"]
        
        # Temporal shifts
        time_factor = np.sin(day_offset / 5.0)
        noise_temp = np.sin(lat * 1.5 + day_offset) * 1.2
        noise_rain = np.cos(lon * 2.0 + day_offset * 0.8) * 1.5
        
        # Calculate active values
        current_temp = cell["temp_base"] + (time_factor * 1.5) + noise_temp
        current_rain = max(0.0, cell["rain_base"] + (time_factor * 2.5) + noise_rain)
        current_humidity = min(100.0, max(10.0, cell["humidity_base"] + (time_factor * 5.0)))
        
        # Risk levels & Heat stress
        # Heat stress formula simple proxy: temp + 0.1 * humidity
        heat_stress = current_temp + 0.05 * current_humidity
        
        risk_zone = "MODERATE"
        if heat_stress > 38.0 or current_rain > 22.0:
            risk_zone = "CRITICAL"
        elif heat_stress > 34.0 or current_rain > 12.0:
            risk_zone = "WARNING"
        elif heat_stress < 10.0:
            risk_zone = "LOW"
            
        active_grid.append({
            "id": cell["id"],
            "lat": lat,
            "lon": lon,
            "temp": round(current_temp, 2),
            "rain": round(current_rain, 2),
            "humidity": round(current_humidity, 1),
            "wind_u": round(cell["wind_u"] + np.sin(day_offset), 2),
            "wind_v": round(cell["wind_v"] + np.cos(day_offset), 2),
            "heat_stress": round(heat_stress, 2),
            "risk_zone": risk_zone
        })
        
    return active_grid
