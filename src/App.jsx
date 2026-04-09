import { useState, useEffect, useCallback } from 'react';
import Layout from './components/Layout';
import Map from './components/Map';
import Leaderboard from './components/Leaderboard';
import StatsBar from './components/StatsBar';
import StravaConnect from './components/StravaConnect';
import SetupScreen from './components/SetupScreen';
import ProcessingPanel from './components/ProcessingPanel';
import DetailPanel from './components/DetailPanel';
import ProgressView from './components/ProgressView';
import { api } from './lib/api';

export default function App() {
  const [auth, setAuth] = useState(null);
  const [boundaries, setBoundaries] = useState(null);
  const [placesBoundaries, setPlacesBoundaries] = useState(null);
  const [postcodeStatus, setPostcodeStatus] = useState(null);
  const [stats, setStats] = useState(null);
  const [placesStats, setPlacesStats] = useState(null);
  const [polylines, setPolylines] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState('');
  const [processDetail, setProcessDetail] = useState(null); // { done, total, phase }
  const [highlightedRoad, setHighlightedRoad] = useState(null);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [placesSetupStatus, setPlacesSetupStatus] = useState('');
  const [mode, setMode] = useState('postcodes'); // 'postcodes' | 'places'
  const [view, setView] = useState('map'); // 'map' | 'progress'

  useEffect(() => {
    async function init() {
      try {
        const [authRes, pcStatus] = await Promise.all([
          api.getAuthStatus(),
          api.getPostcodeStatus(),
        ]);
        setAuth(authRes);
        setPostcodeStatus(pcStatus);

        if (pcStatus.initialized) {
          const [boundaryData, statsData, placesStatus] = await Promise.all([
            api.getBoundaries(),
            api.getStats(),
            api.getPlacesStatus(),
          ]);
          setBoundaries(boundaryData);
          setStats(statsData);

          if (placesStatus.initialized) {
            const [pb, ps] = await Promise.all([api.getPlacesBoundaries(), api.getPlacesStats()]);
            setPlacesBoundaries(pb);
            setPlacesStats(ps);
          } else {
            // Auto-trigger places setup in the background — runs once, takes ~10s
            runPlacesSetup();
          }

          if (authRes.connected) {
            const polys = await api.getPolylines();
            setPolylines(polys);
          }
        }
      } catch (err) {
        console.error('Init error:', err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const handleConnect = useCallback(async () => {
    const { url } = await api.getLoginUrl();
    window.location.href = url;
  }, []);

  const handleDisconnect = useCallback(async () => {
    await api.disconnect();
    setAuth({ connected: false });
    setPolylines([]);
    const [freshStats] = await Promise.all([api.getStats()]);
    setStats(freshStats);
  }, []);

  const handleSync = useCallback(async () => {
    setProcessing(true);
    setProcessStatus('Syncing activities from Strava...');
    setProcessDetail(null);

    try {
      const result = await api.syncActivities();
      const newCount = result.synced ?? 0;
      setProcessStatus(
        newCount > 0
          ? `${newCount} new ${newCount === 1 ? 'run' : 'runs'} fetched — matching now...`
          : `${result.total} total runs on file — checking for unmatched...`
      );

      const polys = await api.getPolylines();
      setPolylines(polys);

      let lastRefresh = Date.now();
      await api.fullSync(async (event) => {
        if (event.type === 'progress' || event.type === 'status') {
          setProcessStatus(event.message);
        }
        if (event.type === 'progress' && event.done !== undefined) {
          setProcessDetail({ done: event.done, total: event.total, phase: event.phase });
        }
        if (event.type === 'error') {
          setProcessStatus(`Error: ${event.message}`);
        }
        if (event.postcode && Date.now() - lastRefresh > 5000) {
          lastRefresh = Date.now();
          const [freshStats, freshBounds] = await Promise.all([
            api.getStats(),
            api.getBoundaries(),
          ]);
          setStats(freshStats);
          setBoundaries(freshBounds);
        }
      });

      // Final refresh — postcodes + places
      const [freshStats, freshBounds, freshPlacesStats, freshPlacesBounds] = await Promise.all([
        api.getStats(),
        api.getBoundaries(),
        api.getPlacesStats(),
        api.getPlacesBoundaries(),
      ]);
      setStats(freshStats);
      setBoundaries(freshBounds);
      setPlacesStats(freshPlacesStats);
      setPlacesBoundaries(freshPlacesBounds);
      setProcessStatus('Done!');
      setProcessDetail(null);
    } catch (err) {
      setProcessStatus(`Error: ${err.message}`);
      setProcessDetail(null);
    } finally {
      setTimeout(() => {
        setProcessing(false);
        setProcessStatus('');
        setProcessDetail(null);
      }, 3000);
    }
  }, []);

  const runPlacesSetup = useCallback(async () => {
    setPlacesLoading(true);
    setPlacesSetupStatus('Fetching neighbourhood boundaries from OpenStreetMap...');
    try {
      await api.setupPlaces((data) => {
        if (data.message) setPlacesSetupStatus(data.message);
        if (data.error) setPlacesSetupStatus(`Error: ${data.error}`);
        if (data.done) {
          setPlacesSetupStatus(`${data.total} neighbourhoods loaded`);
          Promise.all([api.getPlacesBoundaries(), api.getPlacesStats()]).then(([pb, ps]) => {
            setPlacesBoundaries(pb);
            setPlacesStats(ps);
          });
        }
      });
    } catch (err) {
      setPlacesSetupStatus(`Failed: ${err.message}. Click retry to try again.`);
    } finally {
      setPlacesLoading(false);
    }
  }, []);

  const handleSetupComplete = useCallback(async () => {
    setPostcodeStatus({ initialized: true });
    runPlacesSetup();
    const [boundaryData, statsData] = await Promise.all([
      api.getBoundaries(),
      api.getStats(),
    ]);
    setBoundaries(boundaryData);
    setStats(statsData);
  }, [runPlacesSetup]);

  const handleFullLondonScan = useCallback(async () => {
    setProcessing(true);
    setProcessStatus('Starting full London scan...');
    setProcessDetail(null);
    try {
      let lastRefresh = Date.now();
      await api.fullLondonScan(async (event) => {
        if (event.type === 'progress' || event.type === 'status') {
          setProcessStatus(event.message);
        }
        if (event.type === 'progress' && event.done !== undefined) {
          setProcessDetail({ done: event.done, total: event.total, phase: event.phase });
        }
        if (event.type === 'error') setProcessStatus(`Error: ${event.message}`);
        if ((event.postcode || event.type === 'status') && Date.now() - lastRefresh > 6000) {
          lastRefresh = Date.now();
          const [freshStats, freshBounds] = await Promise.all([api.getStats(), api.getBoundaries()]);
          setStats(freshStats);
          setBoundaries(freshBounds);
        }
      });
      const [freshStats, freshBounds, freshPlacesStats, freshPlacesBounds] = await Promise.all([
        api.getStats(), api.getBoundaries(), api.getPlacesStats(), api.getPlacesBoundaries(),
      ]);
      setStats(freshStats);
      setBoundaries(freshBounds);
      setPlacesStats(freshPlacesStats);
      setPlacesBoundaries(freshPlacesBounds);
      setProcessStatus('Full London scan complete!');
      setProcessDetail(null);
    } catch (err) {
      setProcessStatus(`Error: ${err.message}`);
      setProcessDetail(null);
    } finally {
      setTimeout(() => { setProcessing(false); setProcessStatus(''); setProcessDetail(null); }, 3000);
    }
  }, []);

  const handleRebuildBoundaries = useCallback(async () => {
    if (!confirm('Delete all boundary and road data, then rebuild from OpenStreetMap?')) return;
    setLoading(true);
    await api.resetPostcodes();
    setPostcodeStatus({ initialized: false });
    setBoundaries(null);
    setPlacesBoundaries(null);
    setStats(null);
    setPlacesStats(null);
    setLoading(false);
  }, []);

  const handleItemSelect = useCallback((id) => {
    setSelectedItem(prev => prev === id ? null : id);
    setHighlightedRoad(null);
  }, []);

  const handleModeChange = useCallback((newMode) => {
    setMode(newMode);
    setSelectedItem(null);
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-dark-900">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-strava border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Loading London Run Tracker...</p>
        </div>
      </div>
    );
  }

  if (!postcodeStatus?.initialized) {
    return <SetupScreen onComplete={handleSetupComplete} />;
  }

  const activeBoundaries = mode === 'postcodes' ? boundaries : placesBoundaries;
  const activeStats = mode === 'postcodes' ? stats : null;
  const activePlacesStats = mode === 'places' ? placesStats : null;

  return (
    <Layout>
      <div className="flex h-screen">
        {/* Sidebar */}
        <div className="w-96 flex-shrink-0 flex flex-col bg-dark-800 border-r border-white/5 z-10">
          {/* Header */}
          <div className="p-5 border-b border-white/5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-strava to-orange-600 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight">London Run Tracker</h1>
                <p className="text-xs text-slate-500">Every street. Every postcode.</p>
              </div>
            </div>

            <StravaConnect
              auth={auth}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onSync={handleSync}
              onFullScan={handleFullLondonScan}
              onRebuild={handleRebuildBoundaries}
              processing={processing}
            />
          </div>

          {/* Mode toggle */}
          <div className="px-4 pt-3 pb-1">
            <div className="flex rounded-lg bg-dark-700 p-0.5 gap-0.5">
              <button
                onClick={() => handleModeChange('postcodes')}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  mode === 'postcodes'
                    ? 'bg-dark-500 text-white shadow'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Postcodes
              </button>
              <button
                onClick={() => handleModeChange('places')}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  mode === 'places'
                    ? 'bg-dark-500 text-white shadow'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Neighbourhoods
              </button>
            </div>
          </div>

          {/* Stats */}
          {stats && <StatsBar stats={stats} />}

          {/* Processing indicator */}
          {processing && <ProcessingPanel status={processStatus} detail={processDetail} />}

          {/* Leaderboard */}
          <div className="flex-1 overflow-hidden">
            <Leaderboard
              mode={mode}
              stats={activeStats}
              placesStats={activePlacesStats}
              selectedItem={selectedItem}
              onSelect={handleItemSelect}
              placesLoading={placesLoading}
              placesSetupStatus={placesSetupStatus}
              onSetupPlaces={runPlacesSetup}
            />
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          <Map
            boundaries={activeBoundaries}
            mode={mode}
            polylines={polylines}
            selectedItem={selectedItem}
            onItemSelect={handleItemSelect}
            highlightedRoad={highlightedRoad}
          />
          <DetailPanel
            mode={mode}
            selectedId={selectedItem}
            onClose={() => { setSelectedItem(null); setHighlightedRoad(null); }}
            onRoadSelect={setHighlightedRoad}
          />
        </div>
      </div>
    </Layout>
  );
}
