from app.utils.data_generator import get_grid_telemetry
from app.models.cnn_model import apply_climate_simulation
from app.routers.chat import get_expert_fallback_response

def test_grid_generation():
    print("Testing grid generation...")
    grid = get_grid_telemetry(day_offset=0)
    assert len(grid) == 961, f"Expected 961 grid cells (31x31), got {len(grid)}"
    first = grid[0]
    assert "lat" in first and "lon" in first and "temp" in first
    print(f"[OK] Success: Grid contains {len(grid)} cells. Lat range: {grid[0]['lat']} to {grid[-1]['lat']}.")

def test_climate_simulation():
    print("Testing climate simulation...")
    sim_grid = apply_climate_simulation(temp_delta=2.0, rain_delta=-1.0, drought_mode=False, flood_mode=False)
    assert len(sim_grid) == 961
    assert sim_grid[0]["temp"] is not None
    print("[OK] Success: Simulation kernel processed 961 grid nodes.")

def test_chat_fallback():
    print("Testing copilot fallback solver...")
    stats = {"avg_temp": 28.5, "avg_rain": 4.2, "critical_alerts": 12, "total_rain": 1500.0, "avg_heat_stress": 30.5, "max_temp": 38.0}
    response = get_expert_fallback_response("Why is Karnataka hotter today?", stats)
    assert "Karnataka" in response or "driver" in response.lower()
    print("[OK] Success: Copilot responded with rich meteorological analysis.")

if __name__ == "__main__":
    print("=== RUNNING BACKEND UNIT TESTS ===")
    test_grid_generation()
    test_climate_simulation()
    test_chat_fallback()
    print("=== ALL TESTS PASSED SUCCESSFULLY ===")
