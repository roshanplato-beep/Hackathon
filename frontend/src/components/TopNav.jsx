const TABS = [
  { id: 'map', label: 'Map Workspace' },
  { id: 'planner', label: 'Site Planner' },
  { id: 'cost', label: 'Cost Estimate' },
  { id: 'survey', label: 'Mobile Survey' },
]

export default function TopNav({ active, onChange, onBackToGlobe, zones, selectedZone }) {
  const hotspots = zones.filter(z => z.heat_risk_score >= 55).length

  return (
    <header className="topnav">
      <div className="topnav-left">
        <button type="button" className="back-btn" onClick={onBackToGlobe}>
          ← Globe
        </button>
        <span className="status-dot" />
        <span className="logo-text">HeatScape</span>
        <span className="chip">Chennai · {zones.length} zones · {hotspots} hotspots</span>
      </div>

      <nav className="topnav-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`topnav-tab ${active === tab.id ? 'topnav-tab-active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="topnav-right">
        {selectedZone ? (
          <span className="chip">{selectedZone.name}</span>
        ) : (
          <span className="chip chip-muted">No zone selected</span>
        )}
      </div>
    </header>
  )
}
