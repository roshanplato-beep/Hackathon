import { useEffect, useState } from 'react'
import { fetchEstimate, fetchZoneDetail } from '../utils/api'

const rupees = n =>
  n === null || n === undefined
    ? '—'
    : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

/**
 * Cost Estimate screen: parameters on the left, itemised breakdown on the
 * right, total banner beneath — the Stitch layout, driven by the backend's
 * /api/estimate rather than the hospital canopy figures it was drawn with.
 */
export default function CostEstimate({ selectedZone }) {
  const [interventions, setInterventions] = useState([])
  const [chosen, setChosen] = useState([])
  const [areas, setAreas] = useState({})
  const [params, setParams] = useState({ installation_pct: 18, sitework_pct: 12, contingency_pct: 10 })
  const [estimate, setEstimate] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!selectedZone) return
    fetchZoneDetail(selectedZone.id)
      .then(d => {
        setInterventions(d.interventions)
        setChosen(d.interventions.map(i => i.id))
        setAreas(Object.fromEntries(d.interventions.map(i => [i.id, i.estimated_area_sqm])))
      })
      .catch(() => setError('Could not load interventions for this zone.'))
  }, [selectedZone?.id])

  useEffect(() => {
    if (!selectedZone || chosen.length === 0) {
      setEstimate(null)
      return
    }
    const timer = setTimeout(() => {
      fetchEstimate({
        zone_id: selectedZone.id,
        intervention_ids: chosen,
        areas_sqm: areas,
        ...params,
      })
        .then(setEstimate)
        .catch(() => setError('Estimate request failed.'))
    }, 250)
    return () => clearTimeout(timer)
  }, [selectedZone?.id, chosen, areas, params])

  if (!selectedZone) {
    return (
      <div className="screen-empty">
        <h2>Cost Estimate</h2>
        <p>Pick a zone in the Map Workspace to price its interventions.</p>
      </div>
    )
  }

  if (interventions.length === 0) return <div className="screen-empty"><h2>Cost estimate unavailable</h2><p>{selectedZone.name}: verified local rates, land availability, and cooling-effect evidence are not connected. Fallback plans and totals are hidden.</p></div>;

  const toggle = id =>
    setChosen(prev => (prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]))

  return (
    <div className="screen screen-cost">
      <header className="screen-head">
        <div>
          <p className="zonelist-kicker">{selectedZone.name} · heat mitigation package</p>
          <h1>Cost &amp; material estimation</h1>
          <p className="screen-sub">
            Configure unit rates, installation overhead and site contingencies for the
            recommended interventions.
          </p>
        </div>
      </header>

      {error && <p className="screen-error">{error}</p>}

      <div className="cost-grid">
        <section className="panel">
          <h2>Estimation parameters</h2>

          <div className="param-block">
            <p className="zonelist-kicker">Interventions</p>
            {interventions.map(i => (
              <label key={i.id} className="param-check">
                <input type="checkbox" checked={chosen.includes(i.id)} onChange={() => toggle(i.id)} />
                <span>{i.icon} {i.name}</span>
                <span className="muted">{i.cost_per_sqm_inr ? `${rupees(i.cost_per_sqm_inr)}/m²` : `${rupees(i.estimated_cost_inr)} / package`}</span>
              </label>
            ))}
          </div>

          <div className="param-block">
            <p className="zonelist-kicker">Coverage area (m²)</p>
            {interventions.filter(i => chosen.includes(i.id) && i.cost_per_sqm_inr).map(i => (
              <label key={i.id} className="param-field">
                <span>{i.name}</span>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={areas[i.id] ?? 0}
                  onChange={e => setAreas(a => ({ ...a, [i.id]: Number(e.target.value) }))}
                />
              </label>
            ))}
          </div>

          {[
            ['installation_pct', 'Installation labour', 'Rigging, structural work and crane rental.'],
            ['sitework_pct', 'Additional site-work', 'Ground clearance, utility checks, footings.'],
            ['contingency_pct', 'Contingency', 'Buffer for supply-chain variance and unexpected costs.'],
          ].map(([key, label, hint]) => (
            <div className="param-block" key={key}>
              <label className="param-field" htmlFor={key}>
                <span>{label}</span>
                <span className="param-value">{params[key]}%</span>
              </label>
              <input
                id={key}
                type="range"
                min="0"
                max={key === 'contingency_pct' ? 50 : 100}
                value={params[key]}
                onChange={e => setParams(p => ({ ...p, [key]: Number(e.target.value) }))}
                className="thermal-slider"
              />
              <p className="param-hint">{hint}</p>
            </div>
          ))}

          <div className="notice">
            <strong>Important calculation notice</strong>
            <p>
              Indicative planning figures from published unit rates, not a tendered quote.
              Local rates and site conditions will vary.
            </p>
          </div>
        </section>

        <section className="cost-right">
          <div className="panel">
            <div className="panel-head">
              <h2>Itemised breakdown</h2>
              <span className="muted">{selectedZone.name}</span>
            </div>

            <table className="cost-table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Quantity</th>
                  <th>Unit rate</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {estimate?.line_items.map(li => (
                  <tr key={li.id}>
                    <td>
                      <span className="cost-dot" /> {li.icon} {li.name}
                    </td>
                    <td>{(li.quantity ?? li.area_sqm).toLocaleString('en-IN')} {li.unit || 'm²'}</td>
                    <td>{rupees(li.unit_rate_inr ?? li.rate_inr_per_sqm)}</td>
                    <td>{rupees(li.amount_inr)}</td>
                  </tr>
                ))}
                {estimate && (
                  <>
                    <tr>
                      <td><span className="cost-dot" /> Installation labour</td>
                      <td>Lump sum</td>
                      <td>{estimate.totals.installation_pct}%</td>
                      <td>{rupees(estimate.totals.installation_inr)}</td>
                    </tr>
                    <tr>
                      <td><span className="cost-dot" /> Additional site-work</td>
                      <td>Lump sum</td>
                      <td>{estimate.totals.sitework_pct}%</td>
                      <td>{rupees(estimate.totals.sitework_inr)}</td>
                    </tr>
                    <tr>
                      <td><span className="cost-dot" /> Contingency buffer</td>
                      <td>{estimate.totals.contingency_pct}% subtotal</td>
                      <td>Variable</td>
                      <td>{rupees(estimate.totals.contingency_inr)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
            {!estimate && <p className="loading-text">Select at least one intervention.</p>}
          </div>

          {estimate && (
            <div className="cost-total">
              <div>
                <p className="cost-total-label">Total estimated investment</p>
                <p className="cost-total-value">{rupees(estimate.totals.total_inr)}</p>
                <p className="cost-total-note">
                  {estimate.impact.projected_temp_drop_c}°C projected drop across{' '}
                  {estimate.impact.total_area_sqm.toLocaleString('en-IN')} m², reaching{' '}
                  {estimate.impact.people_benefiting.toLocaleString('en-IN')} residents
                  {estimate.impact.cost_per_person_inr
                    ? ` (${rupees(estimate.impact.cost_per_person_inr)} per person)`
                    : ''}
                  .
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
