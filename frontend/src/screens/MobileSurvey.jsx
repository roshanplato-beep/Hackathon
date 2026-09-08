import { useEffect, useState } from 'react'
import { saveSurvey, fetchSurveys, DEVICE_STORAGE } from '../utils/api'

const CONTRIBUTORS = [
  'Exposed paving',
  'No tree canopy',
  'Dense traffic',
  'Metal roofing',
  'AC exhaust',
  'Reflective glass',
  'Standing water absent',
]

const blank = {
  site_name: '',
  latitude: '',
  longitude: '',
  surveyed_at: '',
  observed_shade_pct: 35,
  crowd_count: '',
  observation_period: '',
  surface_type: '',
  notes: '',
}

/**
 * Field survey capture, rendered inside a phone frame as in the Stitch design.
 * Records post to /api/surveys and are listed back per zone.
 */
export default function MobileSurvey({ selectedZone }) {
  const [form, setForm] = useState(blank)
  const [contributors, setContributors] = useState([])
  const [records, setRecords] = useState([])
  const [status, setStatus] = useState('')
  const [gpsNote, setGpsNote] = useState('')

  useEffect(() => {
    if (!selectedZone) return
    setForm({ ...blank, site_name: `${selectedZone.name} — ` })
    setContributors([])
    setStatus('')
    fetchSurveys(selectedZone.id).then(d => setRecords(d.surveys)).catch(() => setRecords([]))
  }, [selectedZone?.id])

  if (!selectedZone) {
    return (
      <div className="screen-empty">
        <h2>Mobile Survey</h2>
        <p>Pick a zone in the Map Workspace to record a field survey against it.</p>
      </div>
    )
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const useGps = () => {
    if (!navigator.geolocation) {
      setGpsNote('This browser does not expose geolocation.')
      return
    }
    setGpsNote('Locating…')
    navigator.geolocation.getCurrentPosition(
      pos => {
        set('latitude', pos.coords.latitude.toFixed(5))
        set('longitude', pos.coords.longitude.toFixed(5))
        setGpsNote(`Accurate to about ${Math.round(pos.coords.accuracy)} m.`)
      },
      () => setGpsNote('Location permission denied — enter coordinates manually.'),
    )
  }

  const submit = e => {
    e.preventDefault()
    saveSurvey({
      zone_id: selectedZone.id,
      site_name: form.site_name.trim() || selectedZone.name,
      latitude: form.latitude === '' ? null : Number(form.latitude),
      longitude: form.longitude === '' ? null : Number(form.longitude),
      surveyed_at: form.surveyed_at,
      observed_shade_pct: Number(form.observed_shade_pct),
      crowd_count: form.crowd_count === '' ? null : Number(form.crowd_count),
      observation_period: form.observation_period,
      surface_type: form.surface_type,
      heat_contributors: contributors,
      notes: form.notes,
    })
      .then(() => {
        setStatus(DEVICE_STORAGE ? 'Survey saved on this device.' : 'Survey recorded.')
        return fetchSurveys(selectedZone.id).then(d => setRecords(d.surveys))
      })
      .catch(() => setStatus('Could not save the survey.'))
  }

  const toggleContributor = c =>
    setContributors(prev => (prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]))

  return (
    <div className="screen screen-survey">
      <header className="screen-head">
        <div>
          <p className="zonelist-kicker">{selectedZone.name} · field inspection mode</p>
          <h1>Urban heat island &amp; shade survey</h1>
          <p className="screen-sub">
            Record on-site environmental stressors, crowd densities and infrastructure needs.
          </p>
        </div>
      </header>

      <div className="survey-grid">
        {DEVICE_STORAGE && <p className="screen-status">Survey records stay in this browser and are not uploaded or shared.</p>}
        <div className="phone-frame">
          <div className="phone-notch">HeatScape Mobile Field Unit</div>
          <form className="phone-body" onSubmit={submit}>
            <section className="survey-section">
              <p className="zonelist-kicker">Location identification</p>
              <label className="param-field param-field-col">
                <span>Site name</span>
                <input value={form.site_name} onChange={e => set('site_name', e.target.value)} />
              </label>
              <div className="survey-coords">
                <label className="param-field param-field-col">
                  <span>Latitude</span>
                  <input value={form.latitude} onChange={e => set('latitude', e.target.value)} placeholder="13.0000" />
                </label>
                <label className="param-field param-field-col">
                  <span>Longitude</span>
                  <input value={form.longitude} onChange={e => set('longitude', e.target.value)} placeholder="80.2200" />
                </label>
              </div>
              <button type="button" className="btn-secondary btn-inline" onClick={useGps}>
                Use GPS
              </button>
              <p className="param-hint">
                {gpsNote || 'Phone GPS is not survey-grade. Manual calibration recommended.'}
              </p>
              <label className="param-field param-field-col">
                <span>Survey date &amp; time</span>
                <input
                  type="datetime-local"
                  value={form.surveyed_at}
                  onChange={e => set('surveyed_at', e.target.value)}
                />
              </label>
            </section>

            <section className="survey-section">
              <p className="zonelist-kicker">Microclimate observations</p>
              <label className="param-field" htmlFor="shade">
                <span>Observed shade coverage</span>
                <span className="param-value">{form.observed_shade_pct}%</span>
              </label>
              <input
                id="shade"
                type="range"
                min="0"
                max="100"
                value={form.observed_shade_pct}
                onChange={e => set('observed_shade_pct', e.target.value)}
                className="thermal-slider"
              />
              <div className="survey-coords">
                <label className="param-field param-field-col">
                  <span>Visitor count</span>
                  <input
                    type="number"
                    min="0"
                    value={form.crowd_count}
                    onChange={e => set('crowd_count', e.target.value)}
                  />
                </label>
                <label className="param-field param-field-col">
                  <span>Observation period</span>
                  <input
                    value={form.observation_period}
                    onChange={e => set('observation_period', e.target.value)}
                    placeholder="09:00–13:00"
                  />
                </label>
              </div>
              <label className="param-field param-field-col">
                <span>Dominant surface</span>
                <input
                  value={form.surface_type}
                  onChange={e => set('surface_type', e.target.value)}
                  placeholder="Asphalt, concrete, paver…"
                />
              </label>
            </section>

            <section className="survey-section">
              <p className="zonelist-kicker">Heat contributors</p>
              <div className="chip-row">
                {CONTRIBUTORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={contributors.includes(c)}
                    className={`filter-chip ${contributors.includes(c) ? 'filter-chip-on' : ''}`}
                    onClick={() => toggleContributor(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <label className="param-field param-field-col">
                <span>Notes</span>
                <textarea rows="3" value={form.notes} onChange={e => set('notes', e.target.value)} />
              </label>
            </section>

            <button type="submit" className="btn-primary">Save survey record</button>
            {status && <p className="screen-status">{status}</p>}
          </form>
        </div>

        <section className="panel survey-records">
          <div className="panel-head">
            <h2>Recorded surveys</h2>
            <span className="muted">{records.length}</span>
          </div>
          {records.length === 0 && (
            <p className="loading-text">No surveys recorded for {selectedZone.name} yet.</p>
          )}
          {records.map(r => (
            <article className="survey-record" key={r.id}>
              <p className="zone-card-name">{r.site_name}</p>
              <div className="zone-card-meta">
                {r.observed_shade_pct !== null && <span>{r.observed_shade_pct}% shade</span>}
                {r.crowd_count !== null && <span>{r.crowd_count} people</span>}
                <span className="muted">{(r.created_at || '').slice(0, 10)}</span>
              </div>
              {r.heat_contributors?.length > 0 && (
                <div className="chip-row">
                  {r.heat_contributors.map(c => (
                    <span className="chip" key={c}>{c}</span>
                  ))}
                </div>
              )}
              {r.notes && <p className="param-hint">{r.notes}</p>}
            </article>
          ))}
        </section>
      </div>
    </div>
  )
}
