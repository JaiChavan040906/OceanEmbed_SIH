import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchToday,
  fetchMeta,
  fetchHeatwave,
  fetchProfile,
  fetchInsights,
  type MetaResponse,
  type HeatwaveResponse,
  type ProfileResponse,
  type InsightsResponse,
} from '../api/client';
import OceanHero from './OceanHero';
import './landing.css';

type Kpi = {
  todayLabel: string;
  mappedDate: string | null;
  sstC: number | null;
  meanAnomC: number | null;
  mhwAreaPct: number | null;
  category: string | null;
};

// Central Arabian Sea sample point — used for the KPI + insights.
const SAMPLE_LAT = 15.0;
const SAMPLE_LON = 68.0;

const round1 = (x: number | null | undefined) =>
  x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 10) / 10;

export default function Landing() {
  const [kpi, setKpi] = useState<Kpi>({
    todayLabel: '—',
    mappedDate: null,
    sstC: null,
    meanAnomC: null,
    mhwAreaPct: null,
    category: null,
  });
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [insights, setInsights] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [today, m] = await Promise.all([fetchToday(), fetchMeta()]);
        setMeta(m);

        const date = today.mapped_date || m.date_max || m.date_min;
        if (!date) return;

        const [hw, prof, ins] = await Promise.all([
          fetchHeatwave(date, false).catch(() => null as HeatwaveResponse | null),
          fetchProfile(date, SAMPLE_LAT, SAMPLE_LON).catch(() => null as ProfileResponse | null),
          fetchInsights(date, SAMPLE_LAT, SAMPLE_LON, 'all').catch(
            () => null as InsightsResponse | null,
          ),
        ]);

        setKpi({
          todayLabel: today.today,
          mappedDate: date,
          sstC: round1(prof?.predicted_C?.[0] ?? null),
          meanAnomC: round1(hw?.summary?.mean_anomaly_C ?? null),
          mhwAreaPct: round1(hw?.summary?.area_percent_in_mhw ?? null),
          category:
            hw?.summary?.categories
              ? Object.entries(hw.summary.categories).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
              : null,
        });

        // Collapse persona bullets into a flat one-liner list, take the punchiest.
        if (ins?.personas) {
          const bullets: string[] = [];
          for (const p of Object.values(ins.personas)) {
            for (const b of p.bullets) bullets.push(b);
          }
          setInsights(bullets.slice(0, 4));
        }
        setOnline(true);
      } catch {
        setOnline(false);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  return (
    <div className="landing">
      {/* Top-left brand */}
      <header className="landing__nav">
        <div className="landing__brand">
          <CompassMark />
          <span className="landing__brand-name">OceanEmbed</span>
        </div>
        <nav className="landing__nav-links">
          <a href="#models">MODELS</a>
          <a href="#datasets">DATASETS</a>
          <a href="#methodology">METHODOLOGY</a>
          <a href="#about">ABOUT US</a>
        </nav>
        <Link to="/dashboard" className="landing__cta-pill">
          + LAUNCH TERMINAL
        </Link>
      </header>

      {/* Hero background — stylized ocean map */}
      <OceanHero />

      {/* Hero copy */}
      <section className="landing__hero">
        <h1 className="landing__title">
          REDEFINING THE FUTURE<br />OF OCEAN INTELLIGENCE
        </h1>
        <p className="landing__lede">
          Our mission is to reconstruct what surface satellites cannot see —
          delivering daily subsurface temperature for every pixel of the North
          Indian Ocean, from 0 m to 1000 m depth.
        </p>
        <Link to="/dashboard" className="landing__work-btn">
          Explore the Terminal <span aria-hidden>→</span>
        </Link>
      </section>

      {/* Terminal init card */}
      <aside className="landing__panel">
        <div className="landing__panel-head">
          <span className="landing__panel-tag">[ INITIALIZE TERMINAL ]</span>
          <Link to="/dashboard" className="landing__panel-x" aria-label="Skip to terminal">
            <XMark />
          </Link>
        </div>
        <p className="landing__panel-blurb">
          Configure analysis parameters to reconstruct subsurface ocean
          temperature from surface satellite observations.
        </p>

        <ParamRow
          label="REGION (NORTH INDIAN OCEAN)"
          value={
            meta
              ? `${meta.bbox.lat_min}°N – ${meta.bbox.lat_max}°N, ${meta.bbox.lon_min}°E – ${meta.bbox.lon_max}°E`
              : '5°N – 30°N, 45°E – 105°E'
          }
          icon={<PinMark />}
        />
        <ParamRow label="SPATIAL RESOLUTION" value="0.25° × 0.25°" icon={<GridMark />} />
        <ParamRow label="TEMPORAL RESOLUTION" value="DAILY" icon={<CalMark />} />
        <ParamRow
          label="DEPTH LEVELS (m)"
          value="0, 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000"
          icon={<DepthMark />}
        />
        <ParamRow
          label="INPUT VARIABLES"
          value="SST, SSS, SSH/SLA, SURFACE CURRENTS (U,V), SURFACE WINDS (U,V)"
          icon={<WaveMark />}
        />

        <Link to="/dashboard" className="landing__panel-init">
          INITIALIZE TERMINAL <span aria-hidden>→</span>
        </Link>
      </aside>

      {/* KPI strip */}
      <section className="landing__kpi">
        <div className="landing__kpi-head">
          <span className="landing__eyebrow">TODAY&apos;S PREDICTION</span>
          <span className="landing__eyebrow landing__eyebrow--muted">
            {kpi.mappedDate ?? '—'} · SAMPLE 15°N 68°E · {online ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
        <div className="landing__kpi-row">
          <KpiTile
            label="SURFACE TEMP (0 m)"
            value={fmtC(kpi.sstC)}
            hint="Model-reconstructed SST at central Arabian Sea pixel"
            loading={!loaded}
          />
          <KpiTile
            label="MEAN SST ANOMALY"
            value={fmtC(kpi.meanAnomC, true)}
            hint="Vs. 30-day climatology across region"
            loading={!loaded}
            trend={kpi.meanAnomC != null ? (kpi.meanAnomC > 0 ? 'up' : 'down') : undefined}
          />
          <KpiTile
            label="AREA IN MARINE HEATWAVE"
            value={kpi.mhwAreaPct != null ? `${kpi.mhwAreaPct}%` : '—'}
            hint="Share of region flagged Moderate+ today"
            loading={!loaded}
          />
          <KpiTile
            label="DOMINANT CATEGORY"
            value={(kpi.category ?? 'none').toUpperCase()}
            hint="Most common heatwave class over water pixels"
            loading={!loaded}
          />
        </div>
      </section>

      {/* Derived one-liners */}
      <section className="landing__insights" id="insights">
        <div className="landing__insights-head">
          <span className="landing__eyebrow">DERIVED INSIGHTS · FOR FISHERIES & OCEANOGRAPHERS</span>
          <Link to="/dashboard" className="landing__insights-more">
            SEE ALL IN TERMINAL →
          </Link>
        </div>
        <div className="landing__insights-grid">
          {loaded && insights.length > 0 ? (
            insights.map((t, i) => (
              <InsightCard key={i} idx={i + 1} text={t} />
            ))
          ) : (
            <>
              <InsightCard idx={1} text="Warm anomalies compressing the mixed layer &mdash; expect surface catch concentration." loading={!loaded} />
              <InsightCard idx={2} text="Sub-thermocline cooler than climatology; deep-water species may shift shallower." loading={!loaded} />
              <InsightCard idx={3} text="Elevated MHW area recommends caution for reef & coastal aquaculture operations." loading={!loaded} />
              <InsightCard idx={4} text="SSH gradient consistent with active mesoscale eddy — productive front nearby." loading={!loaded} />
            </>
          )}
        </div>
      </section>

      {/* Corner treatment */}
      <div className="landing__corner">
        CONNECT.<br />CONTROL.<br />COMMAND.<br />
        <span className="landing__corner-em">EXPERIENCE OCEANEMBED.</span>
      </div>
    </div>
  );
}

// ─── small pieces ─────────────────────────────────────────

function ParamRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="param-row">
      <div className="param-row__label">{label}</div>
      <div className="param-row__field">
        <span className="param-row__icon">{icon}</span>
        <span className="param-row__value">{value}</span>
        <ChevronMark />
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  hint,
  loading,
  trend,
}: {
  label: string;
  value: string;
  hint: string;
  loading?: boolean;
  trend?: 'up' | 'down';
}) {
  return (
    <div className="kpi-tile">
      <div className="kpi-tile__label">{label}</div>
      <div className={`kpi-tile__value ${loading ? 'kpi-tile__value--loading' : ''}`}>
        {loading ? '…' : value}
        {trend && !loading && (
          <span className={`kpi-tile__trend kpi-tile__trend--${trend}`}>
            {trend === 'up' ? '▲' : '▼'}
          </span>
        )}
      </div>
      <div className="kpi-tile__hint">{hint}</div>
    </div>
  );
}

