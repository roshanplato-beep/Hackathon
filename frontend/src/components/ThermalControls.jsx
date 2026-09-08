/**
 * Thermal overlay controls for the 2D map. The backend's tile template is
 * EPSG:3857, which Leaflet consumes natively — no reprojection needed.
 */
export default function ThermalControls({
  config,
  enabled,
  onToggle,
  intensity,
  onIntensity,
  layerKey,
  onLayerChange,
}) {
  const active = config?.available_layers?.find(l => l.key === (config?.layer_key ?? layerKey))

  return (
    <div className="thermal-panel">
      <div className="thermal-panel-head">
        <div>
          <h3>Thermal heatmap</h3>
          <p>{config ? `MODIS/Aqua LST · ${config.date}` : 'Loading layer config…'}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle thermal heatmap"
          disabled={!config}
          onClick={() => onToggle(!enabled)}
          className={`toggle ${enabled ? 'toggle-on' : ''}`}
        >
          <span className="toggle-knob" />
        </button>
      </div>

      {enabled && config && (
        <>
          <div className="thermal-layer-row">
            {config.available_layers?.map(l => (
              <button
                key={l.key}
                type="button"
                aria-pressed={config.layer_key === l.key}
                className={`filter-chip ${config.layer_key === l.key ? 'filter-chip-on' : ''}`}
                onClick={() => onLayerChange(l.key)}
              >
                {l.label}
              </button>
            ))}
          </div>
          {active && <p className="param-hint">{active.blurb}</p>}

          <label className="thermal-slider-row" htmlFor="thermal-intensity">
            <span>Intensity</span>
            <span className="muted">{Math.round(intensity * 100)}%</span>
          </label>
          <input
            id="thermal-intensity"
            type="range"
            min="10"
            max="100"
            value={Math.round(intensity * 100)}
            onChange={e => onIntensity(Number(e.target.value) / 100)}
            className="thermal-slider"
          />

          <div className="thermal-scale">
            <p className="zonelist-kicker">Thermal scale</p>
            <div className="legend-gradient" />
            <div className="legend-labels">
              <span>{config.legend?.min ?? -33}°C</span>
              <span>{config.legend?.max ?? 67}°C</span>
            </div>
          </div>

          <p className="thermal-note">{config.notes}</p>
        </>
      )}
    </div>
  )
}
