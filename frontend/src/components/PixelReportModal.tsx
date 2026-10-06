import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useOceanStore } from '../store/oceanStore';
import { fetchPixelReport, type PixelReportResponse } from '../api/client';
import { FiX, FiAlertTriangle, FiAnchor, FiChevronDown } from 'react-icons/fi';

export default function PixelReportModal() {
  const { pixelModalOpen, setPixelModalOpen, coords, dateTime, pixelReport } = useOceanStore();
  const [fullReport, setFullReport] = useState<PixelReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedPersona, setExpandedPersona] = useState<string | null>(null);

  useEffect(() => {
    if (!pixelModalOpen || !dateTime) return;

    // If we have a basic report, start from that, then fetch with LLM
    if (pixelReport) {
      setFullReport(pixelReport as PixelReportResponse);
    }

    setLoading(true);
    fetchPixelReport(dateTime, coords.lat, coords.lon, true)
      .then((r) => {
        setFullReport(r);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [pixelModalOpen, dateTime, coords, pixelReport]);

  if (!pixelModalOpen) return null;

  const profile = fullReport?.profile;
  const surface = fullReport?.surface;
  const confidence = fullReport?.confidence;
  const personas = fullReport?.personas;
  const narrative = fullReport?.llm_narrative;
  const argoNearby = fullReport?.argo_nearby || [];

  // Build chart data for the profile
  const profileData = profile
    ? profile.depths_m.map((d, i) => ({
        depth: d,
        predicted: profile.predicted_C[i],
        glorys: profile.glorys_C[i],
        error: profile.error_C[i],
      }))
    : [];

  return (
    <>
      <div className="modal-backdrop" onClick={() => setPixelModalOpen(false)} />
      <div className="modal-content" id="pixel-report-modal">
        {/* Header */}
        <div className="modal-content__header">
          <h2 className="modal-content__title">
            Pixel Report — {coords.lat.toFixed(2)}°N, {coords.lon.toFixed(2)}°E
          </h2>
          <button className="modal-content__close" onClick={() => setPixelModalOpen(false)}>
            <FiX />
          </button>
        </div>

        {/* Date subtitle */}
        <div style={{
          fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
          marginBottom: 20, marginTop: -12,
        }}>
          {profile?.date || dateTime}
        </div>

        <div className="modal-grid">
          {/* Profile Chart */}
          <div className="modal-card modal-card--full">
            <div className="modal-card__title">Vertical Temperature Profile</div>
            {profileData.length > 0 ? (
              <div className="profile-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={profileData} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(56,78,120,0.3)" />
                    <XAxis
                      type="number"
                      dataKey="predicted"
                      label={{ value: 'Temperature (°C)', position: 'insideBottom', offset: -5, style: { fill: '#94a3b8', fontSize: 11 } }}
                      tick={{ fill: '#64748b', fontSize: 10 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="depth"
                      reversed
                      label={{ value: 'Depth (m)', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8', fontSize: 11 } }}
                      tick={{ fill: '#64748b', fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#131b2e', border: '1px solid rgba(56,78,120,0.3)',
                        borderRadius: 8, fontSize: 12, fontFamily: 'JetBrains Mono',
                      }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="predicted" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3, fill: '#0ea5e9' }} name="Model" />
                    <Line type="monotone" dataKey="glorys" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} name="GLORYS" strokeDasharray="6 3" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="loading-shimmer" style={{ height: 300 }} />
            )}
          </div>

          {/* Surface State Card */}
          <div className="modal-card">
            <div className="modal-card__title">Surface State</div>
            {surface ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="readout-row">
                  <span className="readout-row__label">SST</span>
                  <span className="readout-row__value" style={{ fontSize: 18, fontWeight: 700 }}>
                    {surface.sst_C.toFixed(2)} °C
                  </span>
                </div>
                <div className="readout-row">
                  <span className="readout-row__label">Anomaly</span>
                  <span className="readout-row__value" style={{
                    color: Math.abs(surface.sst_anomaly_C) > 2 ? 'var(--status-poor)' :
                           Math.abs(surface.sst_anomaly_C) > 1 ? 'var(--status-fair)' : 'var(--text-accent)',
                  }}>
                    {surface.sst_anomaly_C > 0 ? '+' : ''}{surface.sst_anomaly_C.toFixed(2)} °C
                  </span>
                </div>
                <div className="readout-row">
                  <span className="readout-row__label">Heatwave</span>
                  <span className={`hw-badge hw-badge--${surface.heatwave_category.toLowerCase()}`}>
                    <FiAlertTriangle size={10} />
                    {surface.heatwave_category}
                  </span>
                </div>
              </div>
            ) : (
              <div className="loading-shimmer" style={{ height: 80 }} />
            )}
          </div>

          {/* ARGO Confidence Card */}
          <div className="modal-card">
            <div className="modal-card__title">ARGO Validation</div>
            {confidence ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ textAlign: 'center', padding: '10px 0' }}>
                  <div style={{
                    fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-mono)',
                    color: confidence.score != null && confidence.score >= 70 ? 'var(--status-good)' :
                           confidence.score != null && confidence.score >= 55 ? 'var(--status-fair)' : 'var(--status-poor)',
                  }}>
                    {confidence.score != null ? `${confidence.score.toFixed(0)}` : '—'}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                    out of 100 • {confidence.label}
                  </div>
                </div>
                {confidence.n_argo_points != null && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
                    {confidence.n_argo_points.toLocaleString()} ARGO measurements
                  </div>
                )}
                {argoNearby.length > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      <FiAnchor size={10} style={{ marginRight: 4 }} />
                      {argoNearby.length} nearby float{argoNearby.length > 1 ? 's' : ''}
                    </div>
                    {argoNearby.slice(0, 5).map((f, i) => (
                      <div key={i} style={{ fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                        {f.platform} @ {f.lat.toFixed(1)}°N, {f.lon.toFixed(1)}°E
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="loading-shimmer" style={{ height: 80 }} />
            )}
          </div>

          {/* LLM Narrative */}
          <div className="modal-card modal-card--full">
            <div className="modal-card__title">AI Analysis</div>
            {narrative ? (
              <div className="narrative-block">
                <div className="narrative-block__label">
                  🤖 Groq LLM Narrative
                </div>
                {narrative}
              </div>
            ) : loading ? (
              <div>
                <div className="loading-shimmer" style={{ height: 14, marginBottom: 8 }} />
                <div className="loading-shimmer" style={{ height: 14, width: '90%', marginBottom: 8 }} />
                <div className="loading-shimmer" style={{ height: 14, width: '75%', marginBottom: 8 }} />
                <div className="loading-shimmer" style={{ height: 14, width: '60%' }} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, fontFamily: 'var(--font-mono)' }}>
                  Generating AI analysis…
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                LLM narrative unavailable. The backend may need a GROQ_API_KEY.
              </div>
            )}
          </div>

          {/* Persona Insights Accordion */}
          {personas && (
            <div className="modal-card modal-card--full">
              <div className="modal-card__title">Persona-Tailored Insights</div>
              {Object.entries(personas).map(([key, val]) => (
                <div key={key} className="persona-group">
                  <button
                    className="persona-group__header"
                    onClick={() => setExpandedPersona(expandedPersona === key ? null : key)}
                  >
                    <span>{val.display}</span>
                    <FiChevronDown
                      size={14}
                      className={`persona-group__icon ${expandedPersona === key ? 'persona-group__icon--open' : ''}`}
                    />
                  </button>
                  {expandedPersona === key && (
                    <div className="persona-group__body">
                      {val.bullets.map((b, i) => (
                        <div key={i} className="insight-bullet">
                          <span className="insight-bullet__icon">▸</span>
                          <span>{b}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
