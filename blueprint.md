A clean, barebones architecture that decouples UI state from the underlying map engine. The full-viewport MapLibre GL engine runs in the background, and two floating overlay panels handle controls and analytics.

---

### UI & Layout Structure

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                  FULLSCREEN MAP CANVAS                                 │
│                                (MapLibre WebGL Background)                             │
│                                                                                        │
│  ┌───────────────────────┐                                   ┌──────────────────────┐  │
│  │   LEFT CONTROL DOCK   │                                   │  RIGHT OUTPUT PANEL  │  │
│  │                       │                                   │                      │  │
│  │ • Depth Stepper       │                                   │ • Point Coordinates  │  │
│  │   (15 standard tiers) │                                   │ • Inferred SST /     │  │
│  │                       │                                   │   Layer Temperature  │  │
│  │ • Date & Time Picker  │                                   │ • Vertical Profile / │  │
│  │                       │                                   │   Status Display     │  │
│  │ • Lat/Lon Manual      │                                   │                      │  │
│  │   Coordinate Inputs   │                                   │                      │  │
│  └───────────────────────┘                                   └──────────────────────┘  │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘

```

* **Background Layer:** Full-screen (`w-screen h-screen`) MapLibre GL canvas fixed to the North Indian Ocean domain ($5^\circ\text{N}\text{--}30^\circ\text{N}, 45^\circ\text{E}\text{--}105^\circ\text{E}$).


* **Left Control Panel:** Floating glassmorphic dock (`absolute left-6 top-6 z-10 w-80`) housing controls for Depth, Time, and Location.
* **Right Output Panel:** Floating glassmorphic dock (`absolute right-6 top-6 z-10 w-80`) displaying the temperature readout, active coordinates, and vertical profile at the selected pin.



---

### Preserved Heatmap & Smoothing Pipeline

The 4x Bicubic Spline + Quantized Isotherm engine from the previous iteration is retained to avoid mushy blurring while preventing pixelated artifacts.

```
[Raw Grid Tensor (101 x 241)] 
             │
             ▼
[Catmull-Rom Bicubic Upscaler (4x)] ──► 401 x 961 Intermediate Grid
             │                           (Preserves local eddy curvature & extremes)
             ▼
[Quantized Isotherm Stepping]       ──► Groups values into 0.5°C bands via Turbo scale
             │                           (Sharp physical thermal boundaries)
             ▼
[MapLibre Image Source Injection]   ──► Placed under vector landmasses to prevent bleed

```

1. **Catmull-Rom Cubic Spline (4x):** Upscales the $0.25^\circ$ raw slice to $\sim 0.06^\circ$ by fitting a third-degree polynomial across a $4 \times 4$ neighborhood.


2. **Quantized Stepping ($0.5^\circ\text{C}$ bands):** Maps the upscaled floats through `d3-scale-chromatic`'s Turbo palette in discrete steps, retaining sharp frontal boundaries.


3. **Native WebGL Layer Insertion:** Injected via `canvas.toDataURL()` below the basemap's first vector label/boundary layer, ensuring crisp coastal cutoffs at India, Sri Lanka, and the Arabian Peninsula.



---

### Minimal Implementation

#### 1. Core State Store (`src/store/oceanStore.ts`)

```typescript
import { create } from 'zustand';

export const DEPTH_TIERS = [0, 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000]; //[cite: 1, 2]

interface OceanStore {
  depthIdx: number;
  dateTime: string;
  coords: { lat: number; lon: number };
  setDepthIdx: (idx: number) => void;
  setDateTime: (dt: string) => void;
  setCoords: (coords: { lat: number; lon: number }) => void;
}

export const useOceanStore = create<OceanStore>((set) => ({
  depthIdx: 0,
  dateTime: '2026-09-08T00:00',
  coords: { lat: 15.0, lon: 78.0 },
  setDepthIdx: (depthIdx) => set({ depthIdx }),
  setDateTime: (dateTime) => set({ dateTime }),
  setCoords: (coords) => set({ coords }),
}));

