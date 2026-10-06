import { useOceanStore, DEPTH_TIERS } from '../store/oceanStore';
import { FiMapPin, FiThermometer, FiClock, FiAnchor, FiAlertTriangle, FiInfo } from 'react-icons/fi';

function ConfidenceBadge({ label, score }: { label: string; score: number | null }) {
  const cls = label === 'EXCELLENT' ? 'excellent'
    : label === 'GOOD' ? 'good'
    : label === 'FAIR' ? 'fair'
    : label === 'MARGINAL' ? 'marginal'
    : label === 'POOR' ? 'poor'
    : 'fair';

  return (
    <span className={`confidence-badge confidence-badge--${cls}`}>
      {score != null ? `${score.toFixed(0)}/100` : '—'} {label}
    </span>
  );
}

function HeatwaveBadge({ category }: { category: string }) {
  const key = category.toLowerCase();
  const cls = key === 'moderate' ? 'moderate'
    : key === 'strong' ? 'strong'
    : key === 'severe' ? 'severe'
    : key === 'extreme' ? 'extreme'
    : 'none';

  return (
    <span className={`hw-badge hw-badge--${cls}`}>
      <FiAlertTriangle size={10} />
      {category}
    </span>
  );
}

export default function RightPanel() {
  const {
    coords, depthIdx, dateTime, activeView,
    pixelReport, pixelReportLoading,
    setPixelModalOpen, setTimeseriesModalOpen,
    persona,
  } = useOceanStore();

  const surface = pixelReport?.surface;
  const confidence = pixelReport?.confidence;
  const personaInsights = pixelReport?.personas?.[persona] || pixelReport?.personas?.['general'];

  return (
    <div className="glass-panel glass-panel--right" id="right-panel">
      {/* Header */}
      <div className="panel-section">
        <div className="panel-section__label" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
          <span>Inspection Readout</span>
          <FiMapPin size={12} style={{ color: 'var(--ocean-400)' }} />
        </div>
      </div>

      {/* Coordinate readouts */}
      <div className="panel-section">
        <div className="readout-row">
          <span className="readout-row__label">
            <FiMapPin size={10} style={{ marginRight: 4, verticalAlign: -1 }} />
            Latitude
          </span>
          <span className="readout-row__value">{coords.lat.toFixed(2)}°N</span>
        </div>
        <div className="readout-row">
          <span className="readout-row__label">
            <FiMapPin size={10} style={{ marginRight: 4, verticalAlign: -1 }} />
            Longitude
          </span>
          <span className="readout-row__value">{coords.lon.toFixed(2)}°E</span>
        </div>
        <div className="readout-row">
          <span className="readout-row__label">
            <FiAnchor size={10} style={{ marginRight: 4, verticalAlign: -1 }} />
            Layer Depth
          </span>
          <span className="readout-row__value">{DEPTH_TIERS[depthIdx]} m</span>
        </div>
        <div className="readout-row">
          <span className="readout-row__label">
            <FiClock size={10} style={{ marginRight: 4, verticalAlign: -1 }} />
            Date
          </span>
          <span className="readout-row__value" style={{ color: 'var(--text-secondary)' }}>
            {dateTime || '—'}
          </span>
        </div>
        <div className="readout-row">
          <span className="readout-row__label">View</span>
          <span className="readout-row__value" style={{ textTransform: 'capitalize' }}>
            {activeView}
          </span>
        </div>
      </div>

      {/* Loading state */}
      {pixelReportLoading && (
        <div className="panel-section">
          <div className="loading-shimmer" style={{ height: 14, marginBottom: 8 }} />
          <div className="loading-shimmer" style={{ height: 14, width: '70%', marginBottom: 8 }} />
          <div className="loading-shimmer" style={{ height: 14, width: '50%' }} />
        </div>
      )}

      {/* Surface State */}
      {surface && !pixelReportLoading && (
        <>
          <hr className="panel-divider" />
          <div className="panel-section">
            <div className="panel-section__label">
              <span>Surface State</span>
              <FiThermometer size={12} />
            </div>
            <div className="readout-row">
              <span className="readout-row__label">SST</span>
              <span className="readout-row__value">
                {typeof surface.sst_C === 'number' ? `${surface.sst_C.toFixed(2)} °C` : '—'}
              </span>
            </div>
            <div className="readout-row">
              <span className="readout-row__label">Anomaly</span>
              <span className="readout-row__value" style={{
                color: surface.sst_anomaly_C > 1 ? 'var(--status-fair)'
                  : surface.sst_anomaly_C > 2 ? 'var(--status-poor)'
                  : 'var(--text-accent)',
              }}>
                {typeof surface.sst_anomaly_C === 'number'
                  ? `${surface.sst_anomaly_C > 0 ? '+' : ''}${surface.sst_anomaly_C.toFixed(2)} °C`
                  : '—'}
              </span>
            </div>
            <div className="readout-row">
              <span className="readout-row__label">Heatwave</span>
              <HeatwaveBadge category={surface.heatwave_category || 'None'} />
            </div>
          </div>
        </>
      )}

      {/* ARGO Confidence */}
      {confidence && !pixelReportLoading && (
        <>
          <hr className="panel-divider" />
          <div className="panel-section">
            <div className="panel-section__label">
              <span>ARGO Validation</span>
            </div>
            <div style={{ marginBottom: 8 }}>
              <ConfidenceBadge label={confidence.label} score={confidence.score} />
            </div>
            {confidence.n_argo_points != null && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {confidence.n_argo_points.toLocaleString()} ARGO points within ±3 days
              </div>
            )}
          </div>
        </>
      )}

      {/* Persona Insights */}
      {personaInsights && !pixelReportLoading && personaInsights.bullets.length > 0 && (
        <>
          <hr className="panel-divider" />
          <div className="panel-section">
            <div className="panel-section__label">
              <span>{personaInsights.display}</span>
              <FiInfo size={12} />
            </div>
            {personaInsights.bullets.map((bullet, i) => (
              <div key={i} className="insight-bullet" style={{ animationDelay: `${i * 0.05}s` }}>
                <span className="insight-bullet__icon">▸</span>
                <span>{bullet}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Action Buttons */}
      {!pixelReportLoading && (
        <>
          <hr className="panel-divider" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn--primary"
              id="full-report-btn"
              onClick={() => setPixelModalOpen(true)}
              style={{ flex: 1 }}
            >
              Full Report
            </button>
            <button
              className="btn btn--ghost"
              id="timeseries-btn"
              onClick={() => setTimeseriesModalOpen(true)}
              style={{ flex: 1 }}
            >
              Time Series
            </button>
          </div>
        </>
      )}
    </div>
  );
}
