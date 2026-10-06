import { create } from 'zustand';

export const DEPTH_TIERS = [0, 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000];

export type ActiveView = 'subsurface' | 'surface' | 'heatwave';
export type HeatmapKind = 'pred' | 'glorys' | 'error';

export interface PixelReport {
  profile: {
    date: string;
    lat: number;
    lon: number;
    depths_m: number[];
    predicted_C: number[];
    glorys_C: number[];
    error_C: number[];
  };
  surface: {
    sst_C: number;
    sst_anomaly_C: number;
    heatwave_category: string;
  };
  argo_nearby: Array<{
    platform: string;
    cycle: number;
    lat: number;
    lon: number;
    time: string;
    n_levels: number;
    max_pressure_dbar: number;
  }>;
  confidence: {
    score: number | null;
    label: string;
    n_argo_points: number | null;
  };
  personas: Record<string, { display: string; bullets: string[] }>;
  llm_narrative: string | null;
}

export interface MetaData {
  bbox: {
    lon_min: number;
    lon_max: number;
    lat_min: number;
    lat_max: number;
    n_lat: number;
    n_lon: number;
  };
  depths_m: number[];
  surface_channels: string[];
  n_dates: number;
  date_min: string | null;
  date_max: string | null;
  checkpoint: string;
}

interface OceanStore {
  // Core state from blueprint
  depthIdx: number;
  dateTime: string;
  coords: { lat: number; lon: number };

  // Extended state
  activeView: ActiveView;
  surfaceChannel: string;
  heatmapKind: HeatmapKind;
  persona: string;

  // Cached data
  pixelReport: PixelReport | null;
  meta: MetaData | null;
  isLoading: boolean;
  pixelReportLoading: boolean;

  // UI state
  chatOpen: boolean;
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  pixelModalOpen: boolean;
  timeseriesModalOpen: boolean;
  metricsExpanded: boolean;
  backendOnline: boolean;

  // Heatmap overlay URL
  heatmapUrl: string | null;
  heatmapLoading: boolean;

  // Actions
  setDepthIdx: (idx: number) => void;
  setDateTime: (dt: string) => void;
  setCoords: (coords: { lat: number; lon: number }) => void;
  setActiveView: (view: ActiveView) => void;
  setSurfaceChannel: (channel: string) => void;
  setHeatmapKind: (kind: HeatmapKind) => void;
  setPersona: (persona: string) => void;
  setPixelReport: (report: PixelReport | null) => void;
  setMeta: (meta: MetaData) => void;
  setIsLoading: (loading: boolean) => void;
  setPixelReportLoading: (loading: boolean) => void;
  setChatOpen: (open: boolean) => void;
  addChatMessage: (role: 'user' | 'assistant', content: string) => void;
  clearChat: () => void;
  setPixelModalOpen: (open: boolean) => void;
  setTimeseriesModalOpen: (open: boolean) => void;
  setMetricsExpanded: (expanded: boolean) => void;
  setBackendOnline: (online: boolean) => void;
  setHeatmapUrl: (url: string | null) => void;
  setHeatmapLoading: (loading: boolean) => void;
}

export const useOceanStore = create<OceanStore>((set) => ({
  depthIdx: 7,           // 100m default
  dateTime: '',          // will be set from /api/today on mount
  coords: { lat: 15.0, lon: 78.0 },

  activeView: 'subsurface',
  surfaceChannel: 'sst',
  heatmapKind: 'pred',
  persona: 'general',

  pixelReport: null,
  meta: null,
  isLoading: false,
  pixelReportLoading: false,

  chatOpen: false,
  chatHistory: [],
  pixelModalOpen: false,
  timeseriesModalOpen: false,
  metricsExpanded: false,
  backendOnline: false,

  heatmapUrl: null,
  heatmapLoading: false,

  setDepthIdx: (depthIdx) => set({ depthIdx }),
  setDateTime: (dateTime) => set({ dateTime }),
  setCoords: (coords) => set({ coords }),
  setActiveView: (activeView) => set({ activeView }),
  setSurfaceChannel: (surfaceChannel) => set({ surfaceChannel }),
  setHeatmapKind: (heatmapKind) => set({ heatmapKind }),
  setPersona: (persona) => set({ persona }),
  setPixelReport: (pixelReport) => set({ pixelReport }),
  setMeta: (meta) => set({ meta }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setPixelReportLoading: (pixelReportLoading) => set({ pixelReportLoading }),
  setChatOpen: (chatOpen) => set({ chatOpen }),
  addChatMessage: (role, content) =>
    set((state) => ({
      chatHistory: [...state.chatHistory.slice(-15), { role, content }],
    })),
  clearChat: () => set({ chatHistory: [] }),
  setPixelModalOpen: (pixelModalOpen) => set({ pixelModalOpen }),
  setTimeseriesModalOpen: (timeseriesModalOpen) => set({ timeseriesModalOpen }),
  setMetricsExpanded: (metricsExpanded) => set({ metricsExpanded }),
  setBackendOnline: (backendOnline) => set({ backendOnline }),
  setHeatmapUrl: (heatmapUrl) => set({ heatmapUrl }),
  setHeatmapLoading: (heatmapLoading) => set({ heatmapLoading }),
}));
