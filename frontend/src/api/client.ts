/**
 * API client — centralized fetch wrapper for all backend endpoints.
 *
 * Base URL comes from VITE_API_URL (defaults to http://localhost:8000).
 * Every function is typed and handles errors gracefully.
 */

// Default to relative paths (empty base) so /api/* hits the Vite dev proxy in
// dev and the same-origin server in production. Set VITE_API_URL only when the
// backend lives on a different host (e.g. deployed API).
const BASE = (import.meta.env.VITE_API_URL as string) ?? '';

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function fetchBlob(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ─── Discovery / Health ───

export async function fetchHealth(): Promise<{ ok: boolean; time: string }> {
  return fetchJSON('/api/health');
}

export async function fetchToday(): Promise<{
  today: string;
  mapped_date: string | null;
  strategy: string;
  reason?: string;
}> {
  return fetchJSON('/api/today');
}

export interface MetaResponse {
  bbox: {
    lon_min: number; lon_max: number;
    lat_min: number; lat_max: number;
    n_lat: number; n_lon: number;
  };
  depths_m: number[];
  surface_channels: string[];
  n_dates: number;
  date_min: string | null;
  date_max: string | null;
  checkpoint: string;
}

export async function fetchMeta(): Promise<MetaResponse> {
  return fetchJSON('/api/meta');
}

// ─── Heatmaps (PNG → blob URL) ───

export async function fetchHeatmapSubsurface(
  date: string, depth: number, kind: 'pred' | 'glorys' | 'error' = 'pred'
): Promise<string> {
  return fetchBlob(`/api/heatmap/subsurface?date=${encodeURIComponent(date)}&depth=${depth}&kind=${kind}`);
}

export async function fetchHeatmapSurface(date: string, channel: string): Promise<string> {
  return fetchBlob(`/api/heatmap/surface?date=${encodeURIComponent(date)}&channel=${encodeURIComponent(channel)}`);
}

export async function fetchHeatmapHeatwave(date: string): Promise<string> {
  return fetchBlob(`/api/heatmap/heatwave?date=${encodeURIComponent(date)}`);
}

// ─── Profile ───

export interface ProfileResponse {
  date: string;
  lat: number; lon: number;
  depths_m: number[];
  predicted_C: number[];
  glorys_C: number[];
  error_C: number[];
}

export async function fetchProfile(date: string, lat: number, lon: number): Promise<ProfileResponse> {
  return fetchJSON(`/api/profile?date=${encodeURIComponent(date)}&lat=${lat}&lon=${lon}`);
}

export async function fetchProfilePlot(date: string, lat: number, lon: number): Promise<string> {
  return fetchBlob(`/api/profile/plot?date=${encodeURIComponent(date)}&lat=${lat}&lon=${lon}`);
}

// ─── Time Series ───

export interface TimeSeriesResponse {
  lat: number; lon: number; depth_m: number;
  dates: string[];
  predicted_C: number[];
  glorys_C: number[];
}

export async function fetchTimeseries(lat: number, lon: number, depth: number): Promise<TimeSeriesResponse> {
  return fetchJSON(`/api/timeseries?lat=${lat}&lon=${lon}&depth=${depth}`);
}

export async function fetchTimeseriesPlot(lat: number, lon: number, depth: number): Promise<string> {
  return fetchBlob(`/api/timeseries/plot?lat=${lat}&lon=${lon}&depth=${depth}`);
}

// ─── Heatwave ───

export interface HeatwaveResponse {
  summary: {
    date: string;
    area_percent_in_mhw: number;
    max_anomaly_C: number | null;
    mean_anomaly_C: number | null;
    categories: Record<string, number>;
    recommendations: string[];
  };
  llm_narrative: string | null;
}

export async function fetchHeatwave(date: string, llm: boolean = false): Promise<HeatwaveResponse> {
  return fetchJSON(`/api/heatwave?date=${encodeURIComponent(date)}&llm=${llm}`);
}

// ─── Pixel Report ───

export interface PixelReportResponse {
  profile: ProfileResponse;
  surface: {
    sst_C: number;
    sst_anomaly_C: number;
    heatwave_category: string;
  };
  argo_nearby: Array<{
    platform: string; cycle: number;
    lat: number; lon: number; time: string;
    n_levels: number; max_pressure_dbar: number;
  }>;
  confidence: {
    score: number | null;
    label: string;
    n_argo_points: number | null;
  };
  personas: Record<string, { display: string; bullets: string[] }>;
  llm_narrative: string | null;
}

export async function fetchPixelReport(
  date: string, lat: number, lon: number, llm: boolean = true
): Promise<PixelReportResponse> {
  return fetchJSON(`/api/pixel_report?date=${encodeURIComponent(date)}&lat=${lat}&lon=${lon}&llm=${llm}`);
}

// ─── Metrics ───

export interface MetricsResponse {
  per_depth: Array<{
    depth_m: number;
    rmse: number | null;
    bias: number | null;
    corr: number | null;
    n: number;
  }>;
  mean_rmse_C: number;
}

export async function fetchMetrics(): Promise<MetricsResponse> {
  return fetchJSON('/api/metrics');
}

// ─── Insights ───

export interface InsightsResponse {
  context: Record<string, unknown>;
  personas: Record<string, { display: string; bullets: string[] }>;
}

export async function fetchInsights(
  date: string, lat: number, lon: number, persona: string = 'all'
): Promise<InsightsResponse> {
  return fetchJSON(`/api/insights?date=${encodeURIComponent(date)}&lat=${lat}&lon=${lon}&persona=${encodeURIComponent(persona)}`);
}

// ─── Chat ───

export interface ChatResponse {
  answer: string;
  persona: string;
  persona_display: string;
  model: string;
  context_used: boolean;
}

export async function fetchChat(
  question: string,
  date?: string,
  lat?: number,
  lon?: number,
  persona?: string,
  history?: Array<{ role: string; content: string }>
): Promise<ChatResponse> {
  return fetchJSON('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, date, lat, lon, persona, history }),
  });
}

