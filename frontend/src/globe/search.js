/**
 * Place search via Nominatim (OpenStreetMap). Keyless but rate-limited to about
 * one request a second, so callers must debounce. Failures resolve to an empty
 * list — search is a convenience here, never a blocker.
 */
export async function findPlaces(query, signal) {
  const q = query.trim()
  if (q.length < 3) return []
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`
  try {
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return []
    const rows = await res.json()
    if (!Array.isArray(rows)) return []
    return rows
      .map(r => ({
        name: String(r.display_name ?? ''),
        latitude: Number(r.lat),
        longitude: Number(r.lon),
      }))
      .filter(p => p.name && Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
  } catch {
    return []
  }
}
