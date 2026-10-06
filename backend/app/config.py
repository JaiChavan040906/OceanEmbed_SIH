"""Global config — every runtime path is env-driven, with sensible defaults
that point at files bundled inside ``backend/data_assets/``.

Override any path in ``backend/.env`` (e.g. to point at a shared network
drive). Nothing here should reach outside the backend/ tree by default.
"""
from pathlib import Path
import numpy as np
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR   = Path(__file__).resolve().parent.parent
_MODEL_ASSETS = BACKEND_DIR / 'model_assets'
_DATA_ASSETS  = BACKEND_DIR / 'data_assets'


def _default_ckpt() -> Path:
    """Prefer v3 if it exists in model_assets, else fall back to v2."""
    v3 = _MODEL_ASSETS / 'oceanembed_v3_best.pt'
    v2 = _MODEL_ASSETS / 'oceanembed_v2_best.pt'
    if v3.exists():
        return v3
    if v2.exists():
        return v2
    return v3   # so the missing-file error message points at the intended path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    # ─────────────── model checkpoint (drop the .pt into backend/model_assets/)
    checkpoint_path: Path = _default_ckpt()

    # ─────────────── bundled data assets (all under backend/data_assets/)
    # Cached per-day predictions for the test year — produced by evaluate_v3.ipynb.
    preds_cache:      Path = _DATA_ASSETS / 'preds_v3.npz'
    # Normalisation stats + static channels used by every model call.
    stats_path:       Path = _DATA_ASSETS / 'stats.json'
    static_path:      Path = _DATA_ASSETS / 'static.npy'
    # Surface + target NetCDFs for the test year (used for heatmaps + GLORYS truth).
    surface_test_nc:  Path = _DATA_ASSETS / 'surface_2025.nc'
    target_test_nc:   Path = _DATA_ASSETS / 'target_2025.nc'
    # Precomputed per-DOY SST climatology + p90 (heatwave module).
    climatology_nc:   Path = _DATA_ASSETS / 'climatology.nc'
    # ARGO ground truth (independent validation + confidence score).
    argo_test_path:   Path = _DATA_ASSETS / 'argo_test_2025.nc'
    # Coastline GeoJSON (extracted from land mask, ~19 KB).
    coastlines_path:  Path = _DATA_ASSETS / 'coastlines_nio.geojson'

    # ─────────────── region bbox (must match training)
    lon_min: float = 45.0
    lon_max: float = 105.0
    lat_min: float = 5.0
    lat_max: float = 30.0

    # ─────────────── Groq LLM
    groq_api_key: str = ''
    groq_model:   str = 'llama-3.3-70b-versatile'

    # ─────────────── server
    host: str = '0.0.0.0'
    port: int = 8000


settings = Settings()

# ─────────────── constants shared with training / evaluation
SURFACE_VARS = ['sst', 'sss', 'ssh', 'sla', 'u_cur', 'v_cur', 'u_wind', 'v_wind']
DEPTHS = np.array([0, 5, 10, 20, 30, 50, 75, 100, 125, 150,
                   200, 300, 500, 700, 1000], dtype='float32')
N_DEPTHS = len(DEPTHS)
