"""Predictor — loads bundled test-year data + cached predictions once at startup.

Every path comes from `settings` (env-driven), which defaults to files under
``backend/data_assets/``. Nothing here reads from outside the backend tree.
"""
from __future__ import annotations
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr
from scipy.interpolate import PchipInterpolator

from .config import settings, SURFACE_VARS, DEPTHS, N_DEPTHS


class Predictor:
    """Serves surface + subsurface fields for the test year (2025).

    Runtime files required:
      * settings.stats_path        (stats.json)         — per-channel μ/σ
      * settings.static_path       (static.npy)         — [4, H, W] static channels
      * settings.surface_test_nc   (surface_2025.nc)    — 8-channel daily inputs
      * settings.target_test_nc    (target_2025.nc)     — GLORYS T (for ground-truth comparison)
      * settings.preds_cache       (preds_v3.npz)       — model predictions [T, D, H, W]
    """

    def __init__(self):
        # normalisation stats + static geographic channels
        if not settings.stats_path.exists():
            raise FileNotFoundError(f'{settings.stats_path} not found — add stats.json to data_assets/')
        if not settings.static_path.exists():
            raise FileNotFoundError(f'{settings.static_path} not found — add static.npy to data_assets/')
        self.stats  = json.loads(settings.stats_path.read_text())
        self.static = np.load(settings.static_path)

        # surface + target for the test year (only file we actually need at runtime)
        if not settings.surface_test_nc.exists():
            raise FileNotFoundError(f'{settings.surface_test_nc} not found — add surface_2025.nc to data_assets/')
        self.surf = xr.open_dataset(settings.surface_test_nc).squeeze(drop=True)
        self.tgt  = xr.open_dataset(settings.target_test_nc) if settings.target_test_nc.exists() else None

        self.lat = self.surf.lat.values.astype('float32')
        self.lon = self.surf.lon.values.astype('float32')

        # cached predictions
        self.cache = None
        if settings.preds_cache.exists():
            print(f'[predictor] loading cached predictions: {settings.preds_cache}')
            d = np.load(settings.preds_cache, allow_pickle=True)
            self.cache = {
                'pred'  : d['pred'].astype('float32'),
                'target': d['target'].astype('float32'),
                'mask'  : d['mask'].astype(bool),
                'times' : pd.to_datetime(d['times']),
            }
            print(f'[predictor] cache: {self.cache["pred"].shape}   '
                  f'range {self.cache["times"][0].date()} -> {self.cache["times"][-1].date()}')
        else:
            print(f'[predictor] no preds cache at {settings.preds_cache} — '
                  '/api/heatmap/subsurface, /api/profile, /api/timeseries will 503.')

    # ─────────────────────────────── discovery
    def available_dates(self):
        if self.cache is None: return []
        return [t.strftime('%Y-%m-%d') for t in self.cache['times']]

    def available_depths(self):
        return DEPTHS.astype(int).tolist()

    def available_surface_channels(self):
        return SURFACE_VARS

    def bbox(self):
        return dict(lon_min=float(self.lon.min()), lon_max=float(self.lon.max()),
                    lat_min=float(self.lat.min()), lat_max=float(self.lat.max()),
                    n_lat=len(self.lat), n_lon=len(self.lon))

    # ─────────────────────────────── "today" resolver
    def resolve_today(self) -> dict:
        """Map real calendar date to the closest cached prediction date.

        Cache lives for the test year (2025). If today is in-range, use it
        directly; otherwise map to the same day-of-year in the cache."""
        today = pd.Timestamp.now(tz='UTC').tz_localize(None).normalize()
        if self.cache is None:
            return {'today': str(today.date()), 'mapped_date': None, 'strategy': 'no_cache'}
        t_cache = self.cache['times']
        t_min, t_max = t_cache[0], t_cache[-1]
        if t_min <= today <= t_max:
            i = int(np.argmin(np.abs(t_cache - today)))
            return {'today': str(today.date()),
                    'mapped_date': str(t_cache[i].date()),
                    'strategy': 'direct',
                    'reason': 'today is inside the cached prediction range'}
        doy_today = today.dayofyear
        cache_doy = pd.DatetimeIndex(t_cache).dayofyear.values
        i = int(np.argmin(np.abs(cache_doy - doy_today)))
        return {'today': str(today.date()),
                'mapped_date': str(t_cache[i].date()),
                'strategy': 'day_of_year',
                'reason': f'cache covers {t_min.date()}..{t_max.date()}; '
                          f'mapped to same day-of-year (DOY {doy_today}).'}

    # ─────────────────────────────── lookups
    def _date_index(self, date: str) -> int:
        t = pd.to_datetime(date)
        return int(np.argmin(np.abs(self.cache['times'] - t)))

    def get_subsurface(self, date: str, depth: int):
        if self.cache is None:
            raise RuntimeError('no predictions cache loaded')
        di = int(np.argmin(np.abs(DEPTHS - depth)))
        ti = self._date_index(date)
        pred   = self.cache['pred'][ti, di]
        target = self.cache['target'][ti, di]
        mask   = self.cache['mask'][ti]
        pred   = np.where(mask, pred, np.nan)
        target = np.where(mask, target, np.nan)
        meta = dict(date=str(self.cache['times'][ti].date()), depth_m=int(DEPTHS[di]))
        return pred, target, meta

    def get_surface(self, date: str, channel: str):
        if channel not in SURFACE_VARS:
            raise ValueError(f'unknown channel {channel}; expected one of {SURFACE_VARS}')
        t = pd.to_datetime(date)
        arr = self.surf[channel].sel(time=t, method='nearest').values.astype('float32')
        meta = dict(date=str(pd.Timestamp(self.surf.time.sel(time=t, method='nearest').values).date()),
                    channel=channel, units=self._units(channel))
        return arr, meta

    def get_profile(self, date: str, lat: float, lon: float) -> dict:
        iy = int(np.argmin(np.abs(self.lat - lat)))
        ix = int(np.argmin(np.abs(self.lon - lon)))
        ti = self._date_index(date)
        pred   = self.cache['pred'  ][ti, :, iy, ix].tolist()
        target = self.cache['target'][ti, :, iy, ix].tolist()
        return dict(date=str(self.cache['times'][ti].date()),
                    lat=float(self.lat[iy]), lon=float(self.lon[ix]),
                    depths_m=DEPTHS.astype(int).tolist(),
                    predicted_C=pred, glorys_C=target,
                    error_C=[p - g for p, g in zip(pred, target)])

    def get_profile_at_depths(self, date: str, lat: float, lon: float,
                              depths: list[float]) -> dict:
        """Arbitrary-depth query. Uses PCHIP (monotonicity-preserving cubic Hermite)
        along the depth axis so the interpolant never invents a warm layer below a
        cooler one — matches v3's monotonicity loss.

        `depths` may be any values in [0, 1000] m; out-of-range requests are clipped
        and flagged. Returns interpolated model temperature, GLORYS temperature, and
        their difference at each requested depth.
        """
        if self.cache is None:
            raise RuntimeError('no predictions cache loaded')
        if not depths:
            raise ValueError('depths list is empty')

        iy = int(np.argmin(np.abs(self.lat - lat)))
        ix = int(np.argmin(np.abs(self.lon - lon)))
        ti = self._date_index(date)

        std_depths = DEPTHS.astype('float64')
        pred_std   = self.cache['pred'  ][ti, :, iy, ix].astype('float64')
        tgt_std    = self.cache['target'][ti, :, iy, ix].astype('float64')

        # NaN-safe: build interpolant only on finite standard-depth samples.
        finite = np.isfinite(pred_std) & np.isfinite(tgt_std)
        pred_at, tgt_at, flags = [], [], []
        d_min, d_max = float(std_depths.min()), float(std_depths.max())

        if finite.sum() < 2:
            # not enough support (land pixel or fully-masked profile)
            for _ in depths:
                pred_at.append(None); tgt_at.append(None); flags.append('no_data')
        else:
            d_ok  = std_depths[finite]
            p_ok  = pred_std[finite]
            t_ok  = tgt_std[finite]
            f_pred = PchipInterpolator(d_ok, p_ok, extrapolate=False)
            f_tgt  = PchipInterpolator(d_ok, t_ok, extrapolate=False)
            d_lo, d_hi = float(d_ok.min()), float(d_ok.max())
            for z_raw in depths:
                z = float(z_raw)
                if z < d_min or z > d_max:
                    pred_at.append(None); tgt_at.append(None); flags.append('out_of_range')
                    continue
                if z < d_lo or z > d_hi:
                    pred_at.append(None); tgt_at.append(None); flags.append('outside_support')
                    continue
                pv = float(f_pred(z)); tv = float(f_tgt(z))
                pred_at.append(pv); tgt_at.append(tv); flags.append('ok')

        err = [(p - t) if (p is not None and t is not None) else None
               for p, t in zip(pred_at, tgt_at)]

        return dict(date=str(self.cache['times'][ti].date()),
                    lat=float(self.lat[iy]), lon=float(self.lon[ix]),
                    method='pchip',
                    standard_depths_m=DEPTHS.astype(int).tolist(),
                    query_depths_m=[float(z) for z in depths],
                    predicted_C=pred_at, glorys_C=tgt_at, error_C=err,
                    flags=flags,
                    valid_depth_range_m=[d_min, d_max])

    def get_timeseries(self, lat: float, lon: float, depth: int) -> dict:
        iy = int(np.argmin(np.abs(self.lat - lat)))
        ix = int(np.argmin(np.abs(self.lon - lon)))
        di = int(np.argmin(np.abs(DEPTHS - depth)))
        pred   = self.cache['pred'  ][:, di, iy, ix].tolist()
        target = self.cache['target'][:, di, iy, ix].tolist()
        return dict(lat=float(self.lat[iy]), lon=float(self.lon[ix]), depth_m=int(DEPTHS[di]),
                    dates=[t.strftime('%Y-%m-%d') for t in self.cache['times']],
                    predicted_C=pred, glorys_C=target)

    def metrics(self) -> dict:
        p = self.cache['pred']; t = self.cache['target']; m = self.cache['mask']
        rows = []
        for d in range(N_DEPTHS):
            mm = m
            pi = p[:, d][mm]; ti = t[:, d][mm]
            keep = np.isfinite(pi) & np.isfinite(ti)
            if keep.sum() < 100:
                rows.append(dict(depth_m=int(DEPTHS[d]), rmse=None, bias=None, corr=None, n=int(keep.sum())))
                continue
            pi, ti = pi[keep], ti[keep]
            err = pi - ti
            rows.append(dict(depth_m=int(DEPTHS[d]),
                             rmse=float(np.sqrt(np.mean(err**2))),
                             bias=float(np.mean(err)),
                             corr=float(np.corrcoef(pi, ti)[0, 1]),
                             n=int(len(pi))))
        mean_rmse = float(np.nanmean([r['rmse'] for r in rows if r['rmse'] is not None]))
        return dict(per_depth=rows, mean_rmse_C=mean_rmse)

    @staticmethod
    def _units(channel: str) -> str:
        return {'sst': '°C', 'sss': 'PSU', 'ssh': 'm', 'sla': 'm',
                'u_cur': 'm/s', 'v_cur': 'm/s', 'u_wind': 'm/s', 'v_wind': 'm/s'}.get(channel, '')


# module-singleton — instantiated once at app startup
predictor: Predictor | None = None

def get_predictor() -> Predictor:
    global predictor
    if predictor is None:
        predictor = Predictor()
    return predictor
