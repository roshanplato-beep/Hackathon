import { ArcType, Cartesian3, Cartographic, Color, GeoJsonDataSource } from 'cesium'

/**
 * Country and state/province outlines drawn as vectors rather than baked into
 * raster tiles, so they stay crisp at every zoom and sit cleanly on top of the
 * temperature field instead of being tinted by it.
 *
 * Natural Earth 1:50m, public domain, bundled under /public/geo so the globe
 * does not depend on a third-party CDN at runtime.
 */

/**
 * Metres to lift the lines above the ellipsoid.
 *
 * GeoJSON coordinates land at height 0, exactly on the globe surface, where
 * they z-fight and vanish. `clampToGround: true` is the documented fix but
 * produced no GroundPolylinePrimitive here, so the lines never rendered at all.
 * A small explicit offset is deterministic and needs no ground-primitive
 * support: 2km is 0.03% of Earth's radius, invisible as parallax at any zoom
 * this globe uses.
 */
const LINE_HEIGHT_M = 2000

// Black reads harder than white against a saturated warm field, and matches the
// convention of conventional weather-map borders.
const LAYERS = [
  {
    id: 'countries',
    url: '/geo/countries.geojson',
    color: Color.BLACK.withAlpha(0.85),
    width: 1.6,
  },
  {
    id: 'states',
    url: '/geo/states.geojson',
    // Subordinate to country lines, but strong enough to read over a saturated
    // temperature field rather than disappearing into it.
    color: Color.BLACK.withAlpha(0.5),
    width: 1.0,
  },
]

/** Re-project a polyline's positions to a fixed height above the ellipsoid. */
function lift(positions) {
  return positions.map(position => {
    const carto = Cartographic.fromCartesian(position)
    return Cartesian3.fromRadians(carto.longitude, carto.latitude, LINE_HEIGHT_M)
  })
}

async function loadBoundaryGeoJson(url) {
  const res = await fetch(url)
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok || !type.includes('json')) {
    throw new Error(`Expected GeoJSON from ${url}, got ${res.status} ${type || 'unknown content'}`)
  }
  const data = await res.json()
  // Natural Earth exports a legacy CRS member. Coordinates are already WGS84
  // longitude/latitude, and removing it avoids Cesium attempting extra CRS
  // metadata fetches that can fail under static hosting rewrites.
  delete data.crs
  return data
}

/**
 * Load both boundary sets into the viewer.
 *
 * Returns the created data sources so the caller can remove them on teardown.
 * Failures are non-fatal: an outline that will not load should never take the
 * globe down with it.
 */
export async function addBoundaries(viewer) {
  const added = []

  for (const layer of LAYERS) {
    try {
      const data = await loadBoundaryGeoJson(layer.url)
      const source = await GeoJsonDataSource.load(data, {
        stroke: layer.color,
        strokeWidth: layer.width,
        // Boundary files are line geometry; this only guards stray polygons.
        fill: Color.TRANSPARENT,
        clampToGround: false,
      })
      source.name = layer.id

      for (const entity of source.entities.values) {
        const line = entity.polyline
        if (!line) continue
        const positions = line.positions?.getValue?.()
        if (positions?.length) line.positions = lift(positions)
        // The positions already carry the height, so draw straight segments
        // between them; geodesic arcs would re-project back onto the surface.
        line.arcType = ArcType.NONE
        line.material = layer.color
        line.width = layer.width
        line.clampToGround = false
      }

      if (viewer.isDestroyed()) return added
      await viewer.dataSources.add(source)
      added.push(source)
    } catch (e) {
      console.warn(`Boundary layer "${layer.id}" failed to load:`, e)
    }
  }

  return added
}

export function removeBoundaries(viewer, sources) {
  if (!viewer || viewer.isDestroyed()) return
  for (const source of sources) {
    viewer.dataSources.remove(source, true)
  }
}
