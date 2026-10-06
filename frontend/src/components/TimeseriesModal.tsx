import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useOceanStore, DEPTH_TIERS } from '../store/oceanStore';
import { fetchTimeseries, type TimeSeriesResponse } from '../api/client';
import { FiX } from 'react-icons/fi';

export default function TimeseriesModal() {
  const {
    timeseriesModalOpen, setTimeseriesModalOpen,
    coords, depthIdx,
  } = useOceanStore();

  const [data, setData] = useState<TimeSeriesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedDepth, setSelectedDepth] = useState(depthIdx);

  useEffect(() => {
    if (!timeseriesModalOpen) return;
    setSelectedDepth(depthIdx);
  }, [timeseriesModalOpen, depthIdx]);

  useEffect(() => {
    if (!timeseriesModalOpen) return;

    setLoading(true);
    fetchTimeseries(coords.lat, coords.lon, DEPTH_TIERS[selectedDepth])
      .then((r) => {
        setData(r);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [timeseriesModalOpen, coords, selectedDepth]);

  if (!timeseriesModalOpen) return null;

  const chartData = data
    ? data.dates.map((d, i) => ({
        date: d,
        predicted: data.predicted_C[i],
        glorys: data.glorys_C[i],
      }))
    : [];

  // Show every nth tick to avoid clutter
  const tickInterval = Math.max(1, Math.floor(chartData.length / 12));

  return (
    <>
      <div className="modal-backdrop" onClick={() => setTimeseriesModalOpen(false)} />
      <div className="modal-content" id="timeseries-modal" style={{ maxWidth: 850 }}>
        <div className="modal-content__header">
          <h2 className="modal-content__title">
            Time Series — {coords.lat.toFixed(2)}°N, {coords.lon.toFixed(2)}°E
          </h2>
          <button className="modal-content__close" onClick={() => setTimeseriesModalOpen(false)}>
            <FiX />
          </button>
        </div>

        {/* Depth selector */}
        <div style={{ marginBottom: 20 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            fontSize: 12, color: 'var(--text-muted)',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
              Depth
            </span>
            <select
              className="select-field"
              style={{ width: 140 }}
              value={selectedDepth}
              onChange={(e) => setSelectedDepth(Number(e.target.value))}
            >
              {DEPTH_TIERS.map((d, i) => (
                <option key={d} value={i}>{d} m</option>
              ))}
            </select>
            {data && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-accent)' }}>
                {data.depth_m} m actual
              </span>
            )}
          </div>
        </div>

        {/* Chart */}
        {loading ? (
          <div className="loading-shimmer" style={{ height: 300 }} />
        ) : chartData.length > 0 ? (
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 30, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(56,78,120,0.3)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#64748b', fontSize: 9 }}
                  interval={tickInterval}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  label={{ value: 'Temperature (°C)', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8', fontSize: 11 } }}
                />
                <Tooltip
                  contentStyle={{
                    background: '#131b2e', border: '1px solid rgba(56,78,120,0.3)',
                    borderRadius: 8, fontSize: 12, fontFamily: 'JetBrains Mono',
                  }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="predicted" stroke="#0ea5e9" strokeWidth={1.5} dot={false} name="Model" />
                <Line type="monotone" dataKey="glorys" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="GLORYS" strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
            No data available for this location and depth.
          </div>
        )}

        {/* Stats */}
        {data && chartData.length > 0 && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
            marginTop: 20,
          }}>
            {[
              { label: 'Data Points', value: data.dates.length.toString() },
              { label: 'Period', value: `${data.dates[0]} — ${data.dates[data.dates.length - 1]}` },
              { label: 'Actual Depth', value: `${data.depth_m} m` },
            ].map((s) => (
              <div key={s.label} style={{
                background: 'var(--bg-elevated)', borderRadius: 8, padding: 12,
                border: '1px solid var(--border-subtle)',
              }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', marginBottom: 4 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
