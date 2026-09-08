import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Cartesian2,
  Cartesian3,
  Color,
  ImageryLayer,
  LabelStyle,
  NearFarScalar,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  Viewer,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { labelsProvider, satelliteProvider, thermalProvider } from './layers'
import { fetchThermalConfig } from '../utils/api'
import { getHeatColor } from '../utils/colors'
import { findPlaces } from './search'
import { addBoundaries, removeBoundaries } from './boundaries'

// The field is the subject, so it renders near-opaque. Coastlines and country
// outlines come from the reference layer drawn above it, not from bleed-through.
const THERMAL_ALPHA = 0.96
const SPIN_RADIANS_PER_SECOND = 0.035
const CHENNAI = { longitude: 80.22, latitude: 13.0 }
const START_HEIGHT = 24_000_000
const CHENNAI_HEIGHT = 180_000

export default function GlobeLanding({ zones, onEnter }) {
  const container = useRef(null)
  const viewer = useRef(null)
  const thermalLayer = useRef(null)
  const labelsLayer = useRef(null)
  const baseLayer = useRef(null)
  const spinning = useRef(true)
  // The Cesium click handler is registered once but needs the current zone
  // list, so mirror it into a ref rather than rebuilding the viewer.
  const zonesRef = useRef(zones)
  useEffect(() => {
    zonesRef.current = zones
  }, [zones])

  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState('')
  // The continuous air-temperature field is the whole point of the landing
  // view, so it starts on rather than hiding behind a toggle.
  const [thermal, setThermal] = useState(true)
  const [layerKey, setLayerKey] = useState(import.meta.env.PROD ? 'composite' : 'air')
  const [config, setConfig] = useState(null)
  const [hovered, setHovered] = useState(null)
  const [tilesPending, setTilesPending] = useState(0)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])

  const stopSpin = useCallback(() => {
    spinning.current = false
  }, [])

  // ---- Viewer -------------------------------------------------------------
  useEffect(() => {
    const el = container.current
    if (!el) return

    let v
    try {
      v = new Viewer(el, {
        baseLayer: new ImageryLayer(satelliteProvider()),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        showRenderLoopErrors: false,
        creditContainer: document.createElement('div'),
      })
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'WebGL is unavailable in this browser.')
      return
    }
    viewer.current = v
    if (import.meta.env.DEV) window.viewer = v

    // A single bad remote image tile should never take down the landing page.
    // Cesium can surface browser decode failures as render-loop errors, so keep
    // rendering and let the normal tile retry/fallback path recover.
    v.scene.rethrowRenderErrors = false
    const onRenderError = (_scene, error) => {
      console.warn('Cesium render error suppressed:', error)
      v.useDefaultRenderLoop = true
    }
    v.scene.renderError.addEventListener(onRenderError)

    v.scene.globe.baseColor = Color.BLACK

    // Cesium's ground atmosphere and distance fog lay a haze over the surface
    // that visibly desaturates the temperature field — the whole point of this
    // view. The sky atmosphere only draws the limb glow, so it stays.
    v.scene.globe.showGroundAtmosphere = false
    v.scene.fog.enabled = false

    // Deliberately no sun lighting. A day/night terminator reads well on a flat
    // world map, where the whole planet stays visible; on a globe it darkens
    // half of the only hemisphere you can see and hides the temperature field.
    v.scene.globe.enableLighting = false

    baseLayer.current = v.imageryLayers.get(0)

    const labels = v.imageryLayers.addImageryProvider(labelsProvider())
    labels.alpha = 0.85
    labelsLayer.current = labels

    v.camera.setView({
      destination: Cartesian3.fromDegrees(CHENNAI.longitude, CHENNAI.latitude, START_HEIGHT),
    })

    const input = new ScreenSpaceEventHandler(v.scene.canvas)
    for (const type of [
      ScreenSpaceEventType.LEFT_DOWN,
      ScreenSpaceEventType.RIGHT_DOWN,
      ScreenSpaceEventType.MIDDLE_DOWN,
      ScreenSpaceEventType.WHEEL,
      ScreenSpaceEventType.PINCH_START,
    ]) {
      input.setInputAction(stopSpin, type)
    }

    // Clicking a zone marker dives straight into that zone's workspace.
    input.setInputAction(({ position }) => {
      const picked = v.scene.pick(position)
      const zoneId = picked?.id?.zoneId
      if (!zoneId) return
      const zone = zonesRef.current.find(z => z.id === zoneId)
      if (zone) onEnter(zone)
    }, ScreenSpaceEventType.LEFT_CLICK)

    input.setInputAction(({ endPosition }) => {
      const picked = v.scene.pick(endPosition)
      const zoneId = picked?.id?.zoneId
      setHovered(zoneId ? zonesRef.current.find(z => z.id === zoneId) ?? null : null)
    }, ScreenSpaceEventType.MOUSE_MOVE)

    // GIBS tiles arrive slowly enough that a freshly flipped toggle looks
    // broken without a progress hint.
    const onTileProgress = queued => setTilesPending(queued)
    v.scene.globe.tileLoadProgressEvent.addEventListener(onTileProgress)

    let last = Date.now()
    const tick = () => {
      const now = Date.now()
      const dt = (now - last) / 1000
      last = now
      if (spinning.current) v.camera.rotate(Cartesian3.UNIT_Z, -SPIN_RADIANS_PER_SECOND * dt)
    }
    v.clock.onTick.addEventListener(tick)

    // Vector country and state outlines, drawn above the imagery stack.
    let boundarySources = []
    void addBoundaries(v).then(sources => {
      boundarySources = sources
    })

    setReady(true)

    return () => {
      removeBoundaries(v, boundarySources)
      v.scene.renderError.removeEventListener(onRenderError)
      v.clock.onTick.removeEventListener(tick)
      v.scene.globe.tileLoadProgressEvent.removeEventListener(onTileProgress)
      input.destroy()
      if (!v.isDestroyed()) v.destroy()
      viewer.current = null
      thermalLayer.current = null
    }
  }, [onEnter, stopSpin])

  // ---- Thermal config from the backend ------------------------------------
  useEffect(() => {
    let cancelled = false
    fetchThermalConfig(layerKey)
      .then(c => {
        if (!cancelled) setConfig(c)
      })
      .catch(() => {
        if (!cancelled) setConfig(null)
      })
    return () => {
      cancelled = true
    }
  }, [layerKey])

  // Swapping layers means swapping providers, so tear the old one down rather
  // than stacking a second imagery layer on top of it.
  useEffect(() => {
    const v = viewer.current
    if (!v || !ready || !config || config.unavailable) return

    if (thermalLayer.current) {
      v.imageryLayers.remove(thermalLayer.current, true)
      thermalLayer.current = null
    }
    const layer = v.imageryLayers.addImageryProvider(thermalProvider(config))
    layer.alpha = thermal ? THERMAL_ALPHA : 0
    layer.show = thermal
    thermalLayer.current = layer

    // Country borders and place names belong above the temperature field, not
    // buried under it.
    if (labelsLayer.current) v.imageryLayers.raiseToTop(labelsLayer.current)

    return () => {
      if (!v.isDestroyed() && thermalLayer.current) {
        v.imageryLayers.remove(thermalLayer.current, true)
        thermalLayer.current = null
      }
    }
  }, [config, ready])

  // OpenWeatherMap's tiles are semi-transparent overlays meant to sit on a
  // basemap, so full-colour satellite imagery underneath mutes them badly.
  // Desaturate and dim the base while the field is showing, which also matches
  // the flat grey landmass of a conventional temperature map.
  useEffect(() => {
    const base = baseLayer.current
    if (!base) return
    base.saturation = thermal ? 0.0 : 1.0
    base.brightness = thermal ? 0.8 : 1.0
  }, [thermal, config])

  // Fade rather than snap, and never block input while it runs.
  useEffect(() => {
    const layer = thermalLayer.current
    if (!layer) return
    let raf = 0
    const target = thermal ? THERMAL_ALPHA : 0
    if (thermal) layer.show = true
    const step = () => {
      const delta = target - layer.alpha
      if (Math.abs(delta) < 0.01) {
        layer.alpha = target
        if (!thermal) layer.show = false
        return
      }
      layer.alpha += delta * 0.18
      raf = requestAnimationFrame(step)
    }
    step()
    return () => cancelAnimationFrame(raf)
  }, [thermal, config])

  // ---- Zone markers -------------------------------------------------------
  useEffect(() => {
    const v = viewer.current
    if (!v || !ready || !zones?.length) return

    for (const zone of zones) {
      const [lat, lon] = zone.center
      v.entities.add({
        id: `zone-${zone.id}`,
        zoneId: zone.id,
        position: Cartesian3.fromDegrees(lon, lat),
        point: {
          pixelSize: 11,
          color: Color.fromCssColorString(getHeatColor(zone.heat_risk_score)),
          outlineColor: Color.WHITE.withAlpha(0.9),
          outlineWidth: 2,
          scaleByDistance: new NearFarScalar(1.0e5, 1.6, 8.0e6, 0.5),
          translucencyByDistance: new NearFarScalar(1.0e6, 1.0, 2.0e7, 0.0),
        },
        label: {
          text: zone.name,
          font: '500 13px Inter, sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.fromCssColorString('#0c0c0c'),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -14),
          // Chennai's zones sit within ~30km of each other, so their labels
          // collide into an unreadable pile at city-wide altitude. Reveal them
          // only once the camera is close enough for them to separate; hovering
          // a marker identifies it at any zoom.
          translucencyByDistance: new NearFarScalar(2.0e4, 1.0, 8.0e4, 0.0),
        },
      })
    }

    return () => {
      // The viewer effect is declared first, so on unmount its cleanup has
      // already destroyed `v` and reading `v.entities` would throw.
      if (v.isDestroyed()) return
      for (const zone of zones) v.entities.removeById(`zone-${zone.id}`)
    }
  }, [zones, ready])

  // Picking a result writes its name into the box, which would otherwise
  // re-run the search and immediately reopen the dropdown you just dismissed.
  const skipNextSearch = useRef(false)

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void findPlaces(query, controller.signal).then(setResults)
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const flyToPlace = useCallback(place => {
    stopSpin()
    setResults([])
    skipNextSearch.current = true
    setQuery(place.name.split(',')[0] ?? '')
    viewer.current?.camera.flyTo({
      // Regional altitude, not street level: the air-temperature grid is coarse
      // and flying closer just shows upscaled pixels.
      destination: Cartesian3.fromDegrees(place.longitude, place.latitude, 900_000),
      duration: 2.5,
    })
  }, [stopSpin])

  const flyToChennai = useCallback(() => {
    stopSpin()
    viewer.current?.camera.flyTo({
      destination: Cartesian3.fromDegrees(CHENNAI.longitude, CHENNAI.latitude, CHENNAI_HEIGHT),
      duration: 2.5,
    })
  }, [stopSpin])

  const hotspots = zones?.filter(z => z.heat_risk_score >= 55).length ?? 0

  return (
    <div className="globe-root">
      <div ref={container} className="globe-canvas" />

      {failed && (
        <div className="globe-error">
          <div className="globe-error-card">
            <h2>The globe could not start</h2>
            <p>{failed}</p>
            <button type="button" className="btn-primary" onClick={() => onEnter(null)}>
              Continue to the workspace
            </button>
          </div>
        </div>
      )}

      <div className="globe-brand">
        <span className="status-dot" />
        <span className="globe-brand-name">HeatScape</span>
        <span className="chip">Urban Heat Reduction Planner</span>
      </div>

      {/* Place search */}
      <div className="globe-search">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Find a place…"
          aria-label="Find a place"
          className="globe-search-input"
        />
        {results.length > 0 && (
          <ul className="globe-search-results">
            {results.map(p => (
              <li key={`${p.latitude},${p.longitude}`}>
                <button type="button" onClick={() => flyToPlace(p)}>
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="globe-panel globe-panel-thermal">
        <div className="globe-panel-head">
          <div>
            <h3>Thermal layer</h3>
            <p>{config?.quantity ?? 'Loading…'}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={thermal}
            aria-label="Toggle live thermal mapping"
            disabled={!ready || !config}
            onClick={() => setThermal(t => !t)}
            className={`toggle ${thermal ? 'toggle-on' : ''}`}
          >
            <span className="toggle-knob" />
          </button>
        </div>

        {!config && <p className="globe-note">Thermal config unavailable — is the API running?</p>}
        {config?.unavailable && (
          <p className="globe-note">{config.unavailable_reason}</p>
        )}

        {thermal && config && (
          <div className="globe-legend">
            <div className="thermal-layer-row">
              {config.available_layers?.map(l => (
                <button
                  key={l.key}
                  type="button"
                  disabled={l.unavailable}
                  aria-pressed={config.layer_key === l.key}
                  className={`filter-chip ${config.layer_key === l.key ? 'filter-chip-on' : ''}`}
                  onClick={() => setLayerKey(l.key)}
                  title={l.unavailable ? 'Needs an OpenWeatherMap key' : l.blurb}
                >
                  {l.label}
                </button>
              ))}
            </div>

            <div className="legend-gradient" />
            <div className="legend-labels">
              <span>Cool</span>
              <span>Hot</span>
            </div>
            {tilesPending > 0 && (
              <p className="globe-loading">
                <span className="status-dot pulsing" />
                Loading tiles… ({tilesPending})
              </p>
            )}
            <p className="globe-note">
              {config.attribution}. {config.notes}
            </p>
          </div>
        )}
      </div>

      {hovered && (
        <div className="globe-panel globe-panel-zone">
          <p className="globe-kicker">Zone</p>
          <h3>{hovered.name}</h3>
          <div className="globe-zone-stats">
            <span>{hovered.lst_celsius}°C</span>
            <span>Risk {hovered.heat_risk_score}</span>
            <span className="muted">{hovered.risk_level}</span>
          </div>
          <button type="button" className="btn-primary" onClick={() => onEnter(hovered)}>
            Open workspace
          </button>
        </div>
      )}

      <div className="globe-actions">
        <button type="button" className="btn-secondary" onClick={flyToChennai}>
          Fly to Chennai
        </button>
        <button type="button" className="btn-secondary" onClick={() => onEnter(null)}>
          Enter workspace →
        </button>
      </div>

      <p className="globe-credit">
        {zones?.length ?? 0} zones · {hotspots} hotspots · Cesium · Esri · NASA GIBS
      </p>
    </div>
  )
}
