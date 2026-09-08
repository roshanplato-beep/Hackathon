import { useEffect, useMemo, useState } from 'react'
import { fetchZoneDetail, fetchPlan, savePlan, DEVICE_STORAGE } from '../utils/api'
import { CATEGORY_COLORS } from '../utils/colors'

const fmt = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })

/**
 * Site Planner: allocate intervention coverage against the land a zone actually
 * has. The Stitch design drove canopy geometry for a single building; here the
 * same layout drives area allocation across a whole zone, which is the unit
 * this dataset works in.
 */
export default function SitePlanner({ selectedZone }) {
  const [interventions, setInterventions] = useState([])
  const [areas, setAreas] = useState({})
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!selectedZone) return
    setStatus('')
    fetchZoneDetail(selectedZone.id).then(d => {
      setInterventions(d.interventions)
      setAreas(Object.fromEntries(d.interventions.map(i => [i.id, i.estimated_area_sqm])))
    })
    fetchPlan(selectedZone.id).then(({ plan }) => {
      if (plan) {
        setAreas(a => ({ ...a, ...plan.areas_sqm }))
        setNotes(plan.notes || '')
      }
    })
  }, [selectedZone?.id])

  const allocated = useMemo(
    () => Object.values(areas).reduce((s, v) => s + Number(v || 0), 0),
    [areas],
  )

  if (!selectedZone) {
    return (
      <div className="screen-empty">
        <h2>Site Planner</h2>
        <p>Pick a zone in the Map Workspace to plan interventions for it.</p>
      </div>
    )
  }

  if (interventions.length === 0) return <div className="screen-empty"><h2>Site planner unavailable</h2><p>{selectedZone.name}: verified local rates, land availability, and cooling-effect evidence are not connected. Fallback plans and totals are hidden.</p></div>;

  const govtLand = selectedZone.govt_land_area_sqm || 0
  const zoneArea = selectedZone.zone_area_sqm || 1
  const overBudget = allocated > govtLand
  const projectedDrop = interventions
    .filter(i => (areas[i.id] || 0) > 0)
    .reduce((s, i) => s + (i.temp_drop || 0), 0)
  const damped = interventions.filter(i => (areas[i.id] || 0) > 0).length > 1
    ? projectedDrop * 0.75
    : projectedDrop

  const handleSave = () => {
    savePlan({
      zone_id: selectedZone.id,
      intervention_ids: interventions.filter(i => (areas[i.id] || 0) > 0).map(i => i.id),
      areas_sqm: areas,
      notes,
    })
      .then(() => setStatus(DEVICE_STORAGE ? 'Plan saved on this device.' : 'Plan saved.'))
      .catch(() => setStatus('Could not save the plan.'))
  }

  // Zone composition, as proportions of total zone area.
  const bands = [
    { label: 'Built-up', pct: selectedZone.building_density_pct, color: '#ef4444' },
    { label: 'Roads', pct: selectedZone.road_coverage_pct, color: '#6b7280' },
    { label: 'Green', pct: selectedZone.green_cover_pct, color: '#22c55e' },
  ]
  const otherPct = Math.max(0, 100 - bands.reduce((s, b) => s + b.pct, 0))
  const coveragePct = (allocated / zoneArea) * 100

  return (
    <div className="screen screen-planner">
      <header className="screen-head">
        <div>
          <p className="zonelist-kicker">{selectedZone.name}</p>
          <h1>Site Planner</h1>
          <p className="screen-sub">
            Allocate intervention coverage against the {fmt(govtLand)} m² of government land
            available in this zone.
          </p>
        </div>
        <button type="button" className="btn-primary btn-inline" onClick={handleSave}>
          Save plan
        </button>
      </header>

      {DEVICE_STORAGE && <p className="screen-status">Plans are saved in this browser only; they are not shared between devices.</p>}
      {status && <p className="screen-status">{status}</p>}

      <div className="planner-grid">
        <section className="panel">
          <h2>Coverage allocation</h2>
          {interventions.map(i => {
            const max = Math.max(govtLand, i.estimated_area_sqm * 2)
            return (
              <div className="param-block" key={i.id}>
                <label className="param-field" htmlFor={`area-${i.id}`}>
                  <span>{i.icon} {i.name}</span>
                  <span className="param-value">{fmt(areas[i.id])} m²</span>
                </label>
                <input
                  id={`area-${i.id}`}
                  type="range"
                  min="0"
                  max={Math.round(max)}
                  step="100"
                  value={areas[i.id] ?? 0}
                  onChange={e => setAreas(a => ({ ...a, [i.id]: Number(e.target.value) }))}
                  className="thermal-slider"
                  style={{ accentColor: CATEGORY_COLORS[i.category] }}
                />
                <p className="param-hint">
                  −{i.temp_drop}°C · {i.authority}-level approval · best for {i.best_when}
                </p>
              </div>
            )
          })}

          <label className="param-field param-field-col" htmlFor="plan-notes">
            <span>Planning notes</span>
            <textarea
              id="plan-notes"
              rows="3"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Phasing, ward coordination, constraints…"
            />
          </label>
        </section>

        <section className="panel">
          <h2>Zone composition</h2>
          <svg viewBox="0 0 400 220" className="planner-canvas" role="img"
               aria-label={`Land composition of ${selectedZone.name}`}>
            <rect x="0" y="0" width="400" height="220" rx="8" fill="#0c0c0c" stroke="#2e2e2e" />
            {(() => {
              let x = 10
              const w = 380
              return [...bands, { label: 'Other', pct: otherPct, color: '#1f1f1f' }].map(b => {
                const bw = (b.pct / 100) * w
                const el = (
                  <g key={b.label}>
                    <rect x={x} y={30} width={Math.max(0, bw)} height={90} fill={b.color} opacity="0.75" />
                    {bw > 46 && (
                      <text x={x + bw / 2} y={80} fill="#fff" fontSize="11" textAnchor="middle">
                        {b.label}
                      </text>
                    )}
                  </g>
                )
                x += bw
                return el
              })
            })()}
            <text x="10" y="20" fill="#a1a1a1" fontSize="11">Existing land cover</text>

            <text x="10" y="150" fill="#a1a1a1" fontSize="11">Proposed intervention coverage</text>
            <rect x="10" y="160" width="380" height="40" rx="4" fill="#161616" stroke="#2e2e2e" />
            {(() => {
              // Coverage is usually a fraction of a percent, so the fill is far
              // too narrow to hold its own label — put the text outside it then,
              // and only sit it inside once the bar is wide enough to read on.
              const barWidth = Math.min(380, (coveragePct / 100) * 380)
              const inside = barWidth > 120
              return (
                <>
                  <rect x="10" y="160" width={barWidth} height="40" rx="4" fill="#00e599" opacity="0.85" />
                  <text
                    x={inside ? 22 : 10 + barWidth + 10}
                    y="185"
                    fill={inside ? '#00110b' : '#ffffff'}
                    fontSize="12"
                    fontWeight="600"
                  >
                    {coveragePct.toFixed(2)}% of zone
                  </text>
                </>
              )
            })()}
          </svg>

          <div className="planner-stats">
            <div>
              <p className="dash-stat-value">{fmt(allocated)} m²</p>
              <p className="dash-stat-label">Allocated</p>
            </div>
            <div>
              <p className="dash-stat-value">{fmt(govtLand)} m²</p>
              <p className="dash-stat-label">Govt land available</p>
            </div>
            <div>
              <p className="dash-stat-value" style={{ color: '#00e599' }}>
                −{damped.toFixed(1)}°C
              </p>
              <p className="dash-stat-label">Projected drop</p>
            </div>
          </div>

          {overBudget && (
            <div className="notice notice-warn">
              <strong>Exceeds available government land</strong>
              <p>
                Allocated {fmt(allocated)} m² against {fmt(govtLand)} m² of government land.
                The surplus needs private land agreements or road-reserve permissions.
              </p>
            </div>
          )}

          <div className="notice">
            <strong>Coverage model note</strong>
            <p>
              Multiple interventions overlap rather than stack, so the projected drop is damped
              to 75% of the arithmetic sum. Not a validated CFD simulation.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
