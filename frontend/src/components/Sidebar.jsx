import { useState, useEffect } from 'react';
import { fetchZoneDetail } from '../utils/api';
import { hasMappedData, currentWeather } from '../utils/dataStatus';

export default function Sidebar({ selectedZone, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setDetail(null); setChecked(null); setError('');
    if (!selectedZone) return;
    const update = async () => {
      setLoading(true);
      try {
        const data = await fetchZoneDetail(selectedZone.id);
        if (!cancelled) { setDetail(data); setError(''); }
      } catch {
        if (!cancelled) { setDetail(null); setError('Data service unavailable. No fallback values are shown.'); }
      } finally {
        if (!cancelled) { setLoading(false); setChecked(new Date().toISOString()); }
      }
    };
    update();
    const timer = setInterval(update, 600000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [selectedZone?.id, refresh]);

  if (!selectedZone) return <aside className="sidebar sidebar-empty">
    <div className="sidebar-header"><h2>Location data</h2><p>Select a Chennai zone to check its latest available data.</p></div>
    <div className="sidebar-hint">Grey zone markers mean verified heat-risk inputs are unavailable.</div>
  </aside>;

  const data = detail?.zone?.id === selectedZone.id ? detail : null;
  const zone = data?.zone ?? selectedZone;
  const mapped = hasMappedData(zone);
  const weather = data?.weather;
  const weatherValid = currentWeather(weather);
  const weatherSource = 'Open-Meteo · weather model, not a local sensor';
  const morphologySource = 'OpenStreetMap / Overpass · mapped features, not a complete survey';
  const missing = loading ? 'Checking source…' : 'Unavailable';
  const weatherState = weatherValid ? (weather.status === 'cached' ? 'Cached · recent' : 'Current API') : 'Unavailable';
  const modelValid = mapped && data?.baseline?.measured === true;
  const mapReason = mapped ? 'API-derived · estimated coverage' : 'Mapping fetch missing or older than 24 hours; fallback estimates hidden.';

  return <aside className="sidebar">
    <div className="sidebar-header">
      <div className="header-row"><h2>{zone.name}</h2><button className="close-btn" onClick={onClose} aria-label="Close location">✕</button></div>
      <p className="zone-desc">Study area · {zone.center.join(', ')}</p>
      <button className="btn-secondary" disabled={loading} onClick={() => setRefresh(n => n + 1)}>{loading ? 'Checking…' : 'Refresh data'}</button>
      <p className="zone-desc">Refreshes every 10 minutes. {checked ? 'Last checked ' + new Date(checked).toLocaleString() : ''}</p>
      {error && <p role="status">{error}</p>}
    </div>
    <section className="data-section">
      <h3>Current weather</h3>
      <p className="zone-desc">{weatherSource} · {weatherState}</p>
      <p className="zone-desc">Valid time: {weather?.observed_at ? weather.observed_at + ' UTC' : 'Unavailable'}</p>
      <div className="metrics-grid">
        <Metric label="Air temperature" value={weatherValid ? weather.air_temp_c : null} unit="°C" missing={missing} />
        <Metric label="Feels like" value={weatherValid ? weather.apparent_temp_c : null} unit="°C" missing={missing} />
        <Metric label="Humidity" value={weatherValid ? weather.humidity_pct : null} unit="%" missing={missing} />
        <Metric label="Wind speed" value={weatherValid ? weather.wind_speed_mps : null} unit=" m/s" missing={missing} />
      </div>
      <p className="zone-desc">Nearby locations may share a weather grid cell.</p>
    </section>
    <section className="data-section">
      <h3>Zone profile</h3>
      <p className="zone-desc">{morphologySource}</p>
      <p className="zone-desc">{mapReason} Fetched: {zone.osm_fetched_at ?? 'Unavailable'}</p>
      <div className="metrics-grid">
        <Metric label="Mapped building coverage" value={mapped ? zone.building_density_pct : null} unit="%" missing={missing} />
        <Metric label="Mapped green coverage" value={mapped ? zone.green_cover_pct : null} unit="%" missing={missing} />
        <Metric label="Estimated road coverage" value={mapped ? zone.road_coverage_pct : null} unit="%" missing={missing} />
        <Metric label="Mapped water distance" value={mapped ? zone.water_proximity_m : null} unit=" m" missing={missing} />
      </div>
      {mapped && <p className="zone-desc">{zone.morphology_note}</p>}
    </section>
    <section className="data-section">
      <h3>Surface temperature & risk</h3>
      <p className="zone-desc">Measured local surface temperature: Unavailable. A dated satellite overlay is not a numerical reading for this zone.</p>
      <div className="metrics-grid">
        <Metric label="Modelled surface temperature" value={modelValid ? zone.lst_celsius : null} unit="°C" missing={missing} />
        <Metric label="Modelled risk score" value={modelValid ? zone.heat_risk_score : null} unit=" / 100" missing={missing} />
      </div>
      <p className="zone-desc">Source: NASA POWER planning baseline + OSM morphology. Calculated estimate, not live measurement. Mapping timestamp: {zone.osm_fetched_at ?? 'Unavailable'}.</p>
    </section>
    <section className="data-section"><h3>Heat diagnosis</h3>
      <p>{modelValid ? 'Computed from API-derived mapping: building coverage ' + zone.building_density_pct + '%, mapped green cover ' + zone.green_cover_pct + '%. These inputs inform the planning model; they do not establish a measured local heat effect.' : 'Unavailable — verified, recent morphology inputs are needed. No fallback diagnosis is shown.'}</p>
    </section>
    <section className="data-section"><h3>Cost & cooling benefits</h3>
      <p>Unavailable — no verified local rate source or validated intervention-effect dataset is connected.</p>
      <p className="zone-desc">Source / date: unavailable. Catalogue prices, projected cooling, and assumed beneficiary counts are hidden.</p>
    </section>
    <section className="data-section"><h3>Population & land ownership</h3>
      <p>Unavailable — census and verified ownership sources are not connected.</p>
      <p className="zone-desc">OSM buildings do not establish population, and institutional land does not establish government ownership.</p>
    </section>
  </aside>;
}

function Metric({ label, value, unit = '', missing = 'Unavailable' }) {
  return <div className="metric-card">
    <div className="metric-value" style={!Number.isFinite(value) ? { fontSize: 15 } : undefined}>{Number.isFinite(value) ? value + unit : missing}</div>
    <div className="metric-label">{label}</div>
  </div>;
}
