import { useEffect, useState } from 'react';
import { useOceanStore } from '../store/oceanStore';
import { fetchHealth } from '../api/client';
import { FiActivity } from 'react-icons/fi';

export default function Navbar() {
  const backendOnline = useOceanStore((s) => s.backendOnline);
  const setBackendOnline = useOceanStore((s) => s.setBackendOnline);
  const [showAbout, setShowAbout] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        await fetchHealth();
        setBackendOnline(true);
      } catch {
        setBackendOnline(false);
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [setBackendOnline]);

  return (
    <>
      <nav className="navbar" id="navbar">
        <div className="navbar__logo">
          <FiActivity size={16} />
        </div>
        <div>
          <div className="navbar__title">OceanEmbed</div>
          <div className="navbar__subtitle">North Indian Ocean • Subsurface Intelligence</div>
        </div>
        <div
          className={`navbar__health ${!backendOnline ? 'navbar__health--offline' : ''}`}
          title={backendOnline ? 'Backend connected' : 'Backend offline'}
        />
        <button
          className="btn btn--ghost"
          style={{ marginLeft: 8, fontSize: 11, padding: '4px 10px' }}
          onClick={() => setShowAbout(!showAbout)}
        >
          About
        </button>
      </nav>

      {showAbout && (
        <>
          <div className="modal-backdrop" onClick={() => setShowAbout(false)} />
          <div className="modal-content" style={{ maxWidth: 520 }}>
            <div className="modal-content__header">
              <h2 className="modal-content__title">About OceanEmbed</h2>
              <button className="modal-content__close" onClick={() => setShowAbout(false)}>×</button>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
              <p style={{ marginBottom: 12 }}>
                <strong style={{ color: 'var(--text-primary)' }}>OceanEmbed</strong> is an AI-powered
                subsurface ocean temperature reconstruction system for the North Indian Ocean
                (5°N–30°N, 45°E–105°E).
              </p>
              <p style={{ marginBottom: 12 }}>
                It uses a hybrid <strong style={{ color: 'var(--text-accent)' }}>CNN + Vision Transformer + 
                Cross-Attention + Depth Transformer</strong> architecture (OceanEmbedV3) to predict 
                subsurface temperatures at 15 standard depths (0–1000 m) from 8 daily satellite 
                surface observations.
              </p>
              <p style={{ marginBottom: 12 }}>
                Features include marine heatwave detection (Hobday et al. 2016), real-time ARGO 
                float validation, persona-tailored insights for 7 user types, and AI-powered 
                analysis via Groq LLM.
              </p>
              <div style={{
                padding: '10px 14px',
                background: 'var(--bg-deep)',
                borderRadius: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-muted)',
              }}>
                Model: OceanEmbedV3 • 33.4M params • Mean RMSE ~0.643 °C
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
