import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { CATEGORY_COLORS } from '../utils/colors';

export default function CostDashboard({ interventions, zone }) {
  const chartData = interventions.map(intv => ({
    name: intv.name.length > 15 ? intv.name.slice(0, 14) + '…' : intv.name,
    fullName: intv.name,
    tempDrop: intv.temp_drop || intv.temp_drop_ambient || intv.max_drop || 0,
    cost: (intv.estimated_cost_inr || 0) / 100000, // in lakhs
    category: intv.category,
    costEfficiency: intv.cost_efficiency || 0,
    bestValue: intv.most_cost_efficient || false,
  }));

  const totalCost = interventions.reduce((s, i) => s + (i.estimated_cost_inr || 0), 0);
  const totalTempDrop = Math.max(0, ...interventions.map(i => i.temp_drop || i.temp_drop_ambient || i.max_drop || 0));
  const totalArea = Math.max(0, ...interventions.map(i => i.area_affected_sqm || 0));

  return (
    <div className="cost-dashboard">
      <p className="zone-desc">Scenario for {zone.name}. {zone.osm_fetched ? 'Uses OSM-derived mapped coverage.' : 'Uses fallback morphology; live mapping unavailable.'} Costs use fixed, unverified catalogue rates—not live quotes. Cooling is an area-weighted concept estimate, not a measured outcome. Influence areas can overlap; population is not a verified beneficiary count.</p>
      <details>
        <summary>Quantities and calculation assumptions</summary>
        {interventions.map(i => <p key={i.id}>
          <strong>{i.name}:</strong> {i.estimated_area_sqm != null ? `${i.estimated_area_sqm.toLocaleString()} m²` :
            i.estimated_trees != null ? `${i.estimated_trees} trees` :
            i.estimated_units != null ? `${i.estimated_units} units` :
            `${i.estimated_channel_m ?? i.estimated_length_m} m`}
          {' · ₹'}{(i.cost_per_sqm_inr ?? i.cost_per_tree_inr ?? i.cost_per_unit_inr ?? i.cost_per_meter_channel_inr ?? (i.cost_per_100m_inr / 100)).toLocaleString()} per unit.
          {' '}{i.planning_basis}
        </p>)}
      </details>
      {/* Summary stats */}
      <div className="dash-stats">
        <div className="dash-stat">
          <div className="dash-stat-value">₹{formatLakhs(totalCost)}</div>
          <div className="dash-stat-label">Indicative Works Cost</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-value" style={{ color: '#3b82f6' }}>
            -{totalTempDrop.toFixed(3)}°C
          </div>
          <div className="dash-stat-label">Best Single Option · Zone Avg</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-value">{(totalArea / 1000).toFixed(0)}K</div>
          <div className="dash-stat-label">Largest Influence Area (sqm)</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-value">
            {Math.round(zone.estimated_population || 0).toLocaleString()}
          </div>
          <div className="dash-stat-label">Population Proxy · Not Beneficiaries</div>
        </div>
      </div>

      {/* Temperature drop comparison */}
      <div className="chart-container">
        <h4>Modelled Zone-Average Reduction (°C)</h4>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={100} tick={{ fill: '#d1d5db', fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
              labelStyle={{ color: '#d1d5db' }}
              formatter={(v) => [`${v}°C`, 'Temp Drop']}
              labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
            />
            <Bar dataKey="tempDrop" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={CATEGORY_COLORS[entry.category]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Cost comparison */}
      <div className="chart-container">
        <h4>Estimated Cost (₹ Lakhs)</h4>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={100} tick={{ fill: '#d1d5db', fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
              labelStyle={{ color: '#d1d5db' }}
              formatter={(v) => [`₹${v.toFixed(1)} L`, 'Cost']}
              labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
            />
            <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.bestValue ? '#facc15' : '#6b7280'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function formatLakhs(amount) {
  if (amount >= 10000000) return `${(amount / 10000000).toFixed(1)} Cr`;
  if (amount >= 100000) return `${(amount / 100000).toFixed(1)} L`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(0)}K`;
  return amount.toLocaleString();
}
