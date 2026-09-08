import { CATEGORY_COLORS, CATEGORY_LABELS } from '../utils/colors';

export default function InterventionCard({ intervention, rank, isActive, onSimulate, simulationData }) {
  const intv = intervention;
  const catColor = CATEGORY_COLORS[intv.category];
  const catLabel = CATEGORY_LABELS[intv.category];
  const tempDrop = intv.temp_drop || intv.temp_drop_ambient || intv.max_drop || 0;
  const cost = intv.estimated_cost_inr || 0;

  return (
    <div className={`intervention-card ${isActive ? 'active' : ''}`}>
      <div className="intv-header">
        <div className="intv-rank">#{rank}</div>
        <div className="intv-title">
          <span className="intv-icon">{intv.icon}</span>
          <span className="intv-name">{intv.name}</span>
          {intv.most_cost_efficient && (
            <span className="intv-badge best">⚡ Most Cost-Efficient</span>
          )}
        </div>
      </div>

      <div className="intv-category" style={{ color: catColor }}>
        {catLabel}
      </div>

      <div className="intv-metrics">
        <div className="intv-metric">
          <span className="intv-metric-value" style={{ color: '#22c55e' }}>
            -{tempDrop}°C
          </span>
          <span className="intv-metric-label">Temp Drop</span>
        </div>
        <div className="intv-metric">
          <span className="intv-metric-value">₹{formatCost(cost)}</span>
          <span className="intv-metric-label">Est. Cost</span>
        </div>
        <div className="intv-metric">
          <span className="intv-metric-value">{intv.authority}</span>
          <span className="intv-metric-label">Authority</span>
        </div>
      </div>

      <div className="intv-details">
        {intv.estimated_trees && <span>🌳 {intv.estimated_trees} trees</span>}
        {intv.estimated_area_sqm && <span>📐 {intv.estimated_area_sqm.toLocaleString()} sqm</span>}
        {intv.estimated_units && <span>⛱️ {intv.estimated_units} units</span>}
        {intv.estimated_channel_m && <span>💧 {intv.estimated_channel_m}m channel</span>}
        {intv.estimated_length_m && <span>🌊 {intv.estimated_length_m}m corridor</span>}
        {intv.effect_radius_m && <span>📡 {intv.effect_radius_m}m radius</span>}
        {intv.energy_savings_pct && <span>⚡ {intv.energy_savings_pct}% energy saved</span>}
      </div>

      <div className="intv-source">📚 {intv.source}</div>

      <button
        className={`simulate-btn ${isActive ? 'active' : ''}`}
        onClick={onSimulate}
      >
        {isActive ? '✕ Clear Simulation' : '▶ Simulate on Map'}
      </button>

      {isActive && simulationData && (
        <div className="simulation-result">
          <div className="sim-stat">
            <span>Zones affected:</span>
            <strong>{Object.keys(simulationData.affected_zones).length}</strong>
          </div>
          <div className="sim-stat">
            <span>Max temp drop:</span>
            <strong style={{ color: '#22c55e' }}>-{simulationData.total_temp_reduction}°C</strong>
          </div>
        </div>
      )}
    </div>
  );
}

function formatCost(cost) {
  if (cost >= 10000000) return `${(cost / 10000000).toFixed(1)} Cr`;
  if (cost >= 100000) return `${(cost / 100000).toFixed(1)} L`;
  if (cost >= 1000) return `${(cost / 1000).toFixed(1)}K`;
  return cost.toLocaleString();
}
