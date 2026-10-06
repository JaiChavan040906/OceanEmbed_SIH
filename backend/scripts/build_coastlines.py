"""Extract coastline GeoJSON from the bundled static.npy land mask.

Uses marching squares (matplotlib.contour) to trace the land/ocean boundary and
saves a compact GeoJSON of MultiLineString features to data_assets/coastlines_nio.geojson.

Run once from backend/:
    python scripts/build_coastlines.py
"""
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

HERE = Path(__file__).resolve().parent.parent
STATIC = HERE / 'data_assets' / 'static.npy'
OUT    = HERE / 'data_assets' / 'coastlines_nio.geojson'

# NIO bbox (must match config)
LAT_MIN, LAT_MAX = 5.0, 30.0
LON_MIN, LON_MAX = 45.0, 105.0

def main():
    static = np.load(STATIC)          # [4, 101, 241] — channels: land, lat, lon, bathy
    land   = static[0]                # 1 = land, 0 = ocean
    ny, nx = land.shape
    lats = np.linspace(LAT_MIN, LAT_MAX, ny)
    lons = np.linspace(LON_MIN, LON_MAX, nx)

    # Marching-squares contour at land=0.5 (boundary between 0 and 1)
    lon_g, lat_g = np.meshgrid(lons, lats)
    fig, ax = plt.subplots()
    cs = ax.contour(lon_g, lat_g, land, levels=[0.5])
    features = []
    # Modern matplotlib exposes allsegs on the ContourSet
    for path_collection in cs.allsegs:
        for segment in path_collection:
            if len(segment) < 4:
                continue
            coords = [[round(float(x), 3), round(float(y), 3)] for x, y in segment]
            features.append({
                'type': 'Feature', 'properties': {},
                'geometry': {'type': 'LineString', 'coordinates': coords},
            })
    plt.close(fig)

    gj = {'type': 'FeatureCollection', 'features': features}
    OUT.write_text(json.dumps(gj, separators=(',', ':')))
    print(f'wrote {OUT}  ({len(features)} line features, {OUT.stat().st_size/1024:.1f} KB)')


if __name__ == '__main__':
    main()