function InsightCard({ idx, text, loading }: { idx: number; text: string; loading?: boolean }) {
  return (
    <div className={`insight-card ${loading ? 'insight-card--loading' : ''}`}>
      <span className="insight-card__idx">0{idx}</span>
      <span className="insight-card__text" dangerouslySetInnerHTML={{ __html: text }} />
    </div>
  );
}

// ─── icon marks (inline SVG, theme-safe) ──────────────────

function CompassMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      <path d="M12 8l2 4-2 4-2-4z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function XMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}
function PinMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}
function GridMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="4" width="16" height="16" />
      <path d="M4 10h16M4 16h16M10 4v16M16 4v16" />
    </svg>
  );
}
function CalMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="16" rx="1" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </svg>
  );
}
function DepthMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3v18M8 6l4-3 4 3M8 18l4 3 4-3" />
    </svg>
  );
}
function WaveMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 9c3 0 3-2 6-2s3 2 6 2 3-2 6-2M3 15c3 0 3-2 6-2s3 2 6 2 3-2 6-2" />
    </svg>
  );
}
function ChevronMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// ─── formatting ───────────────────────────────────────────

function fmtC(v: number | null, signed = false): string {
  if (v === null || v === undefined) return '—';
  const s = signed && v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
  return `${s} °C`;
}
