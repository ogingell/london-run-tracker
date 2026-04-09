import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { TrendingUp, Route, Calendar, MapPin, Loader2, RefreshCw } from 'lucide-react';

const PERIODS = [
  { id: 'last_run', label: 'Last Run' },
  { id: 'days_7',  label: '7 Days'  },
  { id: 'days_30', label: '30 Days' },
];

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtKm(meters) {
  return (meters / 1000).toFixed(2) + ' km';
}

function fmtDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function ProgressView() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [period, setPeriod]   = useState('last_run');
  const [mode, setMode]       = useState('postcodes');

  const load = () => {
    setLoading(true);
    setError(null);
    api.getProgressSummary()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 text-slate-500">
        <Loader2 size={24} className="animate-spin" />
        <p className="text-sm">Loading progress...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 px-4">
        <p className="text-sm text-red-400 text-center">{error}</p>
        <button onClick={load} className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 cursor-pointer">
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    );
  }

  const periodData = { last_run: data?.lastRun, days_7: data?.days7, days_30: data?.days30 }[period];
  const areaItems  = mode === 'postcodes' ? (periodData?.byPostcode ?? []) : (periodData?.byPlace ?? []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Period tabs */}
      <div className="px-4 pt-3 pb-2 border-b border-white/5 flex-shrink-0">
        <div className="flex rounded-lg bg-dark-700 p-0.5 gap-0.5">
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                period === p.id ? 'bg-dark-500 text-white shadow' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Last run label */}
        {period === 'last_run' && data?.lastRunDate && (
          <p className="text-xs text-slate-500 mt-2 text-center truncate">
            {periodData?.activities?.[0]?.name
              ? <span className="text-slate-300">{periodData.activities[0].name}</span>
              : 'Last run'
            }
            <span className="mx-1">·</span>{formatDate(data.lastRunDate)}
          </p>
        )}
      </div>

      {!periodData || (periodData.newRoads === 0 && periodData.activityCount === 0) ? (
        <EmptyState period={period} />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-2 p-4 flex-shrink-0">
            <StatCard icon={Route}      label="New Roads"     value={periodData.newRoads} />
            <StatCard icon={TrendingUp} label="New Distance"  value={fmtKm(periodData.newDistanceM)} />
            {period !== 'last_run' && (
              <>
                <StatCard icon={Calendar} label="Runs"           value={periodData.activityCount} />
                <StatCard icon={MapPin}   label="Areas Improved" value={periodData.byPostcode.length} />
              </>
            )}
          </div>

          {/* Last run activity detail */}
          {period === 'last_run' && periodData.activities?.[0] && (
            <div className="mx-4 mb-3 bg-dark-700 rounded-lg px-3 py-2 flex gap-4 text-xs flex-shrink-0">
              <span className="text-slate-400">{fmtKm(periodData.activities[0].distance)}</span>
              <span className="text-slate-400">{fmtDuration(periodData.activities[0].moving_time)}</span>
            </div>
          )}

          {/* Recent runs list (7d / 30d) */}
          {period !== 'last_run' && periodData.activities?.length > 0 && (
            <div className="mx-4 mb-3 flex-shrink-0">
              <p className="text-xs text-slate-500 mb-1.5 font-semibold uppercase tracking-wide">Runs</p>
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {periodData.activities.map(a => (
                  <div key={a.id} className="flex justify-between items-center text-xs py-0.5">
                    <span className="text-slate-300 truncate flex-1 mr-2">{a.name || 'Unnamed run'}</span>
                    <span className="text-slate-500 flex-shrink-0">{fmtKm(a.distance)} · {formatDate(a.start_date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mode toggle */}
          <div className="px-4 pb-2 flex-shrink-0">
            <div className="flex rounded-lg bg-dark-700 p-0.5 gap-0.5">
              <ModeBtn active={mode === 'postcodes'} onClick={() => setMode('postcodes')}>Postcodes</ModeBtn>
              <ModeBtn active={mode === 'places'}    onClick={() => setMode('places')}>Neighbourhoods</ModeBtn>
            </div>
          </div>

          {/* Area list */}
          <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0">
            {areaItems.length === 0 ? (
              <p className="text-slate-500 text-xs text-center mt-6">
                {mode === 'places' && !data?.lastRun?.byPlace?.length
                  ? 'Set up neighbourhoods to see breakdown here.'
                  : 'No new roads in this period.'}
              </p>
            ) : (
              <div className="space-y-2">
                {areaItems.map(item => (
                  <AreaRow key={item.postcode ?? item.id} item={item} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="bg-dark-700 rounded-xl p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-slate-500">
        <Icon size={12} />
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-lg font-bold leading-none">{value}</span>
    </div>
  );
}

function ModeBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
        active ? 'bg-dark-500 text-white shadow' : 'text-slate-500 hover:text-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

function AreaRow({ item }) {
  const name      = item.postcode ?? item.name;
  const before    = Math.min(100, item.coverageBefore ?? 0);
  const delta     = Math.min(item.delta ?? 0, 100 - before);

  return (
    <div className="bg-dark-700 rounded-lg p-3">
      <div className="flex justify-between items-baseline mb-2">
        <span className="font-semibold text-sm">{name}</span>
        <span className="text-xs text-emerald-400 font-bold">+{delta.toFixed(1)}%</span>
      </div>

      {/* Coverage bar: grey = existing, green = new, dark = uncovered */}
      <div className="relative h-1.5 bg-dark-600 rounded-full overflow-hidden mb-2">
        <div
          className="absolute left-0 top-0 h-full bg-slate-600 rounded-full"
          style={{ width: `${before}%` }}
        />
        <div
          className="absolute top-0 h-full bg-emerald-500 rounded-full"
          style={{ left: `${before}%`, width: `${delta}%` }}
        />
      </div>

      <div className="flex justify-between text-xs text-slate-500">
        <span>{item.newRoads} road{item.newRoads !== 1 ? 's' : ''} · {(item.newDistanceM / 1000).toFixed(2)} km</span>
        <span>{before.toFixed(1)}% → {(item.coverageAfter ?? 0).toFixed(1)}%</span>
      </div>
    </div>
  );
}

function EmptyState({ period }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-2 px-6 text-center">
      <TrendingUp size={28} className="text-slate-600" />
      <p className="text-sm text-slate-400">
        {period === 'last_run'
          ? 'No matched runs yet. Run a sync to see your last run impact.'
          : 'No new roads covered in this period.'}
      </p>
      <p className="text-xs text-slate-600">Progress tracking populates after each sync.</p>
    </div>
  );
}
