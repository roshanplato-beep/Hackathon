import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Rectangle, Tooltip, useMap, Circle, Marker } from 'react-leaflet';
import L from 'leaflet';
import { getHeatColorRgba } from '../utils/colors';

// Fix default marker icon issue with webpack/vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const CHENNAI_CENTER = [13.0, 80.22];
const CHENNAI_ZOOM = 12;

function createInterventionIcon(emoji) {
  return L.divIcon({
    html: `<div style="font-size:24px;text-align:center;line-height:32px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">${emoji}</div>`,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function PulsingHotspot({ position, score }) {
  const map = useMap();
  const markerRef = useRef(null);

  useEffect(() => {
    if (!map) return;
    const el = document.createElement('div');
    el.className = 'pulse-marker';
    el.style.cssText = `
      width: 14px; height: 14px;
      background: #ef4444;
      border-radius: 50%;
      border: 2px solid #fca5a5;
      box-shadow: 0 0 12px rgba(239,68,68,0.8);
      animation: pulse 2s ease-in-out infinite;
    `;
    const icon = L.divIcon({ html: el.outerHTML, className: '', iconSize: [14, 14], iconAnchor: [7, 7] });
    const marker = L.marker(position, { icon, interactive: false }).addTo(map);
    markerRef.current = marker;
    return () => { marker.remove(); };
  }, [map, position]);

  return null;
}

function FlyToZone({ center }) {
  const map = useMap();
  useEffect(() => {
    if (!center) return;
    const [lat, lon] = center;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    // Leaflet projects against the container size; if the map is hidden or
    // still zero-sized (background tab, collapsed pane), flyTo produces
    // Invalid LatLng (NaN, NaN) and throws, which takes the whole app down.
    const { x, y } = map.getSize();
    if (x === 0 || y === 0) {
      map.setView(center, 14, { animate: false });
      return;
    }
    map.flyTo(center, 14, { duration: 0.8 });
  }, [center, map]);
  return null;
}

export default function HeatMap({
  zones,
  selectedZone,
  onZoneClick,
  simulationData,
  interventionMarkers,
  thermalConfig,
  thermalEnabled,
  thermalIntensity = 0.7,
}) {
  const getZoneColor = (zone) => {
    if (simulationData?.affected_zones?.[zone.id]) {
      return getHeatColorRgba(simulationData.affected_zones[zone.id].new_score, 0.6);
    }
    return getHeatColorRgba(zone.heat_risk_score, 0.55);
  };

  const getZoneWeight = (zone) => {
    return selectedZone?.id === zone.id ? 3 : 1;
  };

  const getZoneBorderColor = (zone) => {
    return selectedZone?.id === zone.id ? '#ffffff' : 'rgba(255,255,255,0.3)';
  };

  const hotspots = zones.filter(z => z.heat_risk_score >= 55).slice(0, 10);

  return (
    <MapContainer
      center={CHENNAI_CENTER}
      zoom={CHENNAI_ZOOM}
      style={{ width: '100%', height: '100%' }}
      zoomControl={false}
    >
      {/* Esri Dark Gray Canvas, split into base + labels so zone fills sit
          between them. CARTO's dark_all now watermarks every tile with
          "API KEY REQUIRED"; these are keyless, and match the globe's imagery
          source. */}
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; Esri'
        maxZoom={16}
      />
      {/* NASA GIBS land-surface temperature. The backend hands us an EPSG:3857
          template, which is Leaflet's native projection. Levels stop at 7, so
          Leaflet upsamples past that rather than requesting 404s. */}
      {thermalEnabled && thermalConfig && (
        <TileLayer
          url={thermalConfig.tile_url_template}
          opacity={thermalIntensity}
          maxNativeZoom={thermalConfig.max_zoom}
          maxZoom={16}
          attribution={thermalConfig.attribution}
        />
      )}

      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
        maxZoom={16}
      />

      {zones.map((zone) => (
        <Rectangle
          key={zone.id}
          bounds={zone.bounds}
          pathOptions={{
            color: getZoneBorderColor(zone),
            weight: getZoneWeight(zone),
            fillColor: getZoneColor(zone),
            fillOpacity: 1,
            className: 'zone-rect',
          }}
          eventHandlers={{
            click: () => onZoneClick(zone),
          }}
        >
          <Tooltip sticky>
            <div style={{ fontFamily: 'system-ui', fontSize: '13px' }}>
              <strong>{zone.name}</strong><br />
              {simulationData?.affected_zones?.[zone.id] ? (
                <>
                  <span style={{ color: '#ef4444', textDecoration: 'line-through' }}>
                    {zone.lst_celsius}°C
                  </span>{' '}
                  <span style={{ color: '#22c55e' }}>
                    → {simulationData.affected_zones[zone.id].new_lst}°C
                  </span><br />
                  <span style={{ color: '#22c55e' }}>
                    ↓ {simulationData.affected_zones[zone.id].temp_reduction}°C
                  </span>
                </>
              ) : (
                <>🌡️ {zone.lst_celsius}°C &nbsp; Score: {zone.heat_risk_score}</>
              )}
            </div>
          </Tooltip>
        </Rectangle>
      ))}

      {/* Pulsing hotspot markers */}
      {!selectedZone && hotspots.map(zone => (
        <PulsingHotspot key={`pulse-${zone.id}`} position={zone.center} score={zone.heat_risk_score} />
      ))}

      {/* Simulation effect radius */}
      {simulationData && selectedZone && (
        <Circle
          center={selectedZone.center}
          radius={simulationData.effect_radius_m}
          pathOptions={{
            color: '#22c55e',
            weight: 2,
            fillColor: 'rgba(34, 197, 94, 0.1)',
            fillOpacity: 0.3,
            dashArray: '8 4',
          }}
        />
      )}

      {/* Intervention markers */}
      {interventionMarkers?.map((marker, i) => (
        <Marker
          key={`intv-${i}`}
          position={marker.position}
          icon={createInterventionIcon(marker.icon)}
        />
      ))}

      {selectedZone && <FlyToZone center={selectedZone.center} />}
    </MapContainer>
  );
}
