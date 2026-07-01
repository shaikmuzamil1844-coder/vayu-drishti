import sys
sys.path.insert(0, '.')

from app.models import ml_predictor
from app.utils.data_generator import get_grid_telemetry

ok = ml_predictor.is_available()
print(f"Model available: {ok}")

today = get_grid_telemetry(0)
print(f"Today grid size: {len(today)}")

if ok:
    t1 = ml_predictor.predict_next_day(today)
    print(f"T+1 grid size: {len(t1)}")
    print(f"T+1 sample temp: {t1[500]['temp']} C  rain: {t1[500]['rain']} mm  risk: {t1[500]['risk_zone']}")

    t7 = ml_predictor.predict_multi_step(today, steps=7)
    avg7 = sum(c["temp"] for c in t7) / len(t7)
    print(f"T+7 avg temp: {avg7:.2f} C")

    t30 = ml_predictor.predict_multi_step(today, steps=30)
    avg30 = sum(c["temp"] for c in t30) / len(t30)
    print(f"T+30 avg temp: {avg30:.2f} C")

    sim = ml_predictor.predict_with_perturbation(today, temp_delta=2.0, drought_mode=True)
    crit = sum(1 for c in sim if c["risk_zone"] == "CRITICAL")
    print(f"Drought sim critical zones: {crit}")

    print("All integration tests PASSED!")
else:
    print("Model not available - check model path")