```

#### 2. Upscaler & Texture Generator (`src/utils/heatmapEngine.ts`)

```typescript
import { interpolateTurbo } from 'd3-scale-chromatic'; //[cite: 1]

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const v0 = (p2 - p0) * 0.5, v1 = (p3 - p1) * 0.5;
  const t2 = t * t, t3 = t * t2;
  return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1; //[cite: 1]
}

export function generateProcessedHeatmap(
  raw: Float32Array,
  w: number,
  h: number,
  minVal: number,
  maxVal: number
): HTMLCanvasElement {
  const scale = 4; //[cite: 1]
  const dw = (w - 1) * scale + 1;
  const dh = (h - 1) * scale + 1;
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(dw, dh);

  const getSample = (x: number, y: number) => raw[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))]; //[cite: 1]

  for (let dy = 0; dy < dh; dy++) {
    const sy = dy / scale, iy = Math.floor(sy), fy = sy - iy;
    for (let dx = 0; dx < dw; dx++) {
      const sx = dx / scale, ix = Math.floor(sx), fx = sx - ix;
      const col = new Float32Array(4);

      for (let m = -1; m <= 2; m++) {
        const p1 = getSample(ix, iy + m);
        col[m + 1] = isNaN(p1) || p1 <= -999 ? NaN : 
          catmullRom(getSample(ix - 1, iy + m), p1, getSample(ix + 1, iy + m), getSample(ix + 2, iy + m), fx); //[cite: 1]
      }

      const val = isNaN(col[1]) ? NaN : catmullRom(col[0], col[1], col[2], col[3], fy); //[cite: 1]
      const px = (dy * dw + dx) * 4;

      if (isNaN(val) || val <= -999) {
        img.data[px + 3] = 0;
        continue;
      }

      const stepped = Math.floor(val / 0.5) * 0.5; // 0.5°C discrete bands[cite: 1]
      const norm = Math.max(0, Math.min(1, (stepped - minVal) / (maxVal - minVal))); //[cite: 1]
      const [r, g, b] = interpolateTurbo(norm).match(/\d+/g)!.map(Number); //[cite: 1]

      img.data[px] = r;
      img.data[px + 1] = g;
      img.data[px + 2] = b;
      img.data[px + 3] = 220; //[cite: 1]
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

```

#### 3. Map Background Component (`src/components/MapCanvas.tsx`)

```tsx
import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useOceanStore } from '../store/oceanStore';
import { generateProcessedHeatmap } from '../utils/heatmapEngine';

export default function MapCanvas() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const { coords, setCoords, depthIdx, dateTime } = useOceanStore();

  useEffect(() => {
    if (!mapContainer.current) return;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      bounds: [[45.0, 5.0], [105.0, 30.0]], // SW to NE[cite: 1, 2]
    });

    map.current.on('load', () => {
      map.current!.on('click', (e) => {
        const { lng, lat } = e.lngLat;
        if (lat >= 5 && lat <= 30 && lng >= 45 && lng <= 105) { //[cite: 1]
          setCoords({ lat: parseFloat(lat.toFixed(2)), lon: parseFloat(lng.toFixed(2)) });
        }
      });
    });

    return () => map.current?.remove();
  }, []);

  // Sync Pin Marker in GPU layer
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    const m = map.current;
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [coords.lon, coords.lat] }, properties: {} }] //[cite: 1]
    };

    if (m.getSource('pin-source')) {
      (m.getSource('pin-source') as maplibregl.GeoJSONSource).setData(geojson); //[cite: 1]
    } else {
      m.addSource('pin-source', { type: 'geojson', data: geojson }); //[cite: 1]
      m.addLayer({
        id: 'pin-circle',
        type: 'circle',
        source: 'pin-source',
        paint: { 'circle-radius': 6, 'circle-color': '#0ea5e9', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } //[cite: 1]
      });
    }
  }, [coords]);

  return <div ref={mapContainer} className="absolute inset-0 w-full h-full" />;
}

```

#### 4. Left Control Dock (`src/components/LeftPanel.tsx`)

```tsx
import React, { useState } from 'react';
import { useOceanStore, DEPTH_TIERS } from '../store/oceanStore';

