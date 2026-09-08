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
  const totalTempDrop = Math.max(...interventions.map(i => i.temp_drop || i.temp_drop_ambient || i.max_drop || 0));
  const totalArea = interventions.reduce((s, i) => s + (i.area_affected_sqm || 0), 0);

  return (
    <div className="cost-dashboard">
      {/* Summary stats */}
      <div className="dash-stats">
        <div className="dash-stat">
          <div className="dash-stat-value">₹{formatLakhs(totalCost)}</div>
          <div className="dash-stat-label">Total Investment</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-value" style={{ color: '#22c55e' }}>
            -{totalTempDrop}°C
          </div>
          <div className="dash-stat-label">Max Cooling</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-value">{(totalArea / 1000).toFixed(0)}K</div>
          <div className="dash-stat-label">Area (sqm)</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-value">
            {Math.round(zone.estimated_population || 0).toLocaleString()}
          </div>
          <div className="dash-stat-label">People Benefit</div>
        </div>
      </div>

      {/* Temperature drop comparison */}
      <div className="chart-container">
        <h4>Temperature Reduction (°C)</h4>
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
