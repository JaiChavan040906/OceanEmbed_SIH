"""Precompute the per-day-of-year SST climatology + p90 from the train years,
and save as a single compact NetCDF that ships with the backend.

Run this ONCE against the training data, then commit the output file
(`backend/data_assets/climatology.nc`, ~40 MB) alongside the code.

Usage (from backend/):
    python scripts/precompute_climatology.py \\
        --train-dir D:/SIh/copernicus/data/harmonized/train \\
        --out       data_assets/climatology.nc
"""
import argparse
from pathlib import Path
import numpy as np
import xarray as xr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--train-dir', required=True,
                    help='Directory containing surface_YYYY.nc files (harmonized train split).')
    ap.add_argument('--out', required=True,
                    help='Output NetCDF path.')
    args = ap.parse_args()

    src = Path(args.train_dir)
    files = sorted(src.glob('surface_*.nc'))
    if not files:
        raise SystemExit(f'no surface_*.nc under {src}')
    print(f'reading {len(files)} yearly files ...')
    ds = xr.open_mfdataset(files, combine='nested', concat_dim='time'
                            ).sortby('time').squeeze(drop=True)
    sst = ds['sst']
    print(f'shape={sst.shape}   {sst.time.min().values} -> {sst.time.max().values}')

    doy = sst['time'].dt.dayofyear
    grp = sst.groupby(doy)
    print('computing per-DOY mean …')
    mean = grp.mean(dim='time').rename({'dayofyear': 'doy'}).astype('float32')
    print('computing per-DOY p90 …')
    p90  = grp.quantile(0.90, dim='time').rename({'dayofyear': 'doy'}).astype('float32')

    out = xr.Dataset({'sst_clim_mean': mean, 'sst_clim_p90': p90})
    out.attrs['source_years'] = ', '.join(sorted(set(str(f.name).split('_')[1].split('.')[0] for f in files)))
    out.attrs['created_by']   = 'precompute_climatology.py'

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    enc = {v: {'zlib': True, 'complevel': 4, 'dtype': 'float32',
               '_FillValue': np.float32(np.nan)} for v in out.data_vars}
    out.to_netcdf(args.out, encoding=enc)
    size_mb = Path(args.out).stat().st_size / 1024**2
    print(f'wrote {args.out}  ({size_mb:.1f} MB)')


if __name__ == '__main__':
    main()
