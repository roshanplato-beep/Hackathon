const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : '');
// A public serverless demo has no shared user database. Keep hosted plans and
// field notes private to this browser rather than writing ephemeral server files.
export const DEVICE_STORAGE = import.meta.env.PROD && !import.meta.env.VITE_API_URL;
function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

/**
 * Tile template and legend for the thermal layer. The backend resolves which
 * GIBS imagery date is actually published, so the browser never guesses.
 * `layer` is 'composite' (8-day, default) or 'daily'.
 */
export async function fetchThermalConfig(layer) {
  const qs = layer ? `?layer=${encodeURIComponent(layer)}` : '';
  const res = await fetch(`${API_BASE}/api/thermal/config${qs}`);
  if (!res.ok) throw new Error('Failed to fetch thermal config');
  const config = await res.json();
  // Keyed layers come back as a backend-relative proxy path so the API key
  // never reaches the browser; make it absolute for the map clients.
  if (config.tile_url_is_relative) {
    config.tile_url_template = `${API_BASE}${config.tile_url_template}`;
  }
  if (config.proxy_url_template?.startsWith('/')) {
    config.proxy_url_template = `${API_BASE}${config.proxy_url_template}`;
  }
  return config;
}

async function postJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return res.json();
}

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return res.json();
}

/** Which fields are measured, which are modelled, and from what source. */
export function fetchProvenance() {
  return getJson('/api/provenance');
}

/** Live measured 2m air temperature. Not surface temperature. */
export async function fetchLiveClimate(zoneId) {
  const res = await fetch(`${API_BASE}/api/climate/live${zoneId ? `?zone_id=${encodeURIComponent(zoneId)}` : ''}`, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error('Live weather unavailable');
  return res.json();
}

export async function fetchVRBootstrap(signal) {
  const res = await fetch(`${API_BASE}/api/vr/bootstrap`, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) });
  if (!res.ok) throw new Error('VR profiles unavailable');
  return res.json();
}

/** Itemised cost estimate for a zone's selected interventions. */
export function fetchEstimate(payload) {
  return postJson('/api/estimate', payload);
}

export async function savePlan(payload) {
  if (DEVICE_STORAGE) {
    const plan = { ...payload, saved_at: new Date().toISOString() };
    localStorage.setItem(`heatscape-plan-${payload.zone_id}`, JSON.stringify(plan));
    return { plan };
  }
  return postJson('/api/plan', payload);
}

export async function fetchPlan(zoneId) {
  if (DEVICE_STORAGE) return { zone_id: zoneId, plan: readLocal(`heatscape-plan-${zoneId}`, null) };
  return getJson(`/api/plan/${zoneId}`);
}

export async function saveSurvey(payload) {
  if (DEVICE_STORAGE) {
    const survey = { ...payload, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    const records = readLocal('heatscape-surveys', []);
    localStorage.setItem('heatscape-surveys', JSON.stringify([...records, survey]));
    return { survey };
  }
  return postJson('/api/surveys', payload);
}

export async function fetchSurveys(zoneId) {
  if (DEVICE_STORAGE) return { surveys: readLocal('heatscape-surveys', []).filter(r => !zoneId || r.zone_id === zoneId) };
  return getJson(`/api/surveys${zoneId ? `?zone_id=${encodeURIComponent(zoneId)}` : ''}`);
}

export async function fetchZones() {
  try {
    const res = await fetch(`${API_BASE}/api/zones`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error('Failed to fetch zones');
    return await res.json();
  } catch {
    const res = await fetch('/vr/profiles.json', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('API and bundled zone snapshot unavailable');
    const snapshot = await res.json();
    const zones = Object.values(snapshot.profiles).map(d => d.zone).sort((a,b) => b.heat_risk_score-a.heat_risk_score);
    return { zones, meta: { city:'Chennai', total:zones.length, snapshot:snapshot.generated_at, baseline_provenance:snapshot.baseline } };
  }
}

export async function fetchZoneDetail(zoneId) {
  const res = await fetch(`${API_BASE}/api/zones/${zoneId}`);
  if (!res.ok) throw new Error('Failed to fetch zone detail');
  return res.json();
}

export async function simulateIntervention(zoneId, interventionId) {
  const res = await fetch(`${API_BASE}/api/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone_id: zoneId, intervention_id: interventionId }),
  });
  if (!res.ok) throw new Error('Simulation failed');
  return res.json();
}

export async function diagnoseZone(zoneId) {
  const res = await fetch(`${API_BASE}/api/diagnose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone_id: zoneId }),
  });
  if (!res.ok) throw new Error('Diagnosis failed');
  return res.json();
}

export async function generateReport(zoneId, interventionIds = []) {
  const res = await fetch(`${API_BASE}/api/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone_id: zoneId, interventions: interventionIds }),
  });
  if (!res.ok) throw new Error('Report generation failed');
  return res.json();
}
