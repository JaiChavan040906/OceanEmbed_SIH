# OceanEmbed — Web Portal

AI-powered subsurface ocean temperature reconstruction for the North Indian
Ocean, with interactive heatmaps, marine-heatwave detection, per-persona
insights, and an LLM analyst.

```
webportal/
├── backend/     FastAPI + PyTorch — serves the trained OceanEmbedV3 model
│                (self-contained: all runtime files live under backend/data_assets/)
├── frontend/    Vite + React 19 + TypeScript — interactive dark-themed UI
└── README.md    ← you are here
```

## Quick start (two terminals)

### Terminal 1 — backend

```powershell
cd webportal\backend

# One-time setup
python -m venv .venv
.venv\Scripts\activate                  # (or `source .venv/bin/activate` on mac/linux)
pip install -r requirements.txt
copy .env.example .env                  # then paste your Groq API key into .env

# Download the model checkpoint (once):
#   see backend/model_assets/README.md for the Google Drive link
#   save as backend/model_assets/oceanembed_v3_best.pt

# Pull the bundled data (Git LFS, ~1.3 GB):
git lfs install
git lfs pull

# Run
python run.py
```

Backend serves on <http://localhost:8000> — API docs at <http://localhost:8000/docs>.

### Terminal 2 — frontend

```powershell
cd webportal\frontend

npm install
npm run dev
```

Frontend serves on <http://localhost:5173>. Vite proxies `/api/*` to the backend so no CORS setup is needed in dev.

Open the URL, and you should see the dark ocean-themed dashboard: map + left panel (heatmap controls) + right panel (metrics + persona insights) + chat drawer at bottom-right.

## Environment overrides

| File | Purpose |
|------|---------|
| `backend/.env` | Groq API key (required for `/api/chat`, `/api/analysis`, `/api/pixel_report?llm=true`); path overrides (all optional — defaults point inside `backend/data_assets/`) |
| `frontend/.env` | `VITE_API_URL` (default `http://localhost:8000`) |

Every file the backend touches at runtime lives under `backend/data_assets/` or
`backend/model_assets/`. Nothing reads from outside the `backend/` tree by
default — safe to move the project anywhere.

## Verifying the backend

```powershell
cd webportal\backend
python scripts\smoketest.py
```

Prints OK/FAIL for every file path, predictor lookup, heatwave call, ARGO
validator, and each persona's insight generator. Exits non-zero on any
failure.

## Producing production builds

```powershell
# Frontend static bundle (served by any static host / CDN)
cd webportal\frontend
npm run build
# → dist/  (index.html, /assets/*)

# Backend behind a proper ASGI server
cd webportal\backend
.venv\Scripts\activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
```

## Endpoints your frontend calls

Full API reference at `/docs` when the backend is running. High-frequency ones:

- `GET /api/health` — liveness check (the navbar green dot)
- `GET /api/today` — today → cached-prediction-date mapping
- `GET /api/meta` — bbox, depths, channels, checkpoint path
- `GET /api/metrics` — per-depth RMSE / bias / correlation
- `GET /api/heatmap/surface?date&channel` — PNG heatmap of any of 8 satellite channels
- `GET /api/heatmap/subsurface?date&depth&kind` — pred / GLORYS / error at any depth
- `GET /api/heatmap/heatwave?date` — marine-heatwave category map
- `GET /api/profile?date&lat&lon` — clicked-pixel depth profile
- `GET /api/timeseries?lat&lon&depth` — full year time series
- `GET /api/heatwave?date&llm=true` — MHW summary + LLM narrative
- `GET /api/argo/floats?date&window_days=3` — nearby ARGO buoys
- `GET /api/argo/validate?date&window_days=3` — confidence score (0-100) + per-depth metrics
- `GET /api/insights?date&lat&lon&persona=all` — per-persona bullet lists
- `POST /api/chat` — context-aware LLM chat
- `GET /api/pixel_report?date&lat&lon&llm=true` — one-shot dossier (profile + heatwave + ARGO + personas + LLM)

All accept `date=today` or `date=latest` as aliases.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `predictions cache not loaded` on subsurface endpoints | Missing `data_assets/preds_v3.npz` — run `evaluate_v3.ipynb` and copy the file |
| `checkpoint file not found` | Drop `oceanembed_v3_best.pt` from Drive into `backend/model_assets/` |
| `ARGO file not found` | `git lfs pull` (files stored with Git LFS) |
| Frontend shows blank map / API errors | Verify backend is running on 8000 (`curl http://localhost:8000/api/health`) |
| CORS errors in browser console | Use the Vite dev proxy (already configured) or set `CHECKPOINT_PATH` etc. in backend `.env` |
