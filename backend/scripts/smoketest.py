"""Import-and-call smoke test for the backend — no server startup needed.

Exercises every predictor / heatwave / argo / persona code path against
the bundled data_assets/. Fails loudly if any hardcoded path leaks in.

Run from backend/:
    python scripts/smoketest.py
"""
import sys, traceback
from pathlib import Path

# make `app.*` importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

FAILED = []

def check(name, fn):
    print(f'\n-- {name}')
    try:
        r = fn()
        print(f'   OK  {"" if r is None else str(r)[:200]}')
    except Exception as e:
        FAILED.append(name)
        print(f'   FAIL  {type(e).__name__}: {e}')
        traceback.print_exc()


def main():
    from app.config import settings, SURFACE_VARS, DEPTHS

    # 1. every path exists?
    for name in ('checkpoint_path', 'preds_cache', 'stats_path', 'static_path',
                 'surface_test_nc', 'target_test_nc', 'climatology_nc', 'argo_test_path'):
        p = getattr(settings, name)
        exists = p.exists()
        print(f'  {"OK  " if exists else "MISS"}  {name:18s}  {p}')
        if not exists:
            FAILED.append(f'missing file: {name} → {p}')

    # 2. predictor
    from app.predictor import get_predictor
    check('predictor init', get_predictor)
    p = get_predictor()

    check('bbox', p.bbox)
    check('available_dates (first 3)', lambda: p.available_dates()[:3])
    check('resolve_today', p.resolve_today)

    date = p.resolve_today()['mapped_date']
    lat, lon = 12.0, 85.0

    check('get_subsurface',   lambda: p.get_subsurface(date, 100)[0].shape)
    check('get_surface(sst)', lambda: p.get_surface(date, 'sst')[0].shape)
    check('get_profile',      lambda: len(p.get_profile(date, lat, lon)['predicted_C']))
    check('get_timeseries',   lambda: len(p.get_timeseries(lat, lon, 100)['dates']))
    check('metrics(mean_RMSE_C)', lambda: p.metrics()['mean_rmse_C'])

    # 3. heatwave
    from app.heatwave import HeatwaveDetector
    hw = HeatwaveDetector()
    check('heatwave.detect',  lambda: hw.detect(date)['summary'])

    # 4. argo
    from app.argo import get_validator
    argo = get_validator()
    check('argo.floats_on_day (count)', lambda: len(argo.floats_on_day(date, 3)))
    check('argo.validate_day',          lambda: argo.validate_day(p, date)['confidence_label'])

    # 5. personas
    from app.personas import one_liners, PERSONAS
    ctx = {'sst_C': 28.5, 'sst_anomaly_C': 0.4, 'heatwave_category': 'None',
           'profile_depths_m': [0,5,10,20,30,50,75,100,125,150,200,300,500,700,1000],
           'profile_temp_C':   [28,28,28,27,26,24,22,19,17,16,14,13,11,10, 8],
           'u_cur': 0.3, 'v_cur': -0.1, 'confidence_score': 78.4}
    for name in PERSONAS:
        check(f'personas.one_liners[{name}]', lambda n=name: one_liners(ctx)[n])

    # 6. FastAPI import (routes register at import time)
    check('import app.main (routes)', lambda: __import__('app.main', fromlist=['app']).app.title)

    print('\n' + '=' * 50)
    if FAILED:
        print(f'FAILED ({len(FAILED)}):')
        for f in FAILED: print(f'  - {f}')
        sys.exit(1)
    else:
        print('ALL CHECKS PASSED')


if __name__ == '__main__':
    main()
