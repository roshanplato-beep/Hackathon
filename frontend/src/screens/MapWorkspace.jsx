import HeatMap from '../components/HeatMap'
import Sidebar from '../components/Sidebar'
import ZoneList from '../components/ZoneList'
import ThermalControls from '../components/ThermalControls'

/**
 * Three-column workspace from the Stitch design: zone rail, map canvas with the
 * thermal overlay, and the zone detail panel.
 */
export default function MapWorkspace({
  zones,
  selectedZone,
  onZoneClick,
  onClose,
  onSimulate,
  simulationData,
  onClearSimulation,
  interventionMarkers,
  thermalConfig,
  thermalEnabled,
  onThermalToggle,
  thermalIntensity,
  onThermalIntensity,
  thermalLayer,
  onThermalLayerChange,
}) {
  return (
    <div className="workspace">
      <ZoneList zones={zones} selectedZone={selectedZone} onZoneClick={onZoneClick} />

      <div className="map-container">
        <HeatMap
          zones={zones}
          selectedZone={selectedZone}
          onZoneClick={onZoneClick}
          simulationData={simulationData}
          interventionMarkers={interventionMarkers}
          thermalConfig={thermalConfig}
          thermalEnabled={thermalEnabled}
          thermalIntensity={thermalIntensity}
        />
        <ThermalControls
          config={thermalConfig}
          enabled={thermalEnabled}
          onToggle={onThermalToggle}
          intensity={thermalIntensity}
          onIntensity={onThermalIntensity}
          layerKey={thermalLayer}
          onLayerChange={onThermalLayerChange}
        />
      </div>

      <Sidebar
        selectedZone={selectedZone}
        onClose={onClose}
        onSimulate={onSimulate}
        simulationData={simulationData}
        onClearSimulation={onClearSimulation}
      />
    </div>
  )
}
