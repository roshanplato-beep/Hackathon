import { useMemo, useState } from 'react'
import { getHeatColor } from '../utils/colors'

const FILTERS = [
  { id: 'critical', label: 'Critical', test: z => z.heat_risk_score >= 75 },
  { id: 'high', label: 'High risk', test: z => z.heat_risk_score >= 55 },
  { id: 'lowgreen', label: 'Low green cover', test: z => z.green_cover_pct < 10 },
  { id: 'dense', label: 'Dense built-up', test: z => z.building_density_pct >= 60 },
]

const SORTS = [
  { id: 'risk', label: 'Risk score', compare: (a, b) => b.heat_risk_score - a.heat_risk_score },
  { id: 'temp', label: 'Temperature', compare: (a, b) => b.lst_celsius - a.lst_celsius },
  { id: 'delta', label: 'vs city avg', compare: (a, b) => (b.lst_celsius - 33.6) - (a.lst_celsius - 33.6) },
  { id: 'people', label: 'Population', compare: (a, b) => (b.estimated_population || 0) - (a.estimated_population || 0) },
]

/**
 * Left rail for the Map Workspace: search, overlay filters, and the zone list
 * ranked by whichever measure the planner cares about. Replaces having to hunt
 * for a zone by clicking blindly on the map.
 */
export default function ZoneList({ zones, selectedZone, onZoneClick }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState([])
  const [sort, setSort] = useState('risk')

  const toggleFilter = id =>
    setActive(prev => (prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]))

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const chosen = FILTERS.filter(f => active.includes(f.id))
    return zones
      .filter(z => !q || z.name.toLowerCase().includes(q) || z.description?.toLowerCase().includes(q))
      .filter(z => chosen.every(f => f.test(z)))
      .sort(SORTS.find(s => s.id === sort).compare)
  }, [zones, query, active, sort])

  return (
    <aside className="zonelist">
      <div className="zonelist-head">
        <label className="zonelist-label" htmlFor="zone-search">
          Location &amp; zone search
        </label>
        <input
          id="zone-search"
          className="zonelist-search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search zones, wards, features…"
        />
      </div>

      <div className="zonelist-section">
        <p className="zonelist-kicker">Active overlays</p>
        <div className="chip-row">
          {FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              aria-pressed={active.includes(f.id)}
              className={`filter-chip ${active.includes(f.id) ? 'filter-chip-on' : ''}`}
              onClick={() => toggleFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="zonelist-section zonelist-sortrow">
        <p className="zonelist-kicker">
          Zones ({visible.length})
        </p>
        <select
          className="zonelist-sort"
          value={sort}
          onChange={e => setSort(e.target.value)}
          aria-label="Sort zones by"
        >
          {SORTS.map(s => (
            <option key={s.id} value={s.id}>
              Sort: {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="zonelist-items">
        {visible.length === 0 && <p className="zonelist-empty">No zones match those filters.</p>}

        {visible.map(zone => {
          const delta = (zone.lst_celsius - 33.6).toFixed(1)
          return (
            <button
              key={zone.id}
              type="button"
              onClick={() => onZoneClick(zone)}
              className={`zone-card ${selectedZone?.id === zone.id ? 'zone-card-active' : ''}`}
              style={{ '--zone-accent': getHeatColor(zone.heat_risk_score) }}
            >
              <div className="zone-card-top">
                <span className="zone-card-badge">
                  +{delta}°C urban heat island
                </span>
                {selectedZone?.id === zone.id && <span className="zone-card-sel">Selected</span>}
              </div>
              <p className="zone-card-name">{zone.name}</p>
              <p className="zone-card-desc">{zone.description}</p>
              <div className="zone-card-meta">
                <span>{zone.lst_celsius}°C</span>
                <span>Risk {zone.heat_risk_score}</span>
                <span className="muted">{zone.risk_level}</span>
              </div>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
