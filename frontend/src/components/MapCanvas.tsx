import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useOceanStore, DEPTH_TIERS } from '../store/oceanStore';
import {
  fetchPixelReport,
  fetchArgoFloats,
  fetchGridSubsurface,
  fetchGridSurface,
  fetchGridHeatwave,
  fetchCoastlines,
} from '../api/client';
import { renderGridToCanvas, sampleGrid, type Grid, type Colormap } from '../utils/gridRenderer';

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: Record<string, unknown>;
  }>;
}

export default function MapCanvas() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const heatmapUrlRef = useRef<string | null>(null);

  // isStyleLoaded() is false whenever tiles are still streaming and 'load' fires only
  // once, so gate map mutations on our own flag and queue them until the first load.
  const mapReady = useRef(false);
  const pending = useRef<Array<() => void>>([]);
  const whenReady = (fn: () => void) => {
    if (mapReady.current) fn(); else pending.current.push(fn);
  };

  const {
    coords, setCoords,
    depthIdx, dateTime,
    activeView, surfaceChannel, heatmapKind,
    setPixelReport, setPixelReportLoading,
    setHeatmapUrl, setHeatmapLoading, heatmapUrl,
  } = useOceanStore();

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const m = new maplibregl.Map({
      container: mapContainer.current,
      // Simple raster basemap — works everywhere without external vector-tile pipeline.
      // The beige background still shows if the tile server is unreachable, and the
      // subsurface / surface / heatwave PNG overlay (added dynamically below) sits on top.
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 10,
            attribution: 'Tiles © Esri — GEBCO, NOAA, Garmin, HERE',
          },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#edeae2' } },
          { id: 'basemap', type: 'raster', source: 'basemap' },
        ],
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      },
      bounds: [[45.0, 5.0], [105.0, 30.0]] as maplibregl.LngLatBoundsLike,
      maxBounds: [[35.0, -5.0], [115.0, 40.0]] as maplibregl.LngLatBoundsLike,
      attributionControl: false,
    });

    m.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    m.on('load', () => {
      // Ensure the map picks up the container size once the browser has laid out.
      setTimeout(() => { m.resize(); m.fitBounds([[45.0, 5.0], [105.0, 30.0]], { padding: 40, animate: false }); }, 100);
      window.addEventListener('resize', () => m.resize());
      // Click handler for coordinate selection
      m.on('click', (e: maplibregl.MapMouseEvent) => {
        const { lng, lat } = e.lngLat;
        if (lat >= 5 && lat <= 30 && lng >= 45 && lng <= 105) {
          setCoords({
            lat: parseFloat(lat.toFixed(2)),
            lon: parseFloat(lng.toFixed(2)),
          });
        }
      });

      // Cursor style
      m.getCanvas().style.cursor = 'crosshair';

      mapReady.current = true;
      pending.current.splice(0).forEach((fn) => fn());
    });

    map.current = m;
    (window as unknown as { __oceanMap?: maplibregl.Map }).__oceanMap = m;

    return () => {
      mapReady.current = false;
      pending.current = [];
      map.current?.remove();
      map.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync pin marker
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    whenReady(() => {
      // Pan to the pin if it was set off-screen (e.g. typed into the lat/lon inputs)
      if (!m.getBounds().contains([coords.lon, coords.lat])) {
        m.easeTo({ center: [coords.lon, coords.lat], duration: 600 });
      }

      const geojson: GeoJSONFeatureCollection = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [coords.lon, coords.lat] },
          properties: {},
        }],
      };

      if (m.getSource('pin-source')) {
        (m.getSource('pin-source') as maplibregl.GeoJSONSource).setData(geojson);
      } else {
        m.addSource('pin-source', { type: 'geojson', data: geojson });

        // Outer glow ring
        m.addLayer({
          id: 'pin-glow',
          type: 'circle',
          source: 'pin-source',
          paint: {
            'circle-radius': 16,
            'circle-color': '#0ea5e9',
            'circle-opacity': 0.15,
            'circle-blur': 1,
          },
        });

        // Main pin circle
        m.addLayer({
          id: 'pin-circle',
          type: 'circle',
          source: 'pin-source',
          paint: {
            'circle-radius': 7,
            'circle-color': '#0ea5e9',
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#ffffff',
          },
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords]);

  // Load ARGO float markers
  useEffect(() => {
    const m = map.current;
    if (!m || !dateTime) return;

    whenReady(async () => {
      try {
        const floats = await fetchArgoFloats(dateTime, 3);
        const geojson: GeoJSONFeatureCollection = {
          type: 'FeatureCollection',
          features: floats.map((f) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [f.lon, f.lat] },
            properties: { platform: f.platform, cycle: f.cycle },
          })),
        };

        if (m.getSource('argo-source')) {
          (m.getSource('argo-source') as maplibregl.GeoJSONSource).setData(geojson);
        } else {
          m.addSource('argo-source', { type: 'geojson', data: geojson });
          m.addLayer({
            id: 'argo-dots',
            type: 'circle',
            source: 'argo-source',
            paint: {
              'circle-radius': 3.5,
              'circle-color': '#f59e0b',
              'circle-stroke-width': 1,
              'circle-stroke-color': 'rgba(245, 158, 11, 0.3)',
              'circle-opacity': 0.7,
            },
          });
        }
      } catch {
        // ARGO data may not be available
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateTime]);

  // Fetch the JSON grid (raw °C values) and rasterise to a canvas image URL.
  const gridRef = useRef<Grid | null>(null);
  useEffect(() => {
    if (!dateTime) return;
    let cancelled = false;
    setHeatmapLoading(true);

    (async () => {
      try {
        let grid: Grid;
        let cmap: Colormap;
        if (activeView === 'subsurface') {
          const g = await fetchGridSubsurface(dateTime, DEPTH_TIERS[depthIdx], heatmapKind);
          grid = g; cmap = heatmapKind === 'error' ? 'diverging' : 'turbo';
        } else if (activeView === 'surface') {
          const g = await fetchGridSurface(dateTime, surfaceChannel);
          grid = g;
          cmap = ['sla', 'u_cur', 'v_cur', 'u_wind', 'v_wind'].includes(surfaceChannel) ? 'diverging'
               : surfaceChannel === 'sst' ? 'turbo' : 'viridis';
        } else {
          const g = await fetchGridHeatwave(dateTime);
          grid = g; cmap = 'heatwave';
        }
        if (cancelled) return;

        gridRef.current = grid;
        const canvas = renderGridToCanvas(grid, cmap, 0.9);
        const url = canvas.toDataURL('image/png');
        if (heatmapUrlRef.current) URL.revokeObjectURL(heatmapUrlRef.current);
        heatmapUrlRef.current = url;
        setHeatmapUrl(url);
        setHeatmapLoading(false);
      } catch {
        if (!cancelled) { setHeatmapUrl(null); setHeatmapLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateTime, depthIdx, activeView, surfaceChannel, heatmapKind]);

  // Apply heatmap image overlay on map — waits for style load if needed.
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    whenReady(() => {
      if (!heatmapUrl) {
        if (m.getLayer('heatmap-layer')) m.removeLayer('heatmap-layer');
        if (m.getSource('heatmap-source')) m.removeSource('heatmap-source');
        return;
      }

      const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
        [45.0, 30.0], [105.0, 30.0], [105.0, 5.0], [45.0, 5.0],
      ];
      if (m.getSource('heatmap-source')) {
        (m.getSource('heatmap-source') as maplibregl.ImageSource).updateImage({ url: heatmapUrl, coordinates });
      } else {
        m.addSource('heatmap-source', { type: 'image', url: heatmapUrl, coordinates });
        // insert BELOW the coastlines layer so land outlines stay on top
        const beforeId = m.getLayer('coastlines') ? 'coastlines' : undefined;
        m.addLayer({
          id: 'heatmap-layer',
          type: 'raster',
          source: 'heatmap-source',
          paint: { 'raster-opacity': 0.92, 'raster-fade-duration': 250, 'raster-resampling': 'linear' },
        }, beforeId);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatmapUrl]);

  // Add coastlines once — extracted from land mask, ships from backend.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    whenReady(async () => {
      if (m.getSource('coastlines-src')) return;
      try {
        const gj = await fetchCoastlines();
        m.addSource('coastlines-src', { type: 'geojson', data: gj as GeoJSON.FeatureCollection });
        m.addLayer({
          id: 'coastlines',
          type: 'line',
          source: 'coastlines-src',
          paint: { 'line-color': '#334155', 'line-width': 1.2, 'line-opacity': 0.85 },
        });
      } catch { /* coastlines optional */ }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hover-to-read temperature (updates cursor tooltip via console for now)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const onMove = (e: maplibregl.MapMouseEvent) => {
      const g = gridRef.current;
      if (!g) return;
      const v = sampleGrid(g, e.lngLat.lat, e.lngLat.lng);
      m.getCanvas().title = v == null ? '' : `${v.toFixed(2)} °C @ ${e.lngLat.lat.toFixed(2)}°N ${e.lngLat.lng.toFixed(2)}°E`;
    };
    m.on('mousemove', onMove);
    return () => { m.off('mousemove', onMove); };
  }, []);

  // Fetch pixel report on coord change
  useEffect(() => {
    if (!dateTime) return;

    let cancelled = false;
    setPixelReportLoading(true);

    (async () => {
      try {
        const report = await fetchPixelReport(dateTime, coords.lat, coords.lon, false);
        if (!cancelled) {
          setPixelReport(report);
          setPixelReportLoading(false);
        }
      } catch {
        if (!cancelled) {
          setPixelReport(null);
          setPixelReportLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords, dateTime]);

  return <div ref={mapContainer} className="map-canvas" id="map-canvas" />;
}
