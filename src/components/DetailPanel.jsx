import { useState, useEffect, useMemo } from 'react';
import { X, Search, CheckCircle2, Circle, Route, ChevronDown } from 'lucide-react';
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

function RoadRow({ road }) {
  const pct = road.length_m > 0
    ? Math.min(100, (road.covered_length_m / road.length_m) * 100)
    : 0;
  const partial = road.covered && pct < 95;

  return (
    <div className={`flex items-center gap-2.5 px-4 py-2 border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors`}>
      {road.covered
        ? <CheckCircle2 size={13} className={partial ? 'text-amber-400 flex-shrink-0' : 'text-emerald-400 flex-shrink-0'} />
        : <Circle size={13} className="text-slate-700 flex-shrink-0" />
      }
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-xs font-medium truncate text-slate-200">{road.name}</span>
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
        {road.covered ? `${fmt(road.covered_length_m)} / ` : ''}{fmt(road.length_m)}
      </span>
    </div>
  );
}

export default function DetailPanel({ mode, selectedId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('unrun'); // 'unrun' | 'run'
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!selectedId) { setData(null); return; }
    setLoading(true);
    setTab('unrun');
    setSearch('');
    setShowAll(false);
    api.getRoadDetail(mode, selectedId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedId, mode]);

  const { runRoads, unrunRoads } = useMemo(() => {
    if (!data?.roads) return { runRoads: [], unrunRoads: [] };
    const q = search.toLowerCase();
    const filtered = q
      ? data.roads.filter(r => r.name.toLowerCase().includes(q))
      : data.roads;
    return {
      runRoads: filtered.filter(r => r.covered),
      unrunRoads: filtered.filter(r => !r.covered),
    };
  }, [data, search]);

  if (!selectedId) return null;

  const label = mode === 'postcodes' ? selectedId : data?.name || selectedId;
  const activeList = tab === 'run' ? runRoads : unrunRoads;
  const LIMIT = 60;
  const visible = showAll ? activeList : activeList.slice(0, LIMIT);

  return (
    <div className="absolute bottom-0 left-0 right-0 z-[1000] flex flex-col bg-dark-800 border-t border-white/10 shadow-2xl"
         style={{ maxHeight: '42vh' }}>
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

        {/* Search */}
        <div className="relative flex-shrink-0">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search roads..."
            className="pl-6 pr-2 py-1 text-xs bg-dark-700 border border-white/10 rounded-md text-slate-200
                       placeholder-slate-600 focus:outline-none focus:border-strava/50 w-36"
          />
        </div>

        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer flex-shrink-0">
          <X size={15} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5 flex-shrink-0">
        <button
          onClick={() => { setTab('unrun'); setShowAll(false); }}
          className={`flex-1 py-2 text-xs font-semibold transition-colors cursor-pointer
            ${tab === 'unrun' ? 'text-white border-b-2 border-strava' : 'text-slate-500 hover:text-slate-300'}`}
        >
          Not Run
          {data && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-dark-600 text-slate-400 text-[10px]">{unrunRoads.length}</span>}
        </button>
        <button
          onClick={() => { setTab('run'); setShowAll(false); }}
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
        ) : activeList.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-600">
            {search ? 'No roads match your search.' : tab === 'run' ? 'No roads run here yet.' : 'All roads run! 🎉'}
          </div>
        ) : (
          <>
            {visible.map(road => <RoadRow key={road.id} road={road} />)}
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
