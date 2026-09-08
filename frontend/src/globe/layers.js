import { UrlTemplateImageryProvider, WebMercatorTilingScheme } from 'cesium'

// Keyless on purpose: no Cesium Ion token, no MapTiler key.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'

export function satelliteProvider() {
  return new UrlTemplateImageryProvider({
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    tilingScheme: new WebMercatorTilingScheme(),
    maximumLevel: 19,
    credit: 'Esri, Maxar, Earthstar Geographics',
  })
}

/** Country borders and place names, drawn over the imagery. */
export function labelsProvider() {
  return new UrlTemplateImageryProvider({
    url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
    tilingScheme: new WebMercatorTilingScheme(),
    maximumLevel: 19,
    credit: 'Esri',
  })
}

/**
 * Thermal layer built from the backend's /api/thermal/config response, so the
 * imagery date is resolved server-side rather than guessed here.
 *
 * The config always describes the EPSG:3857 GIBS endpoint, whose
 * GoogleMapsCompatible matrix set is power-of-two and therefore an exact fit
 * for WebMercatorTilingScheme.
 */
export function thermalProvider(config) {
  return new UrlTemplateImageryProvider({
    url: config.proxy_url_template ?? config.tile_url_template,
    tilingScheme: new WebMercatorTilingScheme(),
    tileWidth: config.tile_size,
    tileHeight: config.tile_size,
    maximumLevel: config.max_zoom,
    credit: config.attribution,
  })
}
