"""User-persona layer.

Turns the raw model output (subsurface T + surface state + heatwave + ARGO
validation) into short, audience-specific insight lines and gives Groq the
right voice for each audience.
"""
from __future__ import annotations
import numpy as np


# ─────────────────────────────── persona configuration
PERSONAS: dict[str, dict] = {
    'fisheries': {
        'display':  'Fisheries operator',
        'system':   ('You are advising commercial and small-scale fisheries in the North '
                     'Indian Ocean. Focus on fish-habitat proxies: thermocline depth (D20), '
                     'mixed-layer depth, upwelling signatures, SST anomalies that displace '
                     'tuna/mackerel/sardine schools, chlorophyll-friendly conditions.'),
    },
    'oceanographer': {
        'display':  'Research oceanographer',
        'system':   ('You are a research oceanographer. Use technical vocabulary: geostrophic '
                     'currents, Ekman pumping, Kelvin/Rossby waves, mesoscale eddies, MLD, '
                     'BLT, isothermal-layer depth. Cite the model’s uncertainty when relevant.'),
    },
    'navy': {
        'display':  'Naval operations',
        'system':   ('You are advising naval operations. Focus on sonar propagation: sound-'
                     'speed profile, surface duct, sonic layer depth, deep sound channel, '
                     'thermocline sharpness (submarine hiding layers), shadow zones. Be terse '
                     'and operational; no marketing language.'),
    },
    'ongc': {
        'display':  'Offshore energy (ONGC-style)',
        'system':   ('You are advising offshore oil-and-gas operators on the NIO shelf. Focus '
                     'on: subsurface current magnitude at platform depths (50-200 m), '
                     'thermal stress on risers, cyclone-forced mixing risk, monsoon '
                     'operational windows, diver-safety thermocline depth.'),
    },
    'shipping': {
        'display':  'Shipping / maritime',
        'system':   ('You are advising commercial shipping and maritime logistics. Focus on '
                     'surface currents (fuel routing), wind, sea state, cyclone risk, '
                     'monsoon corridors.'),
    },
    'coastal_mgmt': {
        'display':  'Coastal management / disaster response',
        'system':   ('You are advising coastal-state disaster managers and coral-reef managers. '
                     'Focus on marine heatwaves, coral bleaching thresholds, storm-surge '
                     'preconditioning, coastal upwelling, cyclone precursors.'),
    },
    'general': {
        'display':  'General public',
        'system':   ('You are explaining ocean conditions to a curious member of the public. '
                     'Plain English, no jargon; when you use a term, define it in half a '
                     'sentence. Be honest about uncertainty.'),
    },
}

DEFAULT_PERSONA = 'general'


def persona_system(persona: str) -> str:
    return PERSONAS.get(persona, PERSONAS[DEFAULT_PERSONA])['system']