// ─── Personas ───

export async function fetchPersonas(): Promise<Record<string, { display: string }>> {
  return fetchJSON('/api/personas');
}

// ─── ARGO ───

export interface ArgoFloat {
  platform: string;
  cycle: number;
  lat: number;
  lon: number;
  time: string;
  n_levels: number;
  max_pressure_dbar: number;
}

export async function fetchArgoFloats(date: string, windowDays: number = 3): Promise<ArgoFloat[]> {
  return fetchJSON(`/api/argo/floats?date=${encodeURIComponent(date)}&window_days=${windowDays}`);
}

export interface ArgoValidationResponse {
  date: string;
  window_days: number;
  n_argo_points: number;
  confidence_score: number | null;
  confidence_label: string;
  summary: string;
  per_depth: Array<{
    depth_m: number;
    rmse: number | null;
    bias: number | null;
    corr: number | null;
    n: number;
  }>;
  scatter: {
    argo: number[];
    model: number[];
    pressure_dbar: number[];
  };
}

export async function fetchArgoValidate(date: string, windowDays: number = 3): Promise<ArgoValidationResponse> {
  return fetchJSON(`/api/argo/validate?date=${encodeURIComponent(date)}&window_days=${windowDays}`);
}

export async function fetchArgoValidatePlot(date: string, windowDays: number = 3): Promise<string> {
  return fetchBlob(`/api/argo/validate/plot?date=${encodeURIComponent(date)}&window_days=${windowDays}`);
}

// ─── Freeform Analysis ───

export interface AnalysisResponse {
  analysis: string;
  model: string;
}

export async function fetchAnalysis(context: string, extraSystem?: string): Promise<AnalysisResponse> {
  return fetchJSON('/api/analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, extra_system: extraSystem }),
  });
}

// ─── Raw JSON grids (client-side rendering) ───

export interface GridResponse {
  date: string;
  lat: number[];
  lon: number[];
  values: (number | null)[][];
  vmin: number;
  vmax: number;
  units?: string;
  depth_m?: number;
  kind?: string;
  channel?: string;
  legend?: Record<string, string>;
}

export async function fetchGridSubsurface(date: string, depth: number, kind: 'pred'|'glorys'|'error' = 'pred'): Promise<GridResponse> {
  return fetchJSON(`/api/grid/subsurface?date=${encodeURIComponent(date)}&depth=${depth}&kind=${kind}`);
}
export async function fetchGridSurface(date: string, channel: string): Promise<GridResponse> {
  return fetchJSON(`/api/grid/surface?date=${encodeURIComponent(date)}&channel=${encodeURIComponent(channel)}`);
}
export async function fetchGridHeatwave(date: string): Promise<GridResponse> {
  return fetchJSON(`/api/grid/heatwave?date=${encodeURIComponent(date)}`);
}

// ─── Coastlines (GeoJSON, ~19 KB) ───

export async function fetchCoastlines(): Promise<GeoJSON.FeatureCollection> {
  return fetchJSON('/api/coastlines');
}

// ─── Heatwave calamity analysis (rich LLM advisory) ───

export interface HeatwaveAnalyzeResponse {
  date: string;
  lookback_days: number;
  trend: Array<{ date: string; area_pct: number; max_anom: number | null; mean_anom: number | null; severe_pixels: number }>;
  trend_label: string;
  risk_score: number;
  risk_label: string;
  current: {
    date: string;
    area_percent_in_mhw: number;
    max_anomaly_C: number | null;
    mean_anomaly_C: number | null;
    categories: Record<string, number>;
    recommendations: string[];
  };
  llm_advisory: string | null;
}

export async function fetchHeatwaveAnalyze(date: string, llm: boolean = true, lookbackDays: number = 7): Promise<HeatwaveAnalyzeResponse> {
  return fetchJSON(`/api/heatwave/analyze?date=${encodeURIComponent(date)}&llm=${llm}&lookback_days=${lookbackDays}`);
}