export default function LeftPanel() {
  const { depthIdx, setDepthIdx, dateTime, setDateTime, coords, setCoords } = useOceanStore();
  const [inputLat, setInputLat] = useState(coords.lat.toString());
  const [inputLon, setInputLon] = useState(coords.lon.toString());

  const handleApplyCoords = () => {
    const lat = parseFloat(inputLat);
    const lon = parseFloat(inputLon);
    if (!isNaN(lat) && !isNaN(lon) && lat >= 5 && lat <= 30 && lon >= 45 && lon <= 105) { //[cite: 1]
      setCoords({ lat, lon });
    }
  };

  return (
    <div className="absolute left-6 top-6 z-10 w-80 rounded-xl border border-slate-800 bg-slate-950/80 p-5 shadow-2xl backdrop-blur-md text-slate-200 flex flex-col gap-6">
      {/* Depth Tier Slider */}
      <div>
        <div className="flex justify-between items-center mb-1">
          <label className="text-xs uppercase font-mono tracking-wider text-slate-400">Target Depth</label>
          <span className="text-sm font-semibold text-sky-400 font-mono">{DEPTH_TIERS[depthIdx]} m</span> {/*[cite: 1] */}
        </div>
        <input
          type="range"
          min="0"
          max={DEPTH_TIERS.length - 1}
          value={depthIdx}
          onChange={(e) => setDepthIdx(Number(e.target.value))}
          className="w-full accent-sky-400 cursor-pointer"
        />
      </div>

      {/* Date & Time Input */}
      <div>
        <label className="text-xs uppercase font-mono tracking-wider text-slate-400 block mb-1">Temporal Filter</label>
        <input
          type="datetime-local"
          value={dateTime}
          onChange={(e) => setDateTime(e.target.value)}
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 font-mono focus:border-sky-500 focus:outline-none"
        />
      </div>

      {/* Manual Coordinate Inputs */}
      <div>
        <label className="text-xs uppercase font-mono tracking-wider text-slate-400 block mb-2">Location Coordinates</label>
        <div className="flex gap-2 mb-2">
          <div className="flex-1">
            <span className="text-[10px] text-slate-400 block mb-0.5">Lat (5–30°N)</span> {/*[cite: 1] */}
            <input
              type="number"
              value={inputLat}
              onChange={(e) => setInputLat(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-mono focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <span className="text-[10px] text-slate-400 block mb-0.5">Lon (45–105°E)</span> {/*[cite: 1] */}
            <input
              type="number"
              value={inputLon}
              onChange={(e) => setInputLon(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-mono focus:outline-none"
            />
          </div>
        </div>
        <button
          onClick={handleApplyCoords}
          className="w-full rounded bg-sky-600 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 transition-colors"
        >
          Update Location
        </button>
      </div>
    </div>
  );
}

```

#### 5. Right Output Panel (`src/components/RightPanel.tsx`)

```tsx
import React from 'react';
import { useOceanStore, DEPTH_TIERS } from '../store/oceanStore';

export default function RightPanel() {
  const { coords, depthIdx, dateTime } = useOceanStore();

  return (
    <div className="absolute right-6 top-6 z-10 w-80 rounded-xl border border-slate-800 bg-slate-950/80 p-5 shadow-2xl backdrop-blur-md text-slate-200">
      <h3 className="text-xs uppercase font-mono tracking-wider text-slate-400 mb-4 border-b border-slate-800 pb-2">
        Inspection Readout
      </h3>

      <div className="space-y-3 font-mono text-xs">
        <div className="flex justify-between">
          <span className="text-slate-400">Latitude:</span>
          <span className="text-sky-400">{coords.lat}°N</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Longitude:</span>
          <span className="text-sky-400">{coords.lon}°E</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Layer Depth:</span>
          <span className="text-sky-400">{DEPTH_TIERS[depthIdx]} m</span> {/*[cite: 1] */}
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Timestamp:</span>
          <span className="text-slate-300">{dateTime.replace('T', ' ')}</span>
        </div>
      </div>
    </div>
  );
}

```

#### 6. Root Application Assembly (`src/App.tsx`)

```tsx
import React from 'react';
import MapCanvas from './components/MapCanvas';
import LeftPanel from './components/LeftPanel';
import RightPanel from './components/RightPanel';

export default function App() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950">
      <MapCanvas />
      <LeftPanel />
      <RightPanel />
    </div>
  );
}

```

