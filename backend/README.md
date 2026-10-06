# OceanEmbed — Backend (FastAPI)

Serves the trained OceanEmbedV2 subsurface-temperature model, marine-heatwave
detection, and Groq-powered natural-language analysis. Endpoints are all under
`/api/…`; a Swagger UI is auto-generated at `/docs`.

## Layout

```
backend/
├─ app/
│  ├─ config.py        # env-driven config + constants
│  ├─ model.py         # OceanEmbedV2 architecture (mirrors training)
│  ├─ predictor.py     # loads harmonized data + preds cache
│  ├─ plotting.py      # server-side PNG heatmaps
│  ├─ heatwave.py      # MHW detector + rule-based recommendations
│  ├─ groq_client.py   # Groq LLM wrapper
│  ├─ schemas.py       # pydantic response models
│  └─ main.py          # FastAPI routes
├─ .env.example        # copy → .env, fill in
├─ requirements.txt
└─ run.py              # `python run.py` for dev
```

## Prereqs

1. Trained checkpoint at `D:/SIh/copernicus/data/checkpoints/oceanembed_v2_best.pt`
   (produced by `train_v2.py`).
2. Cached predictions at `D:/SIh/copernicus/data/eval_2025/preds_2025.npz`
   (produced by running the first four cells of `evaluate_2025.ipynb`).
3. Harmonized dataset at `D:/SIh/copernicus/data/harmonized/` (surface + target
   NetCDFs + `stats.json` + `static.npy`).

## Install

```bash
cd D:\SIh\webportal\backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# open .env — paste your Groq key from https://console.groq.com/keys
```

## Run

```bash
python run.py
```

Then open <http://localhost:8000/docs>. Every endpoint has a **Try it out** button.

## Endpoint tour

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/health` | liveness |
| `GET`  | `/api/meta` | bbox, depths, channels, date range |
| `GET`  | `/api/metrics` | per-depth RMSE / bias / corr from the cached 2025 run |
| `GET`  | `/api/heatmap/subsurface?date&depth&kind` | PNG of `pred` / `glorys` / `error` at a depth |
| `GET`  | `/api/heatmap/surface?date&channel` | PNG of any of 8 satellite input channels |
| `GET`  | `/api/heatmap/heatwave?date` | PNG marine-heatwave category map |
| `GET`  | `/api/profile?date&lat&lon` | JSON vertical profile at pixel |
| `GET`  | `/api/profile/plot?date&lat&lon` | PNG of that profile |
| `GET`  | `/api/timeseries?lat&lon&depth` | JSON year-long time series |
| `GET`  | `/api/timeseries/plot?lat&lon&depth` | PNG version |
| `GET`  | `/api/heatwave?date&llm=true` | MHW summary + rule-based recommendations + optional LLM narrative |
| `POST` | `/api/analysis` | freeform LLM analysis (send any context) |
| `GET`  | `/api/pixel_report?date&lat&lon&llm=true` | one-shot dossier: profile + MHW context + LLM commentary — this is the endpoint the frontend calls when a user clicks a map pixel |

## Novelty features

- **Marine-heatwave detector**  — climatology (2014-2024) computed per day-of-year;
  MHW category 1-4 following Hobday et al. 2016. Returns pixel map, summary
  statistics, and rule-based action recommendations for fisheries / coral / cyclone
  desks.
- **LLM narrative layer**  — Groq (default `llama-3.3-70b-versatile`) wraps the
  numeric analysis into plain-English reports on demand. Never fabricates numbers;
  refuses if the API key is missing.
- **Clickable pixel dossier**  — a single `/api/pixel_report` call returns
  everything a UI needs to render a rich popover: profile plot data, current SST /
  anomaly / heatwave category at the exact pixel, plus a paragraph of AI analysis.

## Notes

- Startup takes ~10–30 s the first time (loads xarray datasets and computes MHW
  climatology). The predictor and heatwave modules are cached module-singletons.
- All heatmap endpoints stream PNG bytes — no filesystem writes.
- CORS is wide open in dev; tighten in production by setting `allow_origins`.
- The model architecture in `app/model.py` must exactly match training. If you
  retrain with different hyperparameters, either update the defaults or add a
  small helper that reads them from `ck['args']`.
