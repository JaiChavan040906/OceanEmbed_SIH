# backend/model_assets/

Model checkpoints are **not** committed to the repo (too large / private).
Download them from Google Drive and drop them here.

## Required file

| File | Size | Source |
|---|---|---|
| `oceanembed_v3_best.pt` | ~380 MB | [Google Drive link — paste in `#ocean-model` channel or ask team lead] |

## Steps

1. Open the shared Drive link.
2. Download `oceanembed_v3_best.pt`.
3. Save it here, keeping the filename exactly:
   ```
   backend/model_assets/oceanembed_v3_best.pt
   ```
4. Start the backend — it auto-detects the file:
   ```bash
   cd backend
   python run.py
   ```
   Log should show `params: 33.4 M`.

## How the backend finds it

`app/config.py` looks for `oceanembed_v3_best.pt` first, then falls back to
`oceanembed_v2_best.pt` if v3 is missing. Override with `CHECKPOINT_PATH`
in `backend/.env` if you keep it elsewhere.

## Do NOT

- ❌ `git add oceanembed_v3_best.pt`  (already blocked by `.gitignore`)
- ❌ Rename the file — the auto-detector matches exact names.
