"""Marine heatwave (MHW) detector — loads the precomputed climatology from
``backend/data_assets/climatology.nc`` (produced by
``scripts/precompute_climatology.py``).

Definition (Hobday et al. 2016, simplified):
  A pixel is in a marine heatwave when its SST exceeds the 90th percentile of
  the climatology (all train years, same day-of-year). Category:
    I   Moderate  : SST > 1× (P90 - climatological mean)
    II  Strong    : SST > 2×
    III Severe    : SST > 3×
    IV  Extreme   : SST > 4×
"""
from __future__ import annotations
import numpy as np
import pandas as pd
import xarray as xr

from .config import settings


CATEGORY_LABELS = {1: 'Moderate', 2: 'Strong', 3: 'Severe', 4: 'Extreme'}


def _category(delta: np.ndarray, threshold_range: np.ndarray) -> np.ndarray:
    out = np.zeros_like(delta, dtype='int8')
    with np.errstate(invalid='ignore'):
        exceed = delta / np.where(threshold_range > 0.01, threshold_range, np.nan)
    for lo, cat in [(4, 4), (3, 3), (2, 2), (1, 1)]:
        out = np.where(np.isfinite(exceed) & (exceed >= lo) & (out == 0), cat, out)
    return out


class HeatwaveDetector:
    """Uses precomputed per-DOY SST climatology + p90; no big data reads at startup."""

    def __init__(self):
        # Precomputed climatology bundled in data_assets/
        if not settings.climatology_nc.exists():
            raise FileNotFoundError(
                f'{settings.climatology_nc} not found. '
                f'Run  `python scripts/precompute_climatology.py` to generate it.')
        clim = xr.open_dataset(settings.climatology_nc)
        self.clim_mean = clim['sst_clim_mean'].load()   # dims: (doy, lat, lon)
        self.clim_p90  = clim['sst_clim_p90'].load()
        clim.close()

        # For same-date SST lookup, use the test-year surface file
        surf = xr.open_dataset(settings.surface_test_nc).squeeze(drop=True)
        self.surf_sst = surf['sst'].load()
        self.lat = surf.lat.values
        self.lon = surf.lon.values
        surf.close()

        print(f'[heatwave] climatology ready -- {self.clim_mean.shape}   '
              f'test-year SST loaded ({len(self.surf_sst.time)} days)')

    def detect(self, date: str) -> dict:
        t   = pd.to_datetime(date)
        doy = int(min(t.dayofyear, 365))
        sst = self.surf_sst.sel(time=t, method='nearest').values.astype('float32')

        # doy is 1-based; the climatology axis uses the same convention
        clim = self.clim_mean.sel(doy=doy).values.astype('float32') \
               if 'doy' in self.clim_mean.dims else \
               self.clim_mean.isel(doy=doy - 1).values.astype('float32')
        p90  = self.clim_p90.sel(doy=doy).values.astype('float32') \
               if 'doy' in self.clim_p90.dims else \
               self.clim_p90.isel(doy=doy - 1).values.astype('float32')

        anomaly         = sst - clim
        threshold_range = p90 - clim
        cat_map         = _category(anomaly, threshold_range)
        cat_map         = np.where(np.isfinite(sst), cat_map, 0)

        valid  = np.isfinite(sst)
        in_mhw = cat_map > 0
        area_pct = float(100 * in_mhw.sum() / max(valid.sum(), 1))
        summary = dict(
            date=date, area_percent_in_mhw=round(area_pct, 2),
            max_anomaly_C =float(np.nanmax(anomaly)) if valid.any() else None,
            mean_anomaly_C=float(np.nanmean(anomaly)) if valid.any() else None,
            categories={CATEGORY_LABELS[k]: int((cat_map == k).sum()) for k in (1, 2, 3, 4)},
            recommendations=recommend_actions(
                area_pct,
                float(np.nanmax(anomaly)) if valid.any() else 0.0,
                cat_map),
        )
        return dict(category_map=cat_map, sst=sst, anomaly=anomaly,
                    threshold=p90, summary=summary)


def recommend_actions(area_pct: float, max_anomaly: float, cat_map: np.ndarray) -> list[str]:
    recs = []
    max_cat = int(cat_map.max()) if cat_map.size else 0
    if area_pct < 1 and max_cat == 0:
        recs.append('Ocean state is normal for this date. No marine-heatwave action needed. Continue routine monitoring.')
        return recs
    if max_cat >= 3:
        recs.append('SEVERE / EXTREME marine heatwave in the region. Issue alerts to coastal states (India, Sri Lanka, Bangladesh, Oman).')
        recs.append('Coral reef managers (Lakshadweep, Andaman & Nicobar): activate bleaching-watch protocols.')
        recs.append('Fisheries departments: expect species distribution shifts; recommend catch-effort surveys within 2 weeks.')
    elif max_cat == 2:
        recs.append('STRONG marine heatwave detected. Increase SST monitoring frequency to daily.')
        recs.append('Aquaculture operators: monitor stock for thermal stress; prepare emergency cooling / harvest plans.')
    elif max_cat == 1:
        recs.append('MODERATE marine heatwave — early-warning stage. Track evolution over next 5-10 days.')
    if area_pct > 20:
        recs.append(f'Large affected area ({area_pct:.0f}% of basin). Trigger cross-agency coordination: IMD, INCOIS, MoES, coastal state DMAs.')
    if max_anomaly > 3.0:
        recs.append(f'Peak SST anomaly ~ +{max_anomaly:.1f} °C above climatology — historically associated with coral bleaching, jellyfish blooms, and reduced fish catch.')
    if 6 <= pd.Timestamp.now().month <= 9:
        recs.append('Southwest-monsoon season: heatwaves modulate cyclogenesis in the Arabian Sea and Bay of Bengal. Coordinate with IMD cyclone forecast desk.')
    return recs