# ─────────────────────────────── rule-based one-liners
def one_liners(context: dict) -> dict[str, list[str]]:
    """Return persona → list of short bullet points, computed from `context`.

    Expected keys in `context` (all optional; use what you have):
      sst_C, sst_anomaly_C, heatwave_category    (str e.g. 'Moderate' or 'None')
      profile_depths_m (list[int]), profile_temp_C (list[float])
      u_cur, v_cur                              (surface currents at pixel, m/s)
      u_wind, v_wind                            (wind, m/s)
      d20_m                                      (20 °C isotherm depth in m; None if not computable)
      confidence_score, confidence_label        (from /api/argo/validate)
    """
    sst   = context.get('sst_C')
    anom  = context.get('sst_anomaly_C')
    hw    = context.get('heatwave_category', 'None')
    d20   = context.get('d20_m')
    depths = np.asarray(context.get('profile_depths_m', []), dtype='float32')
    tprof  = np.asarray(context.get('profile_temp_C',  []), dtype='float32')
    ucur, vcur = context.get('u_cur'), context.get('v_cur')
    conf  = context.get('confidence_score')

    # derived features
    thermocline_shape = _describe_thermocline(depths, tprof)
    cur_speed = None
    if ucur is not None and vcur is not None:
        cur_speed = float(np.hypot(ucur, vcur))

    out: dict[str, list[str]] = {}

    # ── FISHERIES
    f = []
    if d20:
        if d20 < 60:  f.append(f'D20 shallow ({d20:.0f} m) — upwelling likely; expect small-pelagic aggregation (mackerel, sardine).')
        elif d20 > 150: f.append(f'D20 deep ({d20:.0f} m) — thick warm layer; skipjack/yellowfin habitat pushed south.')
        else:         f.append(f'D20 near-normal ({d20:.0f} m) — typical thermocline; steady fishing conditions.')
    if hw in ('Strong','Severe','Extreme'):
        f.append(f'Marine heatwave ({hw}) — surface species stressed; catch may drop 20-40 %.')
    if anom is not None and anom > 1.0:
        f.append(f'SST anomaly +{anom:.1f} °C — reef-associated species may move deeper for cooler water.')
    if cur_speed and cur_speed > 0.5:
        f.append(f'Strong surface current ({cur_speed:.2f} m/s) — trawling drift risk; deploy heavier ground gear.')
    if not f:
        f.append('Ocean state normal; standard operating window.')
    out['fisheries'] = f

    # ── OCEANOGRAPHER
    o = []
    if thermocline_shape:
        o.append(thermocline_shape)
    if d20:
        o.append(f'D20 = {d20:.0f} m (integrated upper-layer heat proxy).')
    if anom is not None:
        o.append(f'SST anomaly {anom:+.2f} °C vs 2014-2024 climatology.')
    if cur_speed and cur_speed > 0.4:
        o.append(f'Surface geostrophic-scale flow {cur_speed:.2f} m/s — possible mesoscale eddy edge.')
    if conf is not None:
        o.append(f'Independent ARGO agreement: {conf:.1f}/100.')
    if not o:
        o.append('Quiescent ocean state.')
    out['oceanographer'] = o

    # ── NAVY (sonar-focused)
    n = []
    if depths.size and tprof.size:
        sld = _sonic_layer_depth(depths, tprof)
        if sld is not None:
            n.append(f'Sonic layer ~ {sld:.0f} m — surface-duct propagation likely above this depth.')
    if d20:
        n.append(f'Strong thermocline near {d20:.0f} m — potential submarine hiding layer (large TL below).')
    if anom is not None and anom > 1.0:
        n.append(f'Warm surface anomaly +{anom:.1f} °C — surface duct thickens; convergence-zone ranges shift.')
    if not n:
        n.append('Sound-speed profile within nominal envelope.')
    out['navy'] = n

    # ── ONGC / offshore
    e = []
    if cur_speed and cur_speed > 0.6:
        e.append(f'High surface current ({cur_speed:.2f} m/s) — riser fatigue risk; consider ROV-window replan.')
    if d20 and d20 > 150:
        e.append(f'Deep warm layer ({d20:.0f} m) — subsurface thermal stress on production risers below D20.')
    if hw in ('Severe','Extreme'):
        e.append(f'Severe heatwave — expect cyclogenesis window; review cyclone-preparedness state.')
    if 6 <= _current_month() <= 9:
        e.append('SW-monsoon season: heavy sea-state; check platform standby-vessel readiness.')
    if not e:
        e.append('Nominal offshore operating conditions.')
    out['ongc'] = e

    # ── SHIPPING
    s = []
    if cur_speed:
        s.append(f'Surface current {cur_speed:.2f} m/s — {"consider routing along current" if cur_speed>0.3 else "minor drift"}.')
    if hw in ('Severe','Extreme'):
        s.append('Heatwave zone — increased cyclone risk; verify weather routing.')
    if not s:
        s.append('Sea state within routine.')
    out['shipping'] = s

    # ── COASTAL MANAGEMENT
    c = []
    if hw in ('Moderate','Strong'):
        c.append(f'Marine heatwave: {hw} — issue coral-bleaching watch for Lakshadweep/Andaman reefs.')
    if hw in ('Severe','Extreme'):
        c.append(f'{hw.upper()} heatwave — activate coastal-state DMA coordination.')
    if anom is not None and anom > 2.0:
        c.append(f'SST anomaly +{anom:.1f} °C — precondition for cyclone intensification.')
    if not c:
        c.append('No active coastal-hazard advisory from this pixel.')
    out['coastal_mgmt'] = c

    # ── GENERAL
    g = []
    if sst is not None:
        g.append(f'Surface water is {sst:.1f} °C.')
    if d20:
        g.append(f'The warm surface layer (>20 °C) is about {d20:.0f} m thick here.')
    if hw != 'None':
        g.append(f'This area is currently in a {hw.lower()} marine heatwave.')
    if conf is not None:
        g.append(f'The model agrees with real ARGO buoys at {conf:.0f}% confidence.')
    if not g:
        g.append('Ocean conditions look typical for this time of year.')
    out['general'] = g

    return out


# ─────────────────────────────── helpers
def _describe_thermocline(depths, tprof) -> str | None:
    if depths.size < 3 or tprof.size < 3: return None
    # gradient across 20-100 m
    m = (depths >= 20) & (depths <= 150)
    if m.sum() < 2: return None
    dz = np.gradient(tprof[m], depths[m])
    peak = float(np.min(dz))     # most negative = steepest
    z_peak = float(depths[m][int(np.argmin(dz))])
    return f'Thermocline peaks at ~{z_peak:.0f} m with dT/dz = {peak:.3f} °C/m.'


def _sonic_layer_depth(depths, tprof) -> float | None:
    """Very rough SLD proxy: depth of the temperature maximum in the upper 200 m."""
    if depths.size == 0 or tprof.size == 0: return None
    m = depths <= 200
    if m.sum() == 0: return None
    return float(depths[m][int(np.argmax(tprof[m]))])


def _current_month() -> int:
    import datetime as _dt
    return _dt.datetime.utcnow().month
