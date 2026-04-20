import { useState, useEffect, useMemo } from 'react';
import { X, Search, CheckCircle2, Circle, Route, ChevronDown, Download, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

const HIGHWAY_LABELS = {
  residential: 'Residential',
  tertiary: 'Tertiary',
  secondary: 'Secondary',
  primary: 'Primary',
  unclassified: 'Unclassified',
  living_street: 'Living street',
  pedestrian: 'Pedestrian',
  footway: 'Footway',
  path: 'Path',
  cycleway: 'Cycleway',
  track: 'Track',
  bridleway: 'Bridleway',
  steps: 'Steps',
  service: 'Service',
};

function fmt(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function RoadRow({ road, isSelected, onClick }) {
  const len = road.total_length_m ?? road.length_m ?? 0;
  const pct = len > 0 ? Math.min(100, (road.covered_length_m / len) * 100) : 0;
  const partial = road.covered && pct < 95;

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-4 py-2 border-b border-white/[0.03] transition-colors text-left cursor-pointer
        ${isSelected
          ? 'bg-white/10 border-l-2 border-l-yellow-400'
          : 'hover:bg-white/[0.04] border-l-2 border-l-transparent'
        }`}
    >
      {road.covered
        ? <CheckCircle2 size={13} className={`flex-shrink-0 ${partial ? 'text-amber-400' : 'text-emerald-400'}`} />
        : <Circle size={13} className="text-slate-700 flex-shrink-0" />
      }
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className={`text-xs font-medium truncate ${isSelected ? 'text-yellow-300' : 'text-slate-200'}`}>{road.name}</span>
          <span className="text-[10px] text-slate-600 flex-shrink-0">{HIGHWAY_LABELS[road.highway_type] || road.highway_type}</span>
        </div>
        {road.covered && (
          <div className="mt-1 h-0.5 bg-dark-600 rounded-full overflow-hidden w-full">
            <div
              className={`h-full rounded-full ${partial ? 'bg-amber-400' : 'bg-emerald-400'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
      <span className="text-[10px] text-slate-500 flex-shrink-0 tabular-nums">
        {road.covered ? `${fmt(road.covered_length_m)} / ` : ''}{fmt(len)}
      </span>
    </button>
  );
}

export default function DetailPanel({ mode, selectedId, onClose, onRoadSelect, onRoadsImported }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('unrun');
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [selectedRoadId, setSelectedRoadId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');

  useEffect(() => {
    if (!selectedId) { setData(null); return; }
    setLoading(true);
    setTab('unrun');
    setSearch('');
    setShowAll(false);
    setSelectedRoadId(null);
    setImporting(false);
    setImportStatus('');
    onRoadSelect?.(null);
    api.getRoadDetail(mode, selectedId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedId, mode, reloadKey]);

  const handleImport = async () => {
    setImporting(true);
    setImportStatus('Starting…');
    try {
      await api.fetchPostcodeRoads(selectedId, (event) => {
        if (event.type === 'status' || event.type === 'progress') setImportStatus(event.message);
        if (event.type === 'error') setImportStatus(`Error: ${event.message}`);
      });
      onRoadsImported?.();
      setReloadKey(k => k + 1); // re-fetch road list
    } catch (err) {
      setImportStatus(`Error: ${err.message}`);
      setImporting(false);
    }
  };

  const { runRoads, unrunRoads } = useMemo(() => {
    if (!data?.roads) return { runRoads: [], unrunRoads: [] };
    const q = search.toLowerCase();
    const filtered = q
      ? data.roads.filter(r => r.name.toLowerCase().includes(q))
      : data.roads;
    return {
      runRoads:   filtered.filter(r =>  r.covered).sort((a, b) => b.covered_length_m - a.covered_length_m),
      unrunRoads: filtered.filter(r => !r.covered).sort((a, b) => b.total_length_m   - a.total_length_m),
    };
  }, [data, search]);

  if (!selectedId) return null;

  const handleRoadClick = (road) => {
    if (selectedRoadId === road.id) {
      setSelectedRoadId(null);
      onRoadSelect?.(null);
    } else {
      setSelectedRoadId(road.id);
      // Parse geometry and convert to [lat, lng] pairs for Leaflet
      try {
        const geom = JSON.parse(road.geometry);
        const latlngs = geom.coordinates.map(([lng, lat]) => [lat, lng]);
        onRoadSelect?.({ id: road.id, name: road.name, latlngs, covered: road.covered });
      } catch {}
    }
  };

  const label = mode === 'postcodes' ? selectedId : data?.name || selectedId;
  const activeList = tab === 'run' ? runRoads : unrunRoads;
  const LIMIT = 60;
  const visible = showAll ? activeList : activeList.slice(0, LIMIT);

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-[1000] flex flex-col bg-dark-800 border-t border-white/10 shadow-2xl"
      style={{ maxHeight: '42vh' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 flex-shrink-0">
        <Route size={14} className="text-strava flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-bold text-sm tracking-wide">{label}</span>
          {data && (
            <span className="ml-2 text-xs text-slate-500">
              {data.coverage_pct?.toFixed(1)}% covered · {fmt(data.covered_length_m ?? 0)} of {fmt(data.total_length_m ?? 0)}
            </span>
          )}
        </div>

        <div className="relative flex-shrink-0">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setShowAll(false); }}
            placeholder="Search roads..."
            className="pl-6 pr-2 py-1 text-xs bg-dark-700 border border-white/10 rounded-md text-slate-200
                       placeholder-slate-600 focus:outline-none focus:border-strava/50 w-36"
          />
        </div>

        <button
          onClick={() => { onClose(); onRoadSelect?.(null); }}
          className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer flex-shrink-0"
        >
          <X size={15} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5 flex-shrink-0">
        <button
          onClick={() => { setTab('unrun'); setShowAll(false); setSelectedRoadId(null); onRoadSelect?.(null); }}
          className={`flex-1 py-2 text-xs font-semibold transition-colors cursor-pointer
            ${tab === 'unrun' ? 'text-white border-b-2 border-strava' : 'text-slate-500 hover:text-slate-300'}`}
        >
          Not Run
          {data && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-dark-600 text-slate-400 text-[10px]">{unrunRoads.length}</span>}
        </button>
        <button
          onClick={() => { setTab('run'); setShowAll(false); setSelectedRoadId(null); onRoadSelect?.(null); }}
          className={`flex-1 py-2 text-xs font-semibold transition-colors cursor-pointer
            ${tab === 'run' ? 'text-white border-b-2 border-emerald-500' : 'text-slate-500 hover:text-slate-300'}`}
        >
          Run
          {data && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-dark-600 text-slate-400 text-[10px]">{runRoads.length}</span>}
        </button>
      </div>

      {/* Road list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-strava border-t-transparent rounded-full animate-spin" />
          </div>
        ) : mode === 'postcodes' && data && !data.roads_fetched ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3 px-6 text-center">
            <Download size={22} className="text-slate-600" />
            <p className="text-sm text-slate-400">No road data for <span className="font-bold text-white">{selectedId}</span> yet.</p>
            {importStatus && (
              <p className="text-xs text-slate-500 max-w-xs">{importStatus}</p>
            )}
            <button
              onClick={handleImport}
              disabled={importing}
              className="flex items-center gap-2 px-4 py-2 bg-strava hover:bg-strava/80 disabled:opacity-60
                         disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              {importing
                ? <><Loader2 size={12} className="animate-spin" /> Importing…</>
                : <><Download size={12} /> Import roads for {selectedId}</>
              }
            </button>
            <p className="text-xs text-slate-600">Fetches from OpenStreetMap and matches your existing runs.</p>
          </div>
        ) : activeList.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-600">
            {search ? 'No roads match your search.' : tab === 'run' ? 'No roads run here yet.' : 'All roads run! 🎉'}
          </div>
        ) : (
          <>
            {visible.map(road => (
              <RoadRow
                key={road.id}
                road={road}
                isSelected={selectedRoadId === road.id}
                onClick={() => handleRoadClick(road)}
              />
            ))}
            {!showAll && activeList.length > LIMIT && (
              <button
                onClick={() => setShowAll(true)}
                className="w-full py-2.5 flex items-center justify-center gap-1.5 text-xs text-slate-500
                           hover:text-slate-300 hover:bg-white/[0.03] transition-colors cursor-pointer"
              >
                <ChevronDown size={12} />
                Show {activeList.length - LIMIT} more
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
