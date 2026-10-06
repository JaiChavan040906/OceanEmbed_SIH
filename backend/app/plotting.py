"""Server-side heatmap and line-plot renderers → returns PNG bytes."""
import io
import numpy as np
import matplotlib
matplotlib.use('Agg')                   # no GUI needed on server
import matplotlib.pyplot as plt


CMAPS = {
    'temperature': 'turbo',
    'error':       'RdBu_r',
    'anomaly':     'RdBu_r',
    'sst':         'turbo',
    'sss':         'viridis',
    'ssh':         'viridis',
    'sla':         'RdBu_r',
    'u_cur':       'RdBu_r', 'v_cur': 'RdBu_r',
    'u_wind':      'RdBu_r', 'v_wind': 'RdBu_r',
    'heatwave':    'Reds',
}


def heatmap_png(arr: np.ndarray, lon: np.ndarray, lat: np.ndarray,
                title: str, cbar_label: str, cmap: str = 'turbo',
                vmin: float | None = None, vmax: float | None = None,
                figsize=(10, 5)) -> bytes:
    """Return a PNG (bytes) heatmap of arr[lat, lon]."""
    fig, ax = plt.subplots(figsize=figsize, constrained_layout=True)
    im = ax.pcolormesh(lon, lat, arr, shading='auto', cmap=cmap, vmin=vmin, vmax=vmax)
    ax.set_xlabel('Longitude (°E)'); ax.set_ylabel('Latitude (°N)')
    ax.set_title(title)
    plt.colorbar(im, ax=ax, label=cbar_label, shrink=0.85)
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=110, bbox_inches='tight')
    plt.close(fig)
    return buf.getvalue()


def profile_png(depths: np.ndarray, pred: np.ndarray, target: np.ndarray,
                title: str) -> bytes:
    fig, ax = plt.subplots(figsize=(5, 7), constrained_layout=True)
    ax.plot(pred,   depths, 'o-', label='Model', color='steelblue')
    ax.plot(target, depths, 's--', label='GLORYS', color='darkorange')
    ax.invert_yaxis()
    ax.set_xlabel('Temperature (°C)'); ax.set_ylabel('Depth (m)')
    ax.set_title(title); ax.legend(); ax.grid(alpha=0.3)
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=110, bbox_inches='tight')
    plt.close(fig)
    return buf.getvalue()


def timeseries_png(dates, pred, target, title: str) -> bytes:
    fig, ax = plt.subplots(figsize=(12, 4), constrained_layout=True)
    ax.plot(dates, pred,   label='Model',  color='steelblue', lw=1)
    ax.plot(dates, target, label='GLORYS', color='darkorange', lw=1, alpha=0.8)
    ax.set_ylabel('Temperature (°C)'); ax.set_title(title)
    ax.legend(); ax.grid(alpha=0.3)
    fig.autofmt_xdate()
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=110, bbox_inches='tight')
    plt.close(fig)
    return buf.getvalue()
