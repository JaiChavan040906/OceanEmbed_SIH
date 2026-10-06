/**
 * CalamityPanel — Marine-Heatwave calamity forecast + LLM disaster analyst.
 *
 * Separate from the pixel-level heatmap view; shows the derived situation-
 * assessment for a whole day:
 *   • Composite risk score (0-100) + label (LOW → CRITICAL)
 *   • 7-day trend sparklines (area%, peak SST anomaly, severe-pixel count)
 *   • Category breakdown (Moderate / Strong / Severe / Extreme pixel counts)
 *   • Rule-based recommendations
 *   • Groq-generated official-style disaster advisory (HEADLINE / SITUATION /
 *     IMPACTS EXPECTED / RECOMMENDED ACTIONS / NEXT UPDATE)
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine,
} from 'recharts';
import { fetchHeatwaveAnalyze, type HeatwaveAnalyzeResponse } from '../api/client';

interface Props {
  date: string;
  onClose: () => void;
}

const RISK_COLOUR: Record<string, string> = {
  LOW:       'var(--status-good)',
  ELEVATED:  'var(--hw-moderate)',
  HIGH:      'var(--hw-strong)',
  CRITICAL:  'var(--hw-severe)',
};

const CAT_COLOUR: Record<string, string> = {
  Moderate: 'var(--hw-moderate)',
  Strong:   'var(--hw-strong)',
  Severe:   'var(--hw-severe)',
  Extreme:  'var(--hw-extreme)',
};

export default function CalamityPanel({ date, onClose }: Props) {
  const [data, setData]       = useState<HeatwaveAnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [withLlm, setWithLlm] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    fetchHeatwaveAnalyze(date, withLlm, 7)
      .then((r) => { if (!cancelled) { setData(r); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(String(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [date, withLlm]);

  // Portal escapes the LeftPanel's transform (which would otherwise trap fixed positioning)
  return createPortal((
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-content" style={{ width: 'min(1000px, 95vw)' }}>
        <div className="modal-content__header">
          <div>
            <div className="modal-content__title">Marine-Heatwave Calamity Analysis</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
              North Indian Ocean · {date} · derived from OceanEmbedV3 predictions
            </div>
          </div>
          <button className="modal-content__close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div className="loading-spinner" style={{ margin: '0 auto 16px' }} />
            <div style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              Assembling 7-day trend + running LLM analyst…
            </div>
          </div>
        )}

        {error && (
          <div className="narrative-block" style={{ borderColor: 'var(--status-poor)', background: 'rgba(239,68,68,0.08)' }}>
            <div className="narrative-block__label" style={{ color: 'var(--status-poor)' }}>Error</div>
            {error}
          </div>
        )}

        {data && !loading && (
          <>
            {/* Top row: risk badge + score + trend label */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div className="modal-card" style={{
                textAlign: 'center',
                borderTop: `3px solid ${RISK_COLOUR[data.risk_label] ?? 'var(--text-muted)'}`,
              }}>
                <div className="modal-card__title">Composite Risk</div>
                <div style={{ fontSize: 46, fontWeight: 700, color: RISK_COLOUR[data.risk_label] ?? 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {data.risk_score.toFixed(0)}
                </div>
                <div style={{ fontSize: 13, letterSpacing: 1.5, color: RISK_COLOUR[data.risk_label], fontWeight: 600 }}>
                  {data.risk_label}
                </div>
              </div>
              <div className="modal-card" style={{ textAlign: 'center' }}>
                <div className="modal-card__title">7-Day Trend</div>
                <div style={{
                  fontSize: 22, fontWeight: 700, marginTop: 8,
                  color: data.trend_label === 'INTENSIFYING' ? 'var(--status-poor)'
                       : data.trend_label === 'DECAYING'    ? 'var(--status-excellent)'
                       :                                       'var(--text-secondary)',
                }}>
                  {data.trend_label === 'INTENSIFYING' && '↗ '}
                  {data.trend_label === 'DECAYING'    && '↘ '}
                  {data.trend_label === 'STABLE'      && '→ '}
                  {data.trend_label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  based on area &amp; peak anomaly ∆
                </div>
              </div>
              <div className="modal-card" style={{ textAlign: 'center' }}>
                <div className="modal-card__title">Basin Coverage Today</div>
                <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--text-accent)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
                  {data.current.area_percent_in_mhw?.toFixed(1) ?? '—'}%
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  ocean area currently in MHW
                </div>
              </div>
            </div>

            {/* Sparklines: area & peak anomaly over 7 days */}
            <div className="modal-card modal-card--full" style={{ marginBottom: 16 }}>
              <div className="modal-card__title">7-Day Trend — basin area in MHW & peak SST anomaly</div>
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer>
                  <LineChart data={data.trend} margin={{ top: 10, right: 30, bottom: 8, left: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left"  tick={{ fontSize: 10 }} label={{ value: 'area %', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} label={{ value: '°C anom', angle: 90, position: 'insideRight', fill: 'var(--text-muted)', fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', fontSize: 12 }} />
                    <ReferenceLine yAxisId="left" y={20} stroke="var(--hw-strong)" strokeDasharray="3 3" />
                    <Line yAxisId="left"  type="monotone" dataKey="area_pct"  stroke="var(--ocean-400)"  strokeWidth={2} dot={false} name="MHW area %" />
                    <Line yAxisId="right" type="monotone" dataKey="max_anom"  stroke="var(--status-poor)" strokeWidth={2} dot={false} name="peak anom °C" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Category breakdown + LLM narrative side-by-side */}
            <div className="modal-grid">
              <div className="modal-card">
                <div className="modal-card__title">Current Category Breakdown</div>
                <div style={{ marginTop: 8 }}>
                  {Object.entries(data.current.categories).map(([label, count]) => (
                    <div key={label} className="readout-row" style={{ borderBottom: '1px dashed var(--border-subtle)' }}>
                      <span className="readout-row__label">
                        <span className="hw-badge" style={{ background: `${CAT_COLOUR[label]}22`, color: CAT_COLOUR[label] }}>
                          {label}
                        </span>
                      </span>
                      <span className="readout-row__value">
                        {count.toLocaleString()} px
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16 }}>
                  <div className="modal-card__title">Rule-Based Actions</div>
                  {data.current.recommendations.map((r, i) => (
                    <div key={i} className="insight-bullet">
                      <span className="insight-bullet__icon">›</span>
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="modal-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div className="modal-card__title" style={{ margin: 0 }}>LLM Disaster Advisory</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    <input type="checkbox" checked={withLlm} onChange={(e) => setWithLlm(e.target.checked)} />
                    AI narrative
                  </label>
                </div>
                {data.llm_advisory
                  ? <div className="narrative-block" style={{ maxHeight: 380, overflowY: 'auto' }}>
                      {data.llm_advisory}
                    </div>
                  : <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 20, textAlign: 'center' }}>
                      LLM advisory disabled — toggle above to generate.
                    </div>}
              </div>
            </div>

            {/* Peak-anomaly readouts */}
            <div style={{ marginTop: 16, display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexWrap: 'wrap' }}>
              <span>peak anomaly today: <b style={{ color: 'var(--status-poor)' }}>{data.current.max_anomaly_C != null ? `${data.current.max_anomaly_C.toFixed(2)} °C` : '—'}</b></span>
              <span>·  mean anomaly: <b style={{ color: 'var(--text-accent)' }}>{data.current.mean_anomaly_C != null ? `${data.current.mean_anomaly_C.toFixed(2)} °C` : '—'}</b></span>
              <span>·  data window: <b>{data.lookback_days} days</b></span>
            </div>
          </>
        )}
      </div>
    </>
  ), document.body);
}
