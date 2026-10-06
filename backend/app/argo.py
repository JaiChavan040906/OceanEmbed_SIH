"""ARGO validation + confidence-score module.

Loads the raw ARGO 2025 test file once at startup, applies QC + bbox filter,
and serves per-date validation against the model's predictions:
    * ARGO float positions for a date (for the map layer)
    * Individual profile data (real T vs pressure per float)
    * Per-depth RMSE / bias / correlation for that date's ±window
    * A single 0-100 "confidence score" summarising model vs ARGO agreement
      + a natural-language label (Excellent / Good / Fair / Poor)
"""
from __future__ import annotations
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr
from scipy.interpolate import RegularGridInterpolator

from .config import settings, DEPTHS, N_DEPTHS


# Expected RMSE ceiling per depth (°C) — used to convert error → 0..1 agreement.
# Thermocline (75-200 m) is inherently noisier so it gets a higher ceiling.
_CEILING = np.array([1.0, 1.0, 1.0, 1.2, 1.4, 1.6, 2.0, 2.2, 2.2, 2.0,
                     1.6, 1.4, 1.0, 1.0, 1.0], dtype='float32')


class ArgoValidator:
    """One-time loader + per-date validator.

    Reads the ARGO 2025 test file that ships with the backend under
    ``backend/data_assets/argo_test_2025.nc`` (path configurable via
    ``ARGO_TEST_PATH`` in ``.env``).
    """

    def __init__(self, argo_nc: Path | None = None):
        path = argo_nc or settings.argo_test_path
        if not path.exists():
            raise FileNotFoundError(
                f'ARGO file not found: {path}\n'
                f'Expected to ship in backend/data_assets/. '
                f'Copy from your data dir or set ARGO_TEST_PATH in backend/.env.')
        print(f'[argo] loading {path}')
        ds = xr.open_dataset(path)
        lat  = ds['LATITUDE'].values.astype('float64')
        lon  = ds['LONGITUDE'].values.astype('float64')
        time = pd.to_datetime(ds['TIME'].values)
        pres = ds['PRES'].values.astype('float32')
        temp = ds['TEMP'].values.astype('float32')
        pqc  = np.asarray(ds['POSITION_QC'].values).astype(str)
        tqc  = np.asarray(ds['TEMP_QC'].values).astype(str)
        presqc = np.asarray(ds['PRES_QC'].values).astype(str)
        platform = np.asarray(ds['PLATFORM_NUMBER'].values).astype(str)
        cycle    = np.asarray(ds['CYCLE_NUMBER'].values)
        ds.close()

        good = (np.isin(pqc,     ['1', '2']) &
                np.isin(tqc,     ['1', '2']) &
                np.isin(presqc,  ['1', '2']) &
                np.isfinite(temp) & np.isfinite(pres) &
                (lat >= settings.lat_min) & (lat <= settings.lat_max) &
                (lon >= settings.lon_min) & (lon <= settings.lon_max) &
                (pres >= 0) & (pres <= 1200))
        self.lat  = lat[good]
        self.lon  = lon[good]
        self.time = time[good]
        self.pres = pres[good]
        self.temp = temp[good]
        self.platform = platform[good]
        self.cycle    = cycle[good]
        # unique profiles = (platform, cycle) pairs
        self.profile_key = np.array([f'{p}_{c}' for p, c in zip(self.platform, self.cycle)])
        print(f'[argo] {len(self.lat):,} QC-passed measurements '
              f'({len(np.unique(self.profile_key)):,} unique profiles)  '
              f'across {self.time.min().date()} -> {self.time.max().date()}')

    # ─────────────────────────────── discovery
    def floats_on_day(self, date: str, window_days: int = 3) -> list[dict]:
        """Return unique float positions within ±window_days of the given date.

        Each entry: { platform, cycle, lat, lon, time, n_levels, max_pressure_dbar }.
        """
        t = pd.Timestamp(date)
        dt = (self.time - t).total_seconds() / 86400.0
        near = np.abs(dt) <= window_days
        keys = self.profile_key[near]
        _, uniq_idx = np.unique(keys, return_index=True)
        idx_where = np.where(near)[0][uniq_idx]
        out = []
        for i in idx_where:
            same = (self.profile_key == self.profile_key[i])
            out.append({
                'platform': str(self.platform[i]),
                'cycle': int(self.cycle[i]) if np.issubdtype(self.cycle.dtype, np.number) else str(self.cycle[i]),
                'lat': float(self.lat[i]),
                'lon': float(self.lon[i]),
                'time': pd.Timestamp(self.time[i]).isoformat(),
                'n_levels': int(same.sum()),
                'max_pressure_dbar': float(self.pres[same].max()),
            })
        return out

    def profile(self, platform: str, cycle: int | None = None) -> dict:
        """Return one ARGO profile (all its depth samples)."""
        mask = (self.platform == platform)
        if cycle is not None:
            mask = mask & (self.cycle.astype(str) == str(cycle))
        if not mask.any():
            return {'platform': platform, 'cycle': cycle, 'pressures_dbar': [], 'temperatures_C': []}
        idx = np.where(mask)[0]
        order = np.argsort(self.pres[idx])
        idx = idx[order]
        return {
            'platform': platform,
            'cycle': int(self.cycle[idx[0]]) if np.issubdtype(self.cycle.dtype, np.number) else str(self.cycle[idx[0]]),
            'lat': float(self.lat[idx[0]]),
            'lon': float(self.lon[idx[0]]),
            'time': pd.Timestamp(self.time[idx[0]]).isoformat(),
            'pressures_dbar': self.pres[idx].tolist(),
            'temperatures_C': self.temp[idx].tolist(),
        }

    # ─────────────────────────────── validation
    def validate_day(self, predictor, date: str, window_days: int = 3) -> dict:
        """Compare cached model predictions to real ARGO points within ±window_days.

        Returns per-depth stats + a single 0-100 confidence score.
        """
        if predictor.cache is None:
            raise RuntimeError('predictor has no cache — run evaluate_2025.ipynb first')

        centre = pd.Timestamp(date)
        dt = (self.time - centre).total_seconds() / 86400.0
        near = np.abs(dt) <= window_days
        if near.sum() < 20:
            return {
                'date': date, 'window_days': window_days,
                'n_argo_points': int(near.sum()),
                'confidence_score': None, 'confidence_label': 'INSUFFICIENT_DATA',
                'summary': f'Only {int(near.sum())} ARGO measurements within ±{window_days} d — cannot score.',
                'per_depth': [], 'scatter': {'argo': [], 'model': []},
            }

        a_lat  = self.lat[near];  a_lon = self.lon[near]
        a_time = self.time[near]; a_pres = self.pres[near]; a_temp = self.temp[near]

        # for each ARGO point, find nearest cached-prediction day
        t_cache = predictor.cache['times']
        day_idx = np.array([int(np.argmin(np.abs(t_cache - t))) for t in a_time])

        model = np.full(len(a_lat), np.nan, dtype='float32')
        for d in np.unique(day_idx):
            sel  = np.where(day_idx == d)[0]
            cube = predictor.cache['pred'][d]           # [D, H, W] °C
            itp  = RegularGridInterpolator(
                (DEPTHS.astype('float64'),
                 predictor.lat.astype('float64'),
                 predictor.lon.astype('float64')),
                cube.astype('float64'), method='linear',
                bounds_error=False, fill_value=np.nan)
            pts = np.stack([np.clip(a_pres[sel], DEPTHS[0], DEPTHS[-1]),
                            a_lat[sel], a_lon[sel]], axis=1)
            model[sel] = itp(pts).astype('float32')

        keep = np.isfinite(model) & np.isfinite(a_temp)
        model, a_temp_k, a_pres_k = model[keep], a_temp[keep], a_pres[keep]

        # per-depth bin metrics
        bin_edges = np.concatenate([[0], (DEPTHS[:-1] + DEPTHS[1:]) / 2, [1e6]])
        assign = np.clip(np.digitize(a_pres_k, bin_edges) - 1, 0, N_DEPTHS - 1)
        per_depth = []
        agreements = []                 # 0..1 per depth
        weights    = []                 # count per depth
        for d in range(N_DEPTHS):
            idx = assign == d
            if idx.sum() < 5:
                per_depth.append(dict(depth_m=int(DEPTHS[d]), rmse=None, bias=None, corr=None, n=int(idx.sum())))
                continue
            p = model[idx]; t = a_temp_k[idx]
            err  = p - t
            rmse = float(np.sqrt(np.mean(err ** 2)))
            bias = float(np.mean(err))
            corr = float(np.corrcoef(p, t)[0, 1]) if idx.sum() > 2 else None
            per_depth.append(dict(depth_m=int(DEPTHS[d]), rmse=rmse, bias=bias, corr=corr, n=int(idx.sum())))
            agree = max(0.0, 1.0 - rmse / _CEILING[d])
            agreements.append(agree); weights.append(idx.sum())

        # weighted confidence 0..100
        if agreements:
            w = np.array(weights, dtype='float32')
            a = np.array(agreements, dtype='float32')
            score = float(100.0 * (a * w).sum() / max(w.sum(), 1))
        else:
            score = None

        label = _label(score)
        # subsample scatter for plotting
        n_scatter = min(2000, len(model))
        rng = np.random.default_rng(0)
        pick = rng.choice(len(model), n_scatter, replace=False)

        return {
            'date': date, 'window_days': window_days,
            'n_argo_points': int(keep.sum()),
            'confidence_score': None if score is None else round(score, 1),
            'confidence_label': label,
            'summary': _summary(score, label, per_depth, int(keep.sum())),
            'per_depth': per_depth,
            'scatter': {
                'argo':  a_temp_k[pick].tolist(),
                'model': model[pick].tolist(),
                'pressure_dbar': a_pres_k[pick].tolist(),
            },
        }


# ─────────────────────────────── label + narrative helpers
def _label(score: float | None) -> str:
    if score is None:      return 'INSUFFICIENT_DATA'
    if score >= 85:        return 'EXCELLENT'
    if score >= 70:        return 'GOOD'
    if score >= 55:        return 'FAIR'
    if score >= 40:        return 'MARGINAL'
    return 'POOR'


def _summary(score, label, per_depth, n_pts):
    if score is None:
        return 'Not enough ARGO data near this date to compute a confidence score.'
    worst = None
    for r in per_depth:
        if r['rmse'] is None: continue
        if worst is None or r['rmse'] > worst['rmse']:
            worst = r
    txt = (f'Confidence {score:.1f}/100 ({label}), based on {n_pts:,} ARGO measurements. ')
    if worst:
        txt += (f'Worst-performing layer: {worst["depth_m"]} m '
                f'(RMSE {worst["rmse"]:.2f} °C, bias {worst["bias"]:+.2f} °C).')
    return txt


# module-singleton
_validator: ArgoValidator | None = None

def get_validator() -> ArgoValidator:
    global _validator
    if _validator is None:
        _validator = ArgoValidator()
    return _validator
