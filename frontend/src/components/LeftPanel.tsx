import { useState, useEffect } from 'react';
import { useOceanStore, DEPTH_TIERS } from '../store/oceanStore';
import { fetchPersonas, fetchMetrics, type MetricsResponse } from '../api/client';
import { FiLayers, FiSun, FiThermometer, FiChevronDown, FiChevronUp, FiAlertTriangle } from 'react-icons/fi';
import CalamityPanel from './CalamityPanel';

const SURFACE_LABELS: Record<string, string> = {
  sst: 'Sea Surface Temperature',
  sss: 'Sea Surface Salinity',
  ssh: 'Sea Surface Height',
  sla: 'Sea Level Anomaly',
  u_cur: 'Zonal Current (u)',
  v_cur: 'Meridional Current (v)',
  u_wind: 'Zonal Wind (u)',
  v_wind: 'Meridional Wind (v)',
};

export default function LeftPanel() {
  const {
    depthIdx, setDepthIdx,
    dateTime, setDateTime,
    coords, setCoords,
    activeView, setActiveView,
    surfaceChannel, setSurfaceChannel,
    heatmapKind, setHeatmapKind,
    persona, setPersona,
    heatmapLoading,
    metricsExpanded, setMetricsExpanded,
  } = useOceanStore();

  const [inputLat, setInputLat] = useState(coords.lat.toString());
  const [inputLon, setInputLon] = useState(coords.lon.toString());
  const [personaList, setPersonaList] = useState<Record<string, { display: string }>>({});
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [showCalamity, setShowCalamity] = useState(false);

  // Sync inputs when coords change from map click
  useEffect(() => {
    setInputLat(coords.lat.toString());
    setInputLon(coords.lon.toString());
  }, [coords]);

  // Load personas
  useEffect(() => {
    fetchPersonas().then(setPersonaList).catch(() => {});
  }, []);

  // Load metrics when expanded
  useEffect(() => {
    if (metricsExpanded && !metrics) {
      fetchMetrics().then(setMetrics).catch(() => {});
    }
  }, [metricsExpanded, metrics]);

  const handleApplyCoords = () => {
    const lat = parseFloat(inputLat);
    const lon = parseFloat(inputLon);
    if (!isNaN(lat) && !isNaN(lon) && lat >= 5 && lat <= 30 && lon >= 45 && lon <= 105) {
      setCoords({ lat, lon });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleApplyCoords();
  };

  return (
    <div className="glass-panel glass-panel--left" id="left-panel">
      {/* View Mode Tabs */}
      <div className="view-tabs" id="view-tabs">
        <button
          className={`view-tab ${activeView === 'subsurface' ? 'view-tab--active' : ''}`}
          onClick={() => setActiveView('subsurface')}
        >
          <FiLayers size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
          Subsurface
        </button>
        <button
          className={`view-tab ${activeView === 'surface' ? 'view-tab--active' : ''}`}
          onClick={() => setActiveView('surface')}
        >
          <FiSun size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
          Surface
        </button>
        <button
          className={`view-tab ${activeView === 'heatwave' ? 'view-tab--active' : ''}`}
          onClick={() => setActiveView('heatwave')}
        >
          <FiThermometer size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
          Heatwave
        </button>
      </div>

      {/* Heatmap loading indicator */}
      {heatmapLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 11, color: 'var(--text-muted)' }}>
          <div className="loading-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
          Loading heatmap…
        </div>
      )}

      {/* Depth Selector — Subsurface only. One button per standard depth so users
          can toggle any of the 15 levels and the live map re-renders. */}
      {activeView === 'subsurface' && (
        <div className="panel-section">
          <div className="panel-section__label">
            <span>Target Depth</span>
            <span className="panel-section__value">{DEPTH_TIERS[depthIdx]} m</span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
              gap: 4,
              marginTop: 4,
            }}
          >
            {DEPTH_TIERS.map((d, i) => (
              <button
                key={d}
                type="button"
                onClick={() => setDepthIdx(i)}
                className={`view-tab ${i === depthIdx ? 'view-tab--active' : ''}`}
                title={`${d} metres`}
                style={{ padding: '6px 2px', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              >
                {d < 1000 ? `${d}` : '1k'}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 6, fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
            surface → deep · click any level to update the live map
          </div>
        </div>
      )}

      {/* Heatmap Kind — Subsurface only */}
      {activeView === 'subsurface' && (
        <div className="panel-section">
          <div className="panel-section__label">
            <span>Data Layer</span>
          </div>
          <div className="view-tabs" style={{ marginBottom: 0 }}>
            {(['pred', 'glorys', 'error'] as const).map((k) => (
              <button
                key={k}
                className={`view-tab ${heatmapKind === k ? 'view-tab--active' : ''}`}
                onClick={() => setHeatmapKind(k)}
                style={{ fontSize: 10 }}
              >
                {k === 'pred' ? 'Model' : k === 'glorys' ? 'GLORYS' : 'Error'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Surface Channel — Surface only */}
      {activeView === 'surface' && (
        <div className="panel-section">
          <div className="panel-section__label">
            <span>Surface Channel</span>
          </div>
          <select
            id="surface-channel"
            value={surfaceChannel}
            onChange={(e) => setSurfaceChannel(e.target.value)}
            className="select-field"
          >
            {Object.entries(SURFACE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Calamity Analysis — Heatwave view only. Opens the CalamityPanel modal. */}
      {activeView === 'heatwave' && (
        <div className="panel-section">
          <button
            type="button"
            className="btn btn--primary"
            style={{ background: 'linear-gradient(135deg, #ef4444, #b91c1c)', boxShadow: '0 2px 8px rgba(239,68,68,0.35)' }}
            onClick={() => setShowCalamity(true)}
          >
            <FiAlertTriangle size={14} style={{ marginRight: 6 }} />
            Full Calamity Analysis
          </button>
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
            7-day trend · risk score · LLM disaster advisory
          </div>
        </div>
      )}
      {showCalamity && <CalamityPanel date={dateTime} onClose={() => setShowCalamity(false)} />}

      <hr className="panel-divider" />

      {/* Date Picker */}
      <div className="panel-section">
        <div className="panel-section__label">
          <span>Temporal Filter</span>
        </div>
        <input
          type="date"
          id="date-picker"
          value={dateTime}
          onChange={(e) => setDateTime(e.target.value)}
          className="input-field"
        />
      </div>

      <hr className="panel-divider" />

      {/* Coordinate Inputs */}
      <div className="panel-section">
        <div className="panel-section__label">
          <span>Location Coordinates</span>
        </div>
        <div className="coord-row">
          <div className="coord-field">
            <span className="coord-field__label">Lat (5–30°N)</span>
            <input
              type="number"
              id="lat-input"
              value={inputLat}
              onChange={(e) => setInputLat(e.target.value)}
              onKeyDown={handleKeyDown}
              step="0.25"
              min="5"
              max="30"
              className="input-field"
            />
          </div>
          <div className="coord-field">
            <span className="coord-field__label">Lon (45–105°E)</span>
            <input
              type="number"
              id="lon-input"
              value={inputLon}
              onChange={(e) => setInputLon(e.target.value)}
              onKeyDown={handleKeyDown}
              step="0.25"
              min="45"
              max="105"
              className="input-field"
            />
          </div>
        </div>
        <button className="btn btn--primary" id="update-location-btn" onClick={handleApplyCoords}>
          Update Location
        </button>
      </div>

      <hr className="panel-divider" />

      {/* Persona Selector */}
      <div className="panel-section">
        <div className="panel-section__label">
          <span>User Persona</span>
        </div>
        <select
          id="persona-select"
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          className="select-field"
        >
          {Object.entries(personaList).map(([key, val]) => (
            <option key={key} value={key}>{val.display}</option>
          ))}
          {Object.keys(personaList).length === 0 && (
            <option value="general">General public</option>
          )}
        </select>
      </div>

      <hr className="panel-divider" />

      {/* Metrics Accordion */}
      <div className="panel-section">
        <button
          className="persona-group__header"
          onClick={() => setMetricsExpanded(!metricsExpanded)}
          id="metrics-toggle"
        >
          <span>Model Performance</span>
          {metricsExpanded ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
        </button>

        {metricsExpanded && metrics && (
          <div className="persona-group__body">
            <div style={{
              padding: '8px 12px',
              background: 'rgba(14, 165, 233, 0.08)',
              borderRadius: 8,
              marginBottom: 10,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                MEAN RMSE (ALL DEPTHS)
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }}>
                {metrics.mean_rmse_C.toFixed(3)} °C
              </div>
            </div>

            <table className="metrics-table">
              <thead>
                <tr>
                  <th>Depth</th>
                  <th>RMSE</th>
                  <th>Bias</th>
                  <th>Corr</th>
                </tr>
              </thead>
              <tbody>
                {metrics.per_depth.map((row) => (
                  <tr key={row.depth_m}>
                    <td>{row.depth_m} m</td>
                    <td>{row.rmse?.toFixed(3) ?? '—'}</td>
                    <td style={{ color: row.bias && row.bias > 0 ? 'var(--status-fair)' : 'var(--status-good)' }}>
                      {row.bias != null ? (row.bias > 0 ? '+' : '') + row.bias.toFixed(3) : '—'}
                    </td>
                    <td>{row.corr?.toFixed(3) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {metricsExpanded && !metrics && (
          <div className="persona-group__body">
            <div className="loading-shimmer" style={{ height: 100 }} />
          </div>
        )}
      </div>
    </div>
  );
}
