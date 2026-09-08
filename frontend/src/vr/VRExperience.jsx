import { hasMappedData, currentWeather } from '../utils/dataStatus';
import { useEffect, useRef, useState } from "react";
import { createExperience } from "./scene";
import { money, TUTORIAL, weatherStatus } from "./model";
import "./vr.css";

export default function VRExperience({ zones, supported, onClose }) {
  const host = useRef(null),
    runtime = useRef(null);
  const [status, setStatus] = useState("Preparing the Chennai hologram…"),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [state, setState] = useState(null),
    [entering, setEntering] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let instance;
    createExperience(host.current, zones, {
      signal: abort.signal,
      onProgress: setStatus,
      onState: (s) => {
        if (!abort.signal.aborted) setState(s);
      },
      onError: setError,
      onExit: onClose,
    })
      .then((result) => {
        instance = result;
        if (abort.signal.aborted) {
          result.dispose();
          return;
        }
        runtime.current = result;
        setReady(true);
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError("Could not load the 3D scene: " + e.message);
      });
    return () => {
      abort.abort();
      runtime.current = null;
      instance?.dispose();
    };
  }, [zones, onClose]);
  function enter() {
    if (!runtime.current || entering) return;
    setError("");
    setEntering(true);
    runtime.current
      .enterVR()
      .catch((e) =>
        setError(
          `VR did not start: ${e.message}. Check headset permissions, then try again.`,
        ),
      )
      .finally(() => setEntering(false));
  }
  const call = (method, ...args) => runtime.current?.[method](...args);
  const z = state?.zone,
    reading = state?.reading;
  const liveStatus =
    state?.weatherError && reading ? "Cached" : weatherStatus(reading);
  return (
    <main className="vr-studio">
      <div
        className="vr-viewport"
        ref={host}
        aria-label="Interactive Chennai hologram"
      />
      <header className="vr-header">
        <button className="vr-back" onClick={onClose}>
          ← HeatScape
        </button>
        <div className="vr-wordmark">
          <span className="vr-dot" /> CHENNAI <span>/ HOLOGRAM LAB</span>
        </div>
        <div className="vr-header-actions">
          {supported && (
            <button
              className="vr-primary"
              onClick={enter}
              disabled={!ready || entering || state?.immersive}
            >
              {entering ? "Entering…" : state?.immersive ? "In VR" : "Enter VR"}
            </button>
          )}
          <button onClick={() => call("sound")} disabled={!ready}>
            Sound {state?.sound ? "on" : "off"}
          </button>
        </div>
      </header>
      {!ready && (
        <div className="vr-loading" role="status">
          <span className="vr-spinner" />
          <h1>Assembling Chennai</h1>
          <p>{status}</p>
          {error && <p role="alert">{error}</p>}
          <button onClick={onClose}>Back to dashboard</button>
        </div>
      )}
      {ready && (
        <>
          <aside className="vr-zones">
            <div className="vr-overline">CITY EXPLORER</div>
            <h1>
              18 perspectives.
              <br />
              <span>One cooler city.</span>
            </h1>
            <p className="vr-subtle">Select a zone to reveal its profile.</p>
            <div className="vr-zone-list">
              {zones.map((zone, i) => (
                <button
                  key={zone.id}
                  onClick={() => call("select", zone.id)}
                  aria-pressed={zone.id === z?.id}
                >
                  <span className="vr-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    {zone.name}
                    <small>
                      {Number.isFinite(zone.lst_celsius) ? zone.risk_level + " risk · " + zone.lst_celsius + "°C modelled" : "Heat data unavailable"}
                    </small>
                  </span>
                  <i style={{ background: zone.heat_color }} />
                </button>
              ))}
            </div>
          </aside>
          <section className="vr-detail" aria-label="Selected zone profile">
            <div className="vr-overline">
              ZONE {String(zones.indexOf(z) + 1).padStart(2, "0")} / CHENNAI
            </div>
            <h2>{z?.name}</h2>
            {(!hasMappedData(z) || state.page === 2) && <div role="status">
              <p>{state.page === 2 ? 'Cost and cooling estimates unavailable: verified rates and intervention evidence are not connected.' : 'Zone statistics unavailable: recent verified mapping inputs are missing. Fallback figures are hidden.'}</p>
              <p>{currentWeather(reading) ? reading.air_temp_c + '°C · API air temperature' : 'Current weather unavailable'}</p>
              <p className="vr-note">Open-Meteo weather model · {reading?.observed_at ?? 'timestamp unavailable'} UTC</p>
            </div>}
            <div className="vr-tabs">
              {["Profile", "Diagnosis", "Interventions"].map((label, i) => (
                <button
                  key={label}
                  onClick={() => call("page", i)}
                  aria-pressed={state.page === i}
                >
                  {label}
                </button>
              ))}
            </div>
            {hasMappedData(z) && state.page === 0 && (
              <>
                <div className="vr-metric">
                  <strong>
                    {z?.lst_celsius}°<small>C</small>
                  </strong>
                  <span>Modelled surface temperature</span>
                </div>
                <div className="vr-weather">
                  <span
                    className="vr-dot"
                    style={{
                      background: liveStatus === "Live" ? "#64efbd" : "#e1b47c",
                    }}
                  />
                  {liveStatus} air weather{" "}
                  <b>
                    {Number.isFinite(reading?.air_temp_c)
                      ? reading.air_temp_c + "°C"
                      : "Unavailable"}
                  </b>
                  <small>
                    {reading?.observed_at
                      ? `Open-Meteo · ${reading.observed_at.replace("T", " ")} UTC`
                      : "No live reading substituted"}
                  </small>
                </div>
                <dl>
                  {[
                    [
                      "Heat risk",
                      `${z?.heat_risk_score} / 100 · ${z?.risk_level}`,
                    ],
                    ["Building density", z?.building_density_pct + "%"],
                    ["Green cover", z?.green_cover_pct + "%"],
                    ["Road cover", z?.road_coverage_pct + "%"],
                    ["NDVI proxy", z?.ndvi],
                    [
                      "Estimated residents",
                      Math.round(z?.estimated_population || 0).toLocaleString(
                        "en-IN",
                      ),
                    ],
                    ["Water distance", z?.water_proximity_m + " m"],
                    [
                      "Government land",
                      Math.round(z?.govt_land_area_sqm || 0).toLocaleString(
                        "en-IN",
                      ) + " m²",
                    ],
                  ].map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="vr-note">
                  {z?.osm_fetched
                    ? "Morphology derived from OSM."
                    : "Morphology uses existing project estimates; an OSM survey is not verified."}{" "}
                  NDVI and population are estimates. {state.source}.
                </p>
              </>
            )}
            {hasMappedData(z) && state.page === 1 && (
              <>
                <h3>Why this zone heats up</h3>
                <p>
                  {state.detail?.diagnosis?.primary_cause || z?.description}
                </p>
                <ul>
                  {state.detail?.diagnosis?.contributing_factors?.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <p>{z?.description}</p>
                <p className="vr-note">
                  Computed diagnosis. Surface temperature is a morphology model,
                  not a current satellite measurement. OSM footprint geometry
                  does not validate the existing zone statistics.
                </p>
                <h3>Geometry & sources</h3>
                <p className="vr-note">
                  {state.geometry}. Building samples cover 700m around zone
                  centres; missing heights use 9m extrusions exaggerated 4× for
                  readability. Zone boxes are project study areas, not municipal
                  boundaries.
                </p>
              </>
            )}
            {false && state.page === 2 && (
              <>
                <p>
                  Choose an intervention and watch the selected zone change.
                </p>
                {state.detail?.interventions?.map((i) => (
                  <button
                    className="vr-intervention"
                    key={i.id}
                    onClick={() => call("toggle", i.id)}
                    aria-pressed={state.chosenIds.includes(i.id)}
                  >
                    <span>
                      {state.chosenIds.includes(i.id) ? "✓" : "+"} {i.name}
                    </span>
                    <strong>
                      −{i.temp_drop}°C{" "}
                      <small>{money(i.estimated_cost_inr)}</small>
                    </strong>
                    <small>
                      {i.authority}-level approval · {i.effect_radius_m}m radius
                    </small>
                    <small>{i.source}</small>
                  </button>
                ))}
                {!state.detail && (
                  <p>
                    Recommendations unavailable. Reopen the hologram to retry.
                  </p>
                )}
                <div className="vr-impact">
                  <strong>−{state.result.drop.toFixed(2)}°C</strong>
                  <span>Projected cooling</span>
                  <b>{money(state.result.total)}</b>
                  <span>Including installation, site work & contingency</span>
                </div>
                <button onClick={() => call("before")}>
                  {state.before ? "Show after intervention" : "Compare before"}
                </button>
                <button onClick={() => call("resetMeasures")}>
                  Reset measures
                </button>
                <p className="vr-note">
                  Existing literature-based model. Multiple measures use 75% of
                  summed cooling. Conceptual placement, not a CFD simulation or
                  tendered quote.
                </p>
              </>
            )}
            <button className="vr-focus" onClick={() => call("focusZone")}>
              Fly to {z?.name?.split(" (")[0]} ↗
            </button>
          </section>
          <div className="vr-tutorial">
            <span>0{state.step + 1} / 04</span>
            <div>
              <b>{TUTORIAL[state.step][0]}</b>
              <p>
                {supported
                  ? TUTORIAL[state.step][1]
                  : "Desktop: drag to orbit, scroll to zoom, click a numbered zone. Use the controls below to expand and separate."}
              </p>
            </div>
            <button onClick={() => call("nextTip")}>Next →</button>
          </div>
          <nav className="vr-tools" aria-label="Hologram controls">
            <button onClick={() => call("scale", 1.35)}>↗ Expand</button>
            <button onClick={() => call("scale", 0.75)}>↙ Contract</button>
            <button onClick={() => call("split")}>Separate layers</button>
            <button onClick={() => call("reassemble")}>Reassemble</button>
            <button onClick={() => call("home")}>⌂ Home</button>
            <button onClick={() => call("flight")} aria-pressed={state.flight}>
              Flight {state.flight ? "on" : "off"}
            </button>
          </nav>
          <footer className="vr-footer">
            <span>
              {supported
                ? "Immersive VR supported · enter above"
                : "Desktop preview · immersive VR requires a compatible headset"}
            </span>
            <span>
              {state.geometry} · {state.fps || "—"} FPS (desktop)
            </span>
            <span>
              ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                OpenStreetMap
              </a>{" "}
              · Esri, Maxar, Earthstar Geographics
            </span>
          </footer>
          {error && (
            <div className="vr-error" role="alert">
              {error}
              <button onClick={() => setError("")}>Dismiss</button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
