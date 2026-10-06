"""FastAPI entrypoint for the OceanEmbed web portal.

Endpoints (all under /api):
   GET  /health
   GET  /meta                                     — bbox, depths, channels, date range
   GET  /metrics                                  — per-depth RMSE / bias / correlation
   GET  /heatmap/subsurface?date&depth&kind       — pred | glorys | error PNG
   GET  /heatmap/surface?date&channel             — one of 8 satellite input channels PNG
   GET  /heatmap/heatwave?date                    — marine-heatwave category map PNG
   GET  /profile?date&lat&lon                     — JSON depth profile (pred + glorys + error)
   GET  /profile/plot?date&lat&lon                — profile as PNG
   GET  /timeseries?lat&lon&depth                 — JSON time series
   GET  /timeseries/plot?lat&lon&depth            — time series as PNG
   GET  /heatwave?date&llm=true                   — heatwave summary + recommendations + optional LLM narrative
   POST /analysis                                 — freeform LLM analysis (Groq)

Every heatmap route accepts click-through (lat/lon) resolution via /profile.
"""
from __future__ import annotations
import io
from datetime import datetime
import math

import numpy as np


def _json_safe(x):
    """Recursively replace NaN/inf floats with None so JSONResponse can serialise."""
    if isinstance(x, dict):
        return {k: _json_safe(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_json_safe(v) for v in x]
    if isinstance(x, float):
        return None if not math.isfinite(x) else x
    if isinstance(x, np.floating):
        v = float(x)
        return None if not math.isfinite(v) else v
    if isinstance(x, np.integer):
        return int(x)
    return x
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings, SURFACE_VARS, DEPTHS
from .predictor import get_predictor
from .plotting import heatmap_png, profile_png, timeseries_png, CMAPS
from .heatwave import HeatwaveDetector, CATEGORY_LABELS
from .argo import get_validator as get_argo
from . import groq_client
from .personas import one_liners, persona_system, PERSONAS, DEFAULT_PERSONA
from .schemas import (
    MetaResponse, BBox, ProfileResponse, ProfileAtDepthsResponse, TimeSeriesResponse,
    MetricsResponse, DepthMetric, AnalysisRequest, AnalysisResponse,
    HeatwaveResponse, HeatwaveSummary,
    ArgoFloat, ArgoProfile, ArgoValidationResponse, ArgoDepthMetric,
)


app = FastAPI(
    title='OceanEmbed API',
    version='0.1.0',
    description='Subsurface temperature reconstruction + marine-heatwave detection for the North Indian Ocean.',
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex='.*',       # wildcard-safe with credentials disabled
    allow_credentials=False,       # ('*' + credentials=True is rejected by browsers)
    allow_methods=['*'],
    allow_headers=['*'],
)

# lazy singletons — built once at startup
_hw: HeatwaveDetector | None = None
def hw() -> HeatwaveDetector:
    global _hw
    if _hw is None:
        _hw = HeatwaveDetector()
    return _hw


# ─────────────────────────────── startup event
@app.on_event('startup')
def _startup():
    p = get_predictor()
    if p.cache is None:
        print('WARNING: predictor cache empty. /heatmap/subsurface and /profile will 503 until '
              'you run evaluate_2025.ipynb to produce preds_2025.npz.')
    # Warm the heatwave detector (climatology is expensive)
    try:
        hw()
    except Exception as e:
        print(f'[startup] heatwave detector deferred: {e}')
    # Warm the ARGO validator (loads ~1.8 M measurements, keeps them in memory)
    try:
        get_argo()
    except Exception as e:
        print(f'[startup] ARGO validator deferred: {e}')


# ─────────────────────────────── basic
@app.get('/api/health')
def health():
    return {'ok': True, 'time': datetime.utcnow().isoformat() + 'Z'}


@app.get('/api/today')
def today():
    """The date the portal should show by default.

    If today's real calendar date is inside the cached-prediction range, use it directly.
    Otherwise map to the same day-of-year in the cache — so on 2026-09-08 you see
    the 2025-09-08 prediction (same season, current-feeling state)."""
    return get_predictor().resolve_today()


def resolve_date(date: str) -> str:
    """Any endpoint accepting a date can pass through resolve_date(date).
    Special aliases:
      'today'  -> today mapped via day-of-year to the cache
      'latest' -> last date in the cache
    """
    if date is None:
        return date
    d = date.strip().lower()
    if d == 'today':
        r = get_predictor().resolve_today()
        return r.get('mapped_date') or date
    if d == 'latest':
        p = get_predictor()
        if p.cache is not None:
            return str(p.cache['times'][-1].date())
    return date


@app.get('/api/meta', response_model=MetaResponse)
def meta():
    p = get_predictor()
    dates = p.available_dates()
    return MetaResponse(
        bbox=BBox(**p.bbox()),
        depths_m=p.available_depths(),
        surface_channels=p.available_surface_channels(),
        n_dates=len(dates),
        date_min=dates[0] if dates else None,
        date_max=dates[-1] if dates else None,
        checkpoint=str(settings.checkpoint_path),
    )


@app.get('/api/metrics', response_model=MetricsResponse)
def metrics():
    p = get_predictor()
    if p.cache is None:
        raise HTTPException(503, 'predictions cache not loaded — run evaluate_2025.ipynb first')
    m = p.metrics()
    return MetricsResponse(
        per_depth=[DepthMetric(**r) for r in m['per_depth']],
        mean_rmse_C=m['mean_rmse_C'],
    )


# ─────────────────────────────── heatmaps
@app.get('/api/heatmap/subsurface')
def heatmap_subsurface(
    date: str = Query(..., description="YYYY-MM-DD or 'today' or 'latest'"),
    depth: int = Query(100, description='standard depth in metres'),
    kind: str = Query('pred', pattern='^(pred|glorys|error)$'),
):
    date = resolve_date(date)
    p = get_predictor()
    if p.cache is None:
        raise HTTPException(503, 'predictions cache not loaded')
    try:
        pred, target, meta = p.get_subsurface(date, depth)
    except Exception as e:
        raise HTTPException(400, str(e))

    if kind == 'pred':
        arr, title, unit, cmap = pred, f'Predicted T @ {meta["depth_m"]} m — {meta["date"]}', '°C', CMAPS['temperature']
        vmin, vmax = np.nanpercentile(pred, 2), np.nanpercentile(pred, 98)
    elif kind == 'glorys':
        arr, title, unit, cmap = target, f'GLORYS T @ {meta["depth_m"]} m — {meta["date"]}', '°C', CMAPS['temperature']
        vmin, vmax = np.nanpercentile(target, 2), np.nanpercentile(target, 98)
    else:  # error
        arr = pred - target
        title, unit, cmap = f'Error (pred − GLORYS) @ {meta["depth_m"]} m — {meta["date"]}', '°C', CMAPS['error']
        m = max(2.0, float(np.nanpercentile(np.abs(arr), 98)))
        vmin, vmax = -m, m

    png = heatmap_png(arr, p.lon, p.lat, title, unit, cmap=cmap, vmin=vmin, vmax=vmax)
    return Response(content=png, media_type='image/png')


@app.get('/api/heatmap/surface')
def heatmap_surface(date: str = Query(...), channel: str = Query('sst')):
    date = resolve_date(date)
    p = get_predictor()
    if channel not in SURFACE_VARS:
        raise HTTPException(400, f'unknown channel; expected one of {SURFACE_VARS}')
    arr, meta = p.get_surface(date, channel)
    vmin = float(np.nanpercentile(arr, 2)); vmax = float(np.nanpercentile(arr, 98))
    if channel in ('sla', 'u_cur', 'v_cur', 'u_wind', 'v_wind'):
        m = max(abs(vmin), abs(vmax)); vmin, vmax = -m, m
    title = f'{channel.upper()} — {meta["date"]}'
    png = heatmap_png(arr, p.lon, p.lat, title, meta['units'], cmap=CMAPS.get(channel, 'viridis'),
                       vmin=vmin, vmax=vmax)
    return Response(content=png, media_type='image/png')


@app.get('/api/heatmap/heatwave')
def heatmap_heatwave(date: str = Query(...)):
    date = resolve_date(date)
    p = get_predictor()
    result = hw().detect(date)
    cat = result['category_map']
    title = f'Marine heatwave category (0–4) — {date}'
    png = heatmap_png(cat.astype('float32'), p.lon, p.lat, title, 'category',
                       cmap='Reds', vmin=0, vmax=4)
    return Response(content=png, media_type='image/png')


# ─────────────────────────────── raw grids (client-side heatmap rendering)
@app.get('/api/grid/subsurface')
def grid_subsurface(
    date: str = Query(..., description="YYYY-MM-DD or 'today' or 'latest'"),
    depth: int = Query(100),
    kind: str = Query('pred', pattern='^(pred|glorys|error)$'),
):
    """Return the raw temperature field as JSON — for client-side interactive
    canvas rendering with an arbitrary colormap. Much more responsive than PNG."""
    date = resolve_date(date)
    p = get_predictor()
    if p.cache is None:
        raise HTTPException(503, 'predictions cache not loaded')
    try:
        pred, target, meta = p.get_subsurface(date, depth)
    except Exception as e:
        raise HTTPException(400, str(e))

    if kind == 'pred':      arr = pred
    elif kind == 'glorys':  arr = target
    else:                   arr = pred - target

    # sanitise NaN -> null, compute robust colour range
    finite = np.isfinite(arr)
    vmin = float(np.nanpercentile(arr, 2))  if finite.any() else 0.0
    vmax = float(np.nanpercentile(arr, 98)) if finite.any() else 1.0
    values = [[None if not np.isfinite(v) else round(float(v), 3) for v in row] for row in arr]
    return _json_safe({
        'date': meta['date'], 'depth_m': meta['depth_m'], 'kind': kind,
        'lat': [round(float(v), 4) for v in p.lat],
        'lon': [round(float(v), 4) for v in p.lon],
        'values': values,
        'units': '°C', 'vmin': round(vmin, 2), 'vmax': round(vmax, 2),
    })


@app.get('/api/grid/surface')
def grid_surface(date: str = Query(...), channel: str = Query('sst')):
    """Raw surface-channel grid as JSON."""
    date = resolve_date(date)
    p = get_predictor()
    if channel not in SURFACE_VARS:
        raise HTTPException(400, f'unknown channel; expected one of {SURFACE_VARS}')
    arr, meta = p.get_surface(date, channel)
    finite = np.isfinite(arr)
    vmin = float(np.nanpercentile(arr, 2))  if finite.any() else 0.0
    vmax = float(np.nanpercentile(arr, 98)) if finite.any() else 1.0
    values = [[None if not np.isfinite(v) else round(float(v), 3) for v in row] for row in arr]
    return _json_safe({
        'date': meta['date'], 'channel': channel, 'units': meta['units'],
        'lat': [round(float(v), 4) for v in p.lat],
        'lon': [round(float(v), 4) for v in p.lon],
        'values': values,
        'vmin': round(vmin, 2), 'vmax': round(vmax, 2),
    })


@app.get('/api/grid/heatwave')
def grid_heatwave(date: str = Query(...)):
    """Heatwave category (0-4) as a JSON grid."""
    date = resolve_date(date)
    r = hw().detect(date)
    cat = r['category_map']
    return {
        'date': date,
        'lat': [round(float(v), 4) for v in get_predictor().lat],
        'lon': [round(float(v), 4) for v in get_predictor().lon],
        'values': [[int(v) for v in row] for row in cat.tolist()],
        'vmin': 0, 'vmax': 4,
        'legend': {0: 'None', 1: 'Moderate', 2: 'Strong', 3: 'Severe', 4: 'Extreme'},
    }


# ─────────────────────────────── coastlines (static GeoJSON)
@app.get('/api/coastlines')
def coastlines():
    """GeoJSON MultiLineString of the NIO coastlines — extracted from the model's
    land mask via marching squares. Small (~19 KB), cacheable, no external CDN."""
    path = settings.coastlines_path
    if not path.exists():
        raise HTTPException(503, f'{path.name} not built — run scripts/build_coastlines.py')
    import json as _json
    return _json.loads(path.read_text())


# ─────────────────────────────── clickable profile / timeseries
@app.get('/api/profile', response_model=ProfileResponse)
def profile(date: str = Query(...), lat: float = Query(...), lon: float = Query(...)):
    date = resolve_date(date)
    p = get_predictor()
    try:
        return p.get_profile(date, lat, lon)
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get('/api/profile_at_depths', response_model=ProfileAtDepthsResponse)
def profile_at_depths(date: str = Query(...), lat: float = Query(...), lon: float = Query(...),
                      depths: str = Query(..., description='Comma-separated depths in metres, e.g. "12.5,42,88"')):
    """Arbitrary-depth temperature query — PCHIP-interpolated along the v3
    monotonicity-preserving profile at the nearest grid cell. Powers the
    frontend depth slider + 15-value dropdown so users can inspect any level
    between 0 and 1000 m, not just the standard depths."""
    date = resolve_date(date)
    try:
        zs = [float(x) for x in depths.split(',') if x.strip()]
    except ValueError:
        raise HTTPException(400, 'depths must be a comma-separated list of numbers')
    if not zs:
        raise HTTPException(400, 'depths parameter is empty')
    if len(zs) > 512:
        raise HTTPException(400, 'too many depths (max 512 per call)')
    p = get_predictor()
    try:
        return _json_safe(p.get_profile_at_depths(date, lat, lon, zs))
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get('/api/profile/plot')
def profile_plot(date: str = Query(...), lat: float = Query(...), lon: float = Query(...)):
    date = resolve_date(date)
    p = get_predictor()
    r = p.get_profile(date, lat, lon)
    png = profile_png(np.asarray(r['depths_m']),
                      np.asarray(r['predicted_C']),
                      np.asarray(r['glorys_C']),
                      f'Profile @ ({r["lat"]:.2f}, {r["lon"]:.2f}) — {r["date"]}')
    return Response(content=png, media_type='image/png')


@app.get('/api/timeseries', response_model=TimeSeriesResponse)
def timeseries(lat: float = Query(...), lon: float = Query(...), depth: int = Query(100)):
    p = get_predictor()
    try:
        return p.get_timeseries(lat, lon, depth)
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get('/api/timeseries/plot')
def timeseries_plot(lat: float = Query(...), lon: float = Query(...), depth: int = Query(100)):
    p = get_predictor()
    r = p.get_timeseries(lat, lon, depth)
    png = timeseries_png(r['dates'], r['predicted_C'], r['glorys_C'],
                          f'T @ {r["depth_m"]} m  ({r["lat"]:.2f}, {r["lon"]:.2f})')
    return Response(content=png, media_type='image/png')


# ─────────────────────────────── marine heatwave — calamity forecast + LLM disaster analyst
@app.get('/api/heatwave/analyze')
def heatwave_analyze(date: str = Query(...), llm: bool = Query(True), lookback_days: int = Query(7)):
    """Rich marine-heatwave situation report for the given date.

    Computes the current MHW state + a `lookback_days` history trend, evaluates
    intensification risk, and (if `llm=true`) generates an official-style disaster
    advisory via Groq — recommended actions per stakeholder, tone-matched to
    severity.  This is the endpoint the frontend Heatwave tab should call.
    """
    date = resolve_date(date)
    detector = hw()

    # Trend series (past N days ending at `date`)
    from datetime import datetime, timedelta
    d0 = datetime.strptime(date, '%Y-%m-%d')
    trend = []
    for i in range(lookback_days, -1, -1):
        d = (d0 - timedelta(days=i)).strftime('%Y-%m-%d')
        try:
            s = detector.detect(d)['summary']
            trend.append({
                'date': s['date'],
                'area_pct': s['area_percent_in_mhw'],
                'max_anom': s['max_anomaly_C'],
                'mean_anom': s['mean_anomaly_C'],
                'severe_pixels': s['categories'].get('Severe', 0) + s['categories'].get('Extreme', 0),
            })
        except Exception:
            pass

    curr = trend[-1] if trend else None
    # simple trend classifier
    trend_label = 'STABLE'
    if len(trend) >= 3 and curr:
        d_area = curr['area_pct'] - trend[0]['area_pct']
        d_anom = (curr['max_anom'] or 0) - (trend[0]['max_anom'] or 0)
        if d_area > 5 or d_anom > 0.5:      trend_label = 'INTENSIFYING'
        elif d_area < -5 or d_anom < -0.5:  trend_label = 'DECAYING'

    # risk score 0-100 (heuristic — area × intensity × trend multiplier)
    risk = 0.0
    if curr:
        risk = min(100, 0.6 * curr['area_pct'] + 20 * max(0, (curr['max_anom'] or 0) - 1.0))
        if trend_label == 'INTENSIFYING': risk = min(100, risk * 1.3)
    risk_label = 'CRITICAL' if risk > 70 else 'HIGH' if risk > 45 else 'ELEVATED' if risk > 20 else 'LOW'

    # Sync current-day summary (rule-based recommendations included)
    curr_full = detector.detect(date)['summary']

    llm_advisory = None
    if llm and curr:
        # Build a compact context for the LLM
        ctx = f"""OFFICIAL MARINE HEATWAVE SITUATION REPORT — DRAFT
Region: North Indian Ocean (5-30 N, 45-105 E)  ·  Date: {date}
Model: OceanEmbedV3 (0.643 C mean RMSE, 92.7% correlation vs GLORYS)

CURRENT STATE
- Basin area currently in marine heatwave  : {curr['area_pct']:.1f} %
- Peak SST anomaly today                    : {curr['max_anom']:+.2f} C
- Mean SST anomaly today                    : {curr['mean_anom']:+.2f} C
- Severe/Extreme pixels                     : {curr['severe_pixels']}
- Category counts (Moderate / Strong / Severe / Extreme): {curr_full['categories']}

7-DAY TREND
{chr(10).join(f"  {t['date']}  area {t['area_pct']:5.1f}%  peak {t['max_anom']:+.2f} C  severe_px {t['severe_pixels']}" for t in trend)}

TREND CLASSIFICATION : {trend_label}
COMPOSITE RISK SCORE : {risk:.0f}/100   ({risk_label})

Baseline rule-based recommendations already generated:
{chr(10).join('- ' + r for r in curr_full['recommendations'])}

TASK: Write a concise, disaster-management-desk-style advisory for this event.
Format:
  1. HEADLINE (one line, all-caps for the risk level)
  2. SITUATION  (2-3 sentences on current state and 7-day evolution)
  3. IMPACTS EXPECTED (bullet points: coral, fisheries, cyclogenesis, coastal communities)
  4. RECOMMENDED ACTIONS (bullet points, addressed to specific agencies — IMD, INCOIS,
     coastal-state DMAs, fisheries departments, tourism boards, coral-reef managers)
  5. NEXT UPDATE (when should the situation be re-checked)

Keep it under 300 words. No boilerplate. No invented numbers."""
        try:
            llm_advisory = groq_client.analyse(ctx, max_tokens=700)
        except Exception as e:
            llm_advisory = f'(LLM unavailable: {e})'

    return _json_safe({
        'date': date,
        'lookback_days': lookback_days,
        'trend': trend,
        'trend_label': trend_label,
        'risk_score': round(risk, 1),
        'risk_label': risk_label,
        'current': curr_full,
        'llm_advisory': llm_advisory,
    })


# ─────────────────────────────── marine heatwave (JSON + LLM narrative)
@app.get('/api/heatwave', response_model=HeatwaveResponse)
def heatwave(date: str = Query(...), llm: bool = Query(False)):
    date = resolve_date(date)
    r = hw().detect(date)
    summary = r['summary']
    narrative = None
    if llm:
        ctx = f"""Date: {summary['date']}
Marine-heatwave summary for the North Indian Ocean:
- Area in MHW: {summary['area_percent_in_mhw']}%
- Max SST anomaly: {summary['max_anomaly_C']:+.2f} °C
- Mean SST anomaly: {summary['mean_anomaly_C']:+.2f} °C
- Category pixel counts: {summary['categories']}

Automatic rule-based recommendations already produced:
{chr(10).join('- ' + r for r in summary['recommendations'])}

Please: (a) interpret the severity in one paragraph, (b) mention likely downstream
oceanographic and ecological effects, (c) suggest 2-3 additional actions the
rule-based system may have missed."""
        try:
            narrative = groq_client.analyse(ctx)
        except Exception as e:
            narrative = f'(LLM unavailable: {e})'
    return HeatwaveResponse(summary=HeatwaveSummary(**summary), llm_narrative=narrative)


# ─────────────────────────────── ARGO validation (independent ground truth + confidence)
@app.get('/api/argo/floats', response_model=list[ArgoFloat])
def argo_floats(date: str = Query(..., description="YYYY-MM-DD or 'today' or 'latest'"),
                window_days: int = Query(3, ge=0, le=15)):
    """Positions of ARGO floats within ±window_days of `date`. Feed to the map."""
    date = resolve_date(date)
    return get_argo().floats_on_day(date, window_days=window_days)


@app.get('/api/argo/profile', response_model=ArgoProfile)
def argo_profile(platform: str = Query(...), cycle: int | None = Query(None)):
    """Full T-vs-pressure profile from one ARGO float."""
    r = get_argo().profile(platform, cycle)
    if not r['pressures_dbar']:
        raise HTTPException(404, f'no ARGO profile for platform {platform} cycle {cycle}')
    return r


@app.get('/api/argo/validate', response_model=ArgoValidationResponse)
def argo_validate(date: str = Query(...),
                   window_days: int = Query(3, ge=0, le=15)):
    """Compare model predictions to real ARGO points near `date`. Returns a
    0-100 confidence score, per-depth RMSE/bias/correlation, and a scatter sample."""
    date = resolve_date(date)
    p = get_predictor()
    if p.cache is None:
        raise HTTPException(503, 'predictor cache not loaded — run evaluate_v3.ipynb first')
    r = get_argo().validate_day(p, date, window_days=window_days)
    return ArgoValidationResponse(
        date=r['date'], window_days=r['window_days'],
        n_argo_points=r['n_argo_points'],
        confidence_score=r['confidence_score'],
        confidence_label=r['confidence_label'],
        summary=r['summary'],
        per_depth=[ArgoDepthMetric(**x) for x in r['per_depth']],
        scatter=r['scatter'],
    )


@app.get('/api/argo/validate/plot')
def argo_validate_plot(date: str = Query(...), window_days: int = Query(3, ge=0, le=15)):
    """Model-vs-ARGO scatter PNG for the given date's ±window."""
    date = resolve_date(date)
    p = get_predictor()
    if p.cache is None:
        raise HTTPException(503, 'predictor cache not loaded')
    r = get_argo().validate_day(p, date, window_days=window_days)
    if not r['scatter']['argo']:
        raise HTTPException(404, 'no ARGO points near this date')

    import io, matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    a = np.array(r['scatter']['argo']); m = np.array(r['scatter']['model'])
    fig, ax = plt.subplots(figsize=(6, 6), constrained_layout=True)
    sc = ax.scatter(a, m, c=r['scatter']['pressure_dbar'], s=6, alpha=0.4, cmap='viridis_r')
    lo, hi = float(min(a.min(), m.min())), float(max(a.max(), m.max()))
    ax.plot([lo, hi], [lo, hi], 'r-', lw=1)
    ax.set_xlabel('ARGO T (°C)'); ax.set_ylabel('Model T (°C)')
    label = r['confidence_label']; score = r['confidence_score']
    ax.set_title(f'{date}  ±{window_days}d   n={r["n_argo_points"]:,}   confidence={score}/100 ({label})')
    ax.grid(alpha=0.3)
    plt.colorbar(sc, ax=ax, label='pressure (dbar)')
    buf = io.BytesIO(); fig.savefig(buf, format='png', dpi=110, bbox_inches='tight'); plt.close(fig)
    return Response(content=buf.getvalue(), media_type='image/png')


# ─────────────────────────────── freeform Groq analysis
@app.post('/api/analysis', response_model=AnalysisResponse)
def analysis(req: AnalysisRequest):
    try:
        text = groq_client.analyse(req.context, extra_system=req.extra_system)
    except Exception as e:
        raise HTTPException(503, f'groq: {e}')
    return AnalysisResponse(analysis=text, model=settings.groq_model)


# ─────────────────────────────── persona-tailored one-liners at a point
def _build_pixel_context(date: str, lat: float, lon: float) -> dict:
    """Assemble everything we know about a single pixel/date into one dict.

    Used by /api/insights and /api/chat so all downstream consumers see the same context.
    """
    p = get_predictor()
    ctx: dict = {'date': date, 'lat': float(lat), 'lon': float(lon)}
    # subsurface profile (if cache is loaded)
    if p.cache is not None:
        try:
            prof = p.get_profile(date, lat, lon)
            ctx['profile_depths_m'] = prof['depths_m']
            ctx['profile_temp_C']   = prof['predicted_C']
            ctx['profile_glorys_C'] = prof['glorys_C']
            # D20 from profile (linear interp)
            depths = np.asarray(prof['depths_m'], dtype='float32')
            tprof  = np.asarray(prof['predicted_C'], dtype='float32')
            sign = tprof > 20.0
            k = int(sign.sum()) - 1
            if 0 <= k < len(depths) - 1:
                dz = depths[k+1] - depths[k]
                dt = tprof[k+1]  - tprof[k]
                ctx['d20_m'] = float(depths[k] + (20.0 - tprof[k]) / dt * dz) if abs(dt) > 1e-6 else None
        except Exception:
            pass
    # surface state + heatwave
    try:
        r = hw().detect(date)
        iy = int(np.argmin(np.abs(p.lat - lat)))
        ix = int(np.argmin(np.abs(p.lon - lon)))
        ctx['sst_C']          = float(r['sst'][iy, ix])
        ctx['sst_anomaly_C']  = float(r['anomaly'][iy, ix])
        ctx['heatwave_category'] = CATEGORY_LABELS.get(int(r['category_map'][iy, ix]), 'None')
    except Exception:
        pass
    # surface currents / winds
    for ch in ('u_cur', 'v_cur', 'u_wind', 'v_wind'):
        try:
            arr, _ = p.get_surface(date, ch)
            iy = int(np.argmin(np.abs(p.lat - lat)))
            ix = int(np.argmin(np.abs(p.lon - lon)))
            ctx[ch] = float(arr[iy, ix])
        except Exception:
            pass
    # ARGO confidence for the day
    try:
        v = get_argo().validate_day(p, date, window_days=3)
        ctx['confidence_score'] = v.get('confidence_score')
        ctx['confidence_label'] = v.get('confidence_label')
        ctx['n_argo_points']    = v.get('n_argo_points')
    except Exception:
        pass
    return ctx


@app.get('/api/insights')
def insights(date: str = Query(...), lat: float = Query(...), lon: float = Query(...),
              persona: str = Query('all', description="'all' or one of: " + ', '.join(PERSONAS.keys()))):
    """Rule-based one-liners for the clicked pixel, grouped by user persona.

    Every persona (fisheries / oceanographer / navy / ONGC / shipping / coastal_mgmt /
    general) gets a short list of insights derived deterministically from the model
    predictions + heatwave + ARGO validation for that pixel/date.
    """
    date = resolve_date(date)
    ctx  = _build_pixel_context(date, lat, lon)
    lines = one_liners(ctx)
    if persona != 'all':
        if persona not in PERSONAS:
            raise HTTPException(400, f'unknown persona; choose from {list(PERSONAS.keys())} or "all"')
        lines = {persona: lines.get(persona, [])}
    # decorate with display names
    return {
        'context': {k: ctx.get(k) for k in ('date','lat','lon','sst_C','sst_anomaly_C',
                                             'heatwave_category','d20_m',
                                             'confidence_score','confidence_label','n_argo_points')},
        'personas': {k: {'display': PERSONAS[k]['display'], 'bullets': v} for k, v in lines.items()},
    }


# ─────────────────────────────── context-aware chat
@app.post('/api/chat')
def chat(payload: dict):
    """POST body:
        {
          "question": "why is thermocline shallow here?",
          "date":     "today" | "YYYY-MM-DD"   (optional)
          "lat":      15.0                     (optional; enables pixel context)
          "lon":      85.0                     (optional)
          "persona":  "fisheries"              (optional; default 'general')
          "history":  [{"role":"user","content":"..."},{"role":"assistant","content":"..."}]
        }

    The backend builds a rich context (bbox meta, per-depth metrics, pixel state,
    ARGO confidence, heatwave, rule-based one-liners for the requested persona) and
    prepends it to the user's question so Groq has everything it needs to answer.
    """
    question = (payload.get('question') or '').strip()
    if not question:
        raise HTTPException(400, 'question is required')
    persona  = payload.get('persona') or DEFAULT_PERSONA
    if persona not in PERSONAS:
        raise HTTPException(400, f'unknown persona; choose from {list(PERSONAS.keys())}')
    history  = payload.get('history') or []
    date     = payload.get('date')
    lat      = payload.get('lat')
    lon      = payload.get('lon')

    # ── build system prompt with all baseline model context
    p = get_predictor()
    lines = [
        'You are the AI analyst for the OceanEmbedV3 web portal.',
        'Model: hybrid CNN + ViT + cross-attention + depth-transformer + D20 auxiliary head.',
        f'Region: {settings.lat_min}-{settings.lat_max} °N, {settings.lon_min}-{settings.lon_max} °E (North Indian Ocean).',
        f'Standard prediction depths (m): {[int(d) for d in DEPTHS]}.',
        f'Surface input channels (8): {SURFACE_VARS}.',
    ]
    # global validation numbers
    try:
        m = p.metrics()
        lines.append(f'Overall model performance vs GLORYS (test 2025): mean RMSE {m["mean_rmse_C"]:.3f} °C across {len(m["per_depth"])} depths.')
    except Exception:
        pass

    lines.append('')
    lines.append(persona_system(persona))
    lines.append('')
    lines.append('IMPORTANT: never invent numbers. If a value is not provided below, say so.')
    lines.append('Keep responses under 300 words. Bullet points welcome.')
    system_prompt = '\n'.join(lines)

    # ── pixel-level context if lat/lon given
    user_context = ''
    if date and lat is not None and lon is not None:
        date = resolve_date(date)
        ctx = _build_pixel_context(date, float(lat), float(lon))
        bul = one_liners(ctx).get(persona, [])
        user_context = f"""=== PIXEL CONTEXT ({ctx['date']} at {ctx['lat']:.2f}°N, {ctx['lon']:.2f}°E) ===
SST                : {ctx.get('sst_C', 'n/a')}
SST anomaly        : {ctx.get('sst_anomaly_C', 'n/a')}
Marine heatwave    : {ctx.get('heatwave_category', 'None')}
D20 (20 °C depth)  : {ctx.get('d20_m', 'n/a')} m
Surface current    : u={ctx.get('u_cur', 'n/a')}  v={ctx.get('v_cur', 'n/a')}  m/s
Surface wind       : u={ctx.get('u_wind', 'n/a')}  v={ctx.get('v_wind', 'n/a')}  m/s
Model-vs-ARGO agreement: {ctx.get('confidence_score', 'n/a')}/100 ({ctx.get('confidence_label', 'n/a')})
Predicted profile (°C):
""" + '\n'.join(f'  {d:>4} m : {t:.2f}'
                 for d, t in zip(ctx.get('profile_depths_m', []),
                                 ctx.get('profile_temp_C', [])))
        if bul:
            user_context += '\nRule-based one-liners for this persona:\n' + '\n'.join('- ' + b for b in bul)
        user_context += '\n\n'

    # ── conversation
    messages = [{'role': 'system', 'content': system_prompt}]
    if user_context:
        messages.append({'role': 'system', 'content': user_context})
    for h in history[-8:]:                                 # cap history size
        if h.get('role') in ('user', 'assistant') and isinstance(h.get('content'), str):
            messages.append({'role': h['role'], 'content': h['content']})
    messages.append({'role': 'user', 'content': question})

    try:
        from groq import Groq
        if not settings.groq_api_key:
            raise RuntimeError('GROQ_API_KEY not set (put it in backend/.env).')
        client = Groq(api_key=settings.groq_api_key)
        resp = client.chat.completions.create(
            model=settings.groq_model,
            messages=messages,
            temperature=0.3, max_tokens=800,
        )
        answer = resp.choices[0].message.content.strip()
    except Exception as e:
        raise HTTPException(503, f'groq: {e}')

    return {'answer': answer,
            'persona': persona, 'persona_display': PERSONAS[persona]['display'],
            'model': settings.groq_model,
            'context_used': bool(user_context)}


@app.get('/api/personas')
def personas_list():
    """List all supported user personas (for a dropdown in the UI)."""
    return {k: {'display': v['display']} for k, v in PERSONAS.items()}


# ─────────────────────────────── one-shot pixel dossier — profile + heatwave + LLM in one call
@app.get('/api/pixel_report')
def pixel_report(date: str = Query(...), lat: float = Query(...), lon: float = Query(...),
                  llm: bool = Query(True)):
    """When the user clicks a pixel: return everything worth knowing about it."""
    date = resolve_date(date)
    p = get_predictor()
    prof = p.get_profile(date, lat, lon)

    # per-pixel MHW context
    r = hw().detect(date)
    iy = int(np.argmin(np.abs(p.lat - lat)))
    ix = int(np.argmin(np.abs(p.lon - lon)))
    cat = int(r['category_map'][iy, ix])
    anom = float(r['anomaly'][iy, ix])
    sst  = float(r['sst'][iy, ix])

    narrative = None
    if llm:
        ctx = f"""One pixel of the North Indian Ocean, {prof['date']} at ({prof['lat']:.2f}°N, {prof['lon']:.2f}°E):

Predicted subsurface temperature profile (°C):
{chr(10).join(f'  {d:>4} m : {p_:.2f} (GLORYS: {g:.2f}, error {p_-g:+.2f})'
              for d, p_, g in zip(prof['depths_m'], prof['predicted_C'], prof['glorys_C']))}

Surface state at this pixel today:
  SST                : {sst:.2f} °C
  SST anomaly (vs 2014-2024 climatology): {anom:+.2f} °C
  Marine-heatwave category: {CATEGORY_LABELS.get(cat, 'None')}

Analyse this water column in plain oceanographic language. Address:
  1. Thermocline depth and sharpness — normal, deep, shallow?
  2. Any signature of a mesoscale eddy, upwelling, or heat accumulation?
  3. What this means for local fisheries / ecology.
  4. If a heatwave is active, mitigation actions."""
        try:
            narrative = groq_client.analyse(ctx, max_tokens=600)
        except Exception as e:
            narrative = f'(LLM unavailable: {e})'

    # nearby ARGO floats (for the "in-situ validation nearby" panel)
    argo_nearby = []
    try:
        for f in get_argo().floats_on_day(date, window_days=3):
            if abs(f['lat'] - lat) < 2 and abs(f['lon'] - lon) < 2:
                argo_nearby.append(f)
        argo_nearby = argo_nearby[:20]
    except Exception:
        pass

    # persona-tailored bullets from the same context the LLM sees
    ctx_for_personas = _build_pixel_context(date, lat, lon)
    persona_bullets = one_liners(ctx_for_personas)

    payload = {
        'profile': prof,
        'surface': {'sst_C': sst, 'sst_anomaly_C': anom,
                    'heatwave_category': CATEGORY_LABELS.get(cat, 'None')},
        'argo_nearby': argo_nearby,
        'confidence': {
            'score': ctx_for_personas.get('confidence_score'),
            'label': ctx_for_personas.get('confidence_label'),
            'n_argo_points': ctx_for_personas.get('n_argo_points'),
        },
        'personas': {k: {'display': PERSONAS[k]['display'], 'bullets': v}
                     for k, v in persona_bullets.items()},
        'llm_narrative': narrative,
    }
    return JSONResponse(_json_safe(payload))
