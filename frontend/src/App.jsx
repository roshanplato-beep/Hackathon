import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import TopNav from './components/TopNav';
import MapWorkspace from './screens/MapWorkspace';
import SitePlanner from './screens/SitePlanner';
import CostEstimate from './screens/CostEstimate';
import MobileSurvey from './screens/MobileSurvey';
import { fetchZones, fetchThermalConfig } from './utils/api';
import './App.css';
import './vr/vr.css';
const VRExperience = lazy(() => import('./vr/VRExperience'));
const GlobeLanding = lazy(() => import('./globe/GlobeLanding'));

function App() {
  const [vrOpen, setVrOpen] = useState(() => new URLSearchParams(window.location.search).get('vr') === '1');
  const [xrSupported, setXrSupported] = useState(false);
  const closeVR = useCallback(() => setVrOpen(false), []);
  useEffect(() => {
    let alive = true;
    navigator.xr?.isSessionSupported('immersive-vr').then(ok => { if (alive) setXrSupported(ok); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const [zones, setZones] = useState([]);
  const [snapshotDate, setSnapshotDate] = useState(null);
  const [selectedZone, setSelectedZone] = useState(null);
  const [simulationData, setSimulationData] = useState(null);
  const [interventionMarkers, setInterventionMarkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [entered, setEntered] = useState(false);
  const [tab, setTab] = useState('map');
  const [thermalConfig, setThermalConfig] = useState(null);
  const [thermalEnabled, setThermalEnabled] = useState(false);
  const [thermalIntensity, setThermalIntensity] = useState(0.7);
  // 8-day composite by default: a single day's pass is mostly swath gaps over
  // Chennai and reads as a broken layer.
  const [thermalLayer, setThermalLayer] = useState('composite');

  useEffect(() => {
    fetchZones()
      .then((data) => {
        setZones(data.zones);
        setSnapshotDate(data.meta?.snapshot || null);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to connect to HeatScape backend. Make sure the API is running.');
        setLoading(false);
      });
  }, []);

  // Shared with the globe, so the 2D map and the 3D globe agree on the date.
  useEffect(() => {
    fetchThermalConfig(thermalLayer)
      .then(setThermalConfig)
      .catch(() => setThermalConfig(null));
  }, [thermalLayer]);

  const handleZoneClick = (zone) => {
    setSelectedZone(zone);
    setSimulationData(null);
    setInterventionMarkers([]);
  };

  const handleSimulate = (result) => {
    setSimulationData(result);
    if (result.intervention && selectedZone) {
      const markers = [
        {
          position: selectedZone.center,
          icon: result.intervention.icon || '📍',
        },
      ];
      setInterventionMarkers(markers);
    }
  };

  const handleClearSimulation = () => {
    setSimulationData(null);
    setInterventionMarkers([]);
  };

  const handleClose = () => {
    setSelectedZone(null);
    setSimulationData(null);
    setInterventionMarkers([]);
  };

  // The globe is the entry point; picking a zone there opens it directly.
  const handleEnter = useCallback((zone) => {
    setSelectedZone(zone ?? null);
    setSimulationData(null);
    setInterventionMarkers([]);
    setEntered(true);
  }, []);

  const handleBackToGlobe = () => {
    setEntered(false);
    setSelectedZone(null);
    setSimulationData(null);
    setInterventionMarkers([]);
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <div className="loading-icon">🔥</div>
          <h1>HeatScape</h1>
          <p>Loading Chennai heat data...</p>
          <div className="loading-bar">
            <div className="loading-bar-fill"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <div className="loading-icon">⚠️</div>
          <h1>HeatScape</h1>
          <p className="error-text">{error}</p>
          <p style={{ color: '#6b7280', fontSize: '14px', marginTop: '12px' }}>
            Run: <code>cd backend && uvicorn app.main:app --reload --port 8000</code>
          </p>
        </div>
      </div>
    );
  }

  if (vrOpen) {
    return <Suspense fallback={<div className="loading-screen">Loading hologram engine…</div>}><VRExperience zones={zones} supported={xrSupported} onClose={closeVR} /></Suspense>;
  }

  const vrButton = <><button className="vr-launch" onClick={() => setVrOpen(true)}>{xrSupported ? 'Enter VR ↗' : '3D Hologram ↗'}</button>{snapshotDate && <span style={{position:'fixed',bottom:12,left:16,zIndex:80,background:'#19323d',padding:8,fontSize:12,color:'#f0c989'}}>API unavailable · bundled zone model from {snapshotDate.slice(0,10)}</span>}</>;
  if (!entered) {
    return <><Suspense fallback={<div className="loading-screen">Loading the HeatScape globe…</div>}><GlobeLanding zones={zones} onEnter={handleEnter} /></Suspense>{vrButton}</>;
  }

  return (
    <div className="app">
      {vrButton}
      <TopNav
        active={tab}
        onChange={setTab}
        onBackToGlobe={handleBackToGlobe}
        zones={zones}
        selectedZone={selectedZone}
      />

      {tab === 'map' && (
        <MapWorkspace
          zones={zones}
          selectedZone={selectedZone}
          onZoneClick={handleZoneClick}
          onClose={handleClose}
          onSimulate={handleSimulate}
          simulationData={simulationData}
          onClearSimulation={handleClearSimulation}
          interventionMarkers={interventionMarkers}
          thermalConfig={thermalConfig}
          thermalEnabled={thermalEnabled}
          onThermalToggle={setThermalEnabled}
          thermalIntensity={thermalIntensity}
          onThermalIntensity={setThermalIntensity}
          thermalLayer={thermalLayer}
          onThermalLayerChange={setThermalLayer}
        />
      )}
      {tab === 'planner' && <SitePlanner selectedZone={selectedZone} />}
      {tab === 'cost' && <CostEstimate selectedZone={selectedZone} />}
      {tab === 'survey' && <MobileSurvey selectedZone={selectedZone} />}
    </div>
  );
}

export default App;
