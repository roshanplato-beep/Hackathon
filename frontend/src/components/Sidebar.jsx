import { useState, useEffect } from 'react';
import { fetchZoneDetail, diagnoseZone, simulateIntervention, generateReport, fetchLiveClimate } from '../utils/api';
import { getRiskBadgeColor } from '../utils/colors';
import InterventionCard from './InterventionCard';
import CostDashboard from './CostDashboard';
import DataBadge from './DataBadge';

export default function Sidebar({
  selectedZone,
  onClose,
  onSimulate,
  simulationData,
  onClearSimulation,
}) {
  const [detail, setDetail] = useState(null);
  const [diagnosis, setDiagnosis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [diagLoading, setDiagLoading] = useState(false);
  const [activeSimulation, setActiveSimulation] = useState(null);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [live, setLive] = useState(null);

  useEffect(() => {
    if (!selectedZone) {
      setDetail(null);
      setDiagnosis(null);
      setActiveSimulation(null);
      setReport(null);
      return;
    }
    setLoading(true);
    setDiagnosis(null);
    setActiveSimulation(null);
    setReport(null);
    fetchZoneDetail(selectedZone.id)
      .then(setDetail)
      .catch(console.error)
      .finally(() => setLoading(false));

    setDiagLoading(true);
    diagnoseZone(selectedZone.id)
      .then(setDiagnosis)
      .catch(console.error)
      .finally(() => setDiagLoading(false));

    setLive(null);
    fetchLiveClimate(selectedZone.id)
      .then(d => setLive(d.readings?.[0] ?? null))
      .catch(() => setLive(null));
  }, [selectedZone?.id]);

  const handleSimulate = async (interventionId) => {
    if (activeSimulation === interventionId) {
      setActiveSimulation(null);
      onClearSimulation();
      return;
    }
    try {
      const result = await simulateIntervention(selectedZone.id, interventionId);
      setActiveSimulation(interventionId);
      onSimulate(result);
    } catch (err) {
      console.error(err);
    }
  };

  const handleReport = async () => {
    setReportLoading(true);
    try {
      const result = await generateReport(selectedZone.id);
      setReport(result.report);
    } catch (err) {
      console.error(err);
    } finally {
      setReportLoading(false);
    }
  };

  if (!selectedZone) {
    return (
      <div className="sidebar sidebar-empty">
        <div className="sidebar-header">
          <h2>HeatScape</h2>
          <p className="subtitle">Urban Heat Reduction Planner</p>
        </div>
        <div className="sidebar-hint">
          <div className="hint-icon">🗺️</div>
          <p>Click any zone on the map to analyze heat conditions and explore cooling interventions.</p>
          <div className="legend">
            <h4>Heat Risk Scale</h4>
            <div className="legend-items">
              <span><i style={{ background: '#dc2626' }}></i> Critical (75+)</span>
              <span><i style={{ background: '#ea580c' }}></i> High (55–74)</span>
              <span><i style={{ background: '#d97706' }}></i> Moderate (35–54)</span>
              <span><i style={{ background: '#16a34a' }}></i> Low (&lt;35)</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const zone = detail?.zone || selectedZone;
  const interventions = detail?.interventions || [];
  const badgeColor = getRiskBadgeColor(zone.risk_level);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="header-row">
          <h2>{zone.name}</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <p className="zone-desc">{zone.description}</p>
      </div>

      {/* Heat metrics */}
      <div className="metrics-grid">
        <div className="metric-card metric-temp">
          <div className="metric-value">{zone.lst_celsius}°C</div>
          <div className="metric-label">
            Surface temp
            <DataBadge
              kind="modelled"
              compact
              source="Morphology model: measured NASA POWER city baseline adjusted by measured OSM building density, green cover, roads and water proximity. Not a satellite pixel reading."
            />
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-value">
            {live?.air_temp_c !== undefined && live?.air_temp_c !== null
              ? `${live.air_temp_c}°C`
              : '—'}
          </div>
          <div className="metric-label">
            Air temp, live
            <DataBadge
              kind="measured"
              compact
              source={
                live
                  ? `Open-Meteo 2m air temperature, observed ${live.observed_at} UTC on a ~11km grid.`
                  : 'Open-Meteo 2m air temperature.'
              }
            />
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{zone.heat_risk_score}</div>
          <div className="metric-label">
            Risk score
            <DataBadge
              kind="modelled"
              compact
              source="Weighted index over modelled surface temp, NDVI proxy, and measured OSM morphology."
            />
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-value" style={{
            background: badgeColor.bg,
            color: badgeColor.text,
            padding: '2px 10px',
            borderRadius: '12px',
            fontSize: '14px',
          }}>
            {zone.risk_level}
          </div>
          <div className="metric-label">Risk Level</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">+{(zone.lst_celsius - 33.6).toFixed(1)}°C</div>
          <div className="metric-label">vs City Avg</div>
        </div>
      </div>

      {/* Live Weather */}
      {detail?.weather && (
        <div className="weather-bar">
          <span>🌡️ {detail.weather.temp_celsius}°C</span>
          <span>💧 {detail.weather.humidity_pct}%</span>
          <span>💨 {detail.weather.wind_speed_mps} m/s</span>
          <span className="weather-source">
            {detail.weather.source === 'openweathermap_live' ? '🟢 Live' : '📊 Avg'}
          </span>
          {detail.weather.heat_warning && (
            <span className="heat-warning">⚠️ {detail.weather.heat_warning}</span>
          )}
        </div>
      )}

      {/* Zone data breakdown */}
      <div className="data-section">
        <h3>
          Zone Profile
          <DataBadge kind={zone.osm_fetched ? 'measured' : 'modelled'} compact source={zone.osm_fetched ? 'OpenStreetMap via Overpass API' : 'Existing project fallback estimates; OSM survey not verified'} />
        </h3>
        <div className="data-bars">
          <DataBar label="Building Density" value={zone.building_density_pct} unit="%" color="#ef4444" />
          <DataBar label="Green Cover" value={zone.green_cover_pct} unit="%" color="#22c55e" />
          <DataBar label="Road Coverage" value={zone.road_coverage_pct} unit="%" color="#6b7280" />
          <DataBar
            label="NDVI (proxy)"
            value={zone.ndvi}
            unit=""
            max={1}
            color="#22c55e"
            badge="modelled"
            badgeSource="Linear proxy from measured OSM green cover, not a spectral index from satellite bands."
          />
        </div>
        <div className="zone-stats">
          <span>🏘️ ~{Math.round(zone.estimated_population || 0).toLocaleString()} residents</span>
          <span>💧 Water: {zone.water_proximity_m}m away</span>
          <span>🏛️ Govt land: {zone.govt_land_pct}%</span>
        </div>
      </div>

      {/* AI Diagnosis */}
      <div className="data-section">
        <h3>🤖 AI Heat Diagnosis</h3>
        {diagLoading ? (
          <div className="loading-text">Analyzing zone...</div>
        ) : diagnosis ? (
          <div className="diagnosis">
            <p className="primary-cause">{diagnosis.diagnosis.primary_cause}</p>
            <ul className="factors">
              {diagnosis.diagnosis.contributing_factors?.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
            <p className="urban-context">{diagnosis.diagnosis.urban_context}</p>
            <p className="comparison">{diagnosis.diagnosis.comparison}</p>
          </div>
        ) : (
          <div className="loading-text">No diagnosis available</div>
        )}
      </div>

      {/* Interventions */}
      {loading ? (
        <div className="loading-text">Loading interventions...</div>
      ) : (
        <div className="data-section">
          <h3>🛠️ Recommended Interventions</h3>
          <div className="interventions-list">
            {interventions.map((intv, i) => (
              <InterventionCard
                key={intv.id}
                intervention={intv}
                rank={i + 1}
                isActive={activeSimulation === intv.id}
                onSimulate={() => handleSimulate(intv.id)}
                simulationData={activeSimulation === intv.id ? simulationData : null}
              />
            ))}
          </div>
        </div>
      )}

      {/* Cost-benefit dashboard */}
      {interventions.length > 0 && (
        <div className="data-section">
          <h3>📊 Cost-Benefit Analysis</h3>
          <CostDashboard interventions={interventions} zone={zone} />
        </div>
      )}

      {/* Government feasibility */}
      <div className="data-section">
        <h3>🏛️ Government Feasibility</h3>
        <div className="gov-panel">
          <div className="gov-item">
            <span className="gov-label">Ward-level actions</span>
            <span className="gov-value">
              {interventions.filter(i => i.authority === 'ward').map(i => i.name).join(', ') || 'None'}
            </span>
          </div>
          <div className="gov-item">
            <span className="gov-label">Zone approval needed</span>
            <span className="gov-value">
              {interventions.filter(i => i.authority === 'zone').map(i => i.name).join(', ') || 'None'}
            </span>
          </div>
          <div className="gov-item">
            <span className="gov-label">City-level project</span>
            <span className="gov-value">
              {interventions.filter(i => i.authority === 'city').map(i => i.name).join(', ') || 'None'}
            </span>
          </div>
          <div className="gov-item">
            <span className="gov-label">Available govt land</span>
            <span className="gov-value">{(zone.govt_land_area_sqm || 0).toLocaleString()} sqm</span>
          </div>
          <div className="gov-item">
            <span className="gov-label">Est. beneficiaries</span>
            <span className="gov-value">{Math.round(zone.estimated_population || 0).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Report generation */}
      <div className="data-section">
        <button className="report-btn" onClick={handleReport} disabled={reportLoading}>
          {reportLoading ? '⏳ Generating...' : '📄 Generate Ward Report'}
        </button>
        {report && (
          <div className="report">
            <h4>{report.title}</h4>
            <p>{report.executive_summary}</p>
            <p>{report.current_situation}</p>
            <h5>Recommendations:</h5>
            {report.recommendations?.map((rec, i) => (
              <div key={i} className="rec-item">
                <strong>#{rec.priority} {rec.intervention}</strong>
                <ul>
                  {rec.action_steps?.map((step, j) => <li key={j}>{step}</li>)}
                </ul>
                <span className="rec-meta">
                  Timeline: {rec.timeline} | Authority: {rec.authority_needed}
                </span>
              </div>
            ))}
            <p className="budget">{report.budget_summary}</p>
            <p>{report.implementation_notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DataBar({ label, value, unit, color, max = 100, badge, badgeSource }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="data-bar">
      <div className="data-bar-header">
        <span>
          {label}
          {badge && <DataBadge kind={badge} compact source={badgeSource} />}
        </span>
        <span>{typeof value === 'number' ? (unit ? `${value}${unit}` : value.toFixed(2)) : value}</span>
      </div>
      <div className="data-bar-track">
        <div className="data-bar-fill" style={{ width: `${pct}%`, background: color }}></div>
      </div>
    </div>
  );
}
