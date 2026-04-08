import { useMemo } from 'react';
import { Trophy, MapPin, ChevronRight, Lock, Loader2, RefreshCw } from 'lucide-react';

function coverageTextColor(pct) {
  if (pct === 0) return 'text-slate-500';
  if (pct < 15) return 'text-red-400';
  if (pct < 30) return 'text-orange-400';
  if (pct < 50) return 'text-yellow-400';
  if (pct < 70) return 'text-lime-400';
  if (pct < 85) return 'text-green-400';
  return 'text-emerald-400';
}

function RankBadge({ rank }) {
  if (rank === 1) return <span className="text-base leading-none">🥇</span>;
  if (rank === 2) return <span className="text-base leading-none">🥈</span>;
  if (rank === 3) return <span className="text-base leading-none">🥉</span>;
  return <span className="text-xs font-mono text-slate-500 w-5 text-center">{rank}</span>;
}

function LeaderboardRow({ id, label, rank, pct, roads, fetched, isSelected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(id)}
      className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all duration-150
        hover:bg-white/5 group cursor-pointer border-b border-white/[0.03]
        ${isSelected ? 'bg-white/[0.07] border-l-2 border-l-strava' : 'border-l-2 border-l-transparent'}`}
    >
      <RankBadge rank={rank} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-sm tracking-wide truncate">{label}</span>
          {!fetched && <Lock size={9} className="text-slate-600 flex-shrink-0" />}
        </div>

        <div className="mt-1.5 h-1 bg-dark-600 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full coverage-bar transition-all duration-700"
            style={{ width: `${Math.max(fetched ? pct : 0, 0.3)}%` }}
          />
        </div>

        {fetched && roads > 0 && (
          <div className="mt-1 text-[10px] text-slate-600">{roads} roads</div>
        )}
      </div>

      <div className="flex-shrink-0 text-right">
        <span className={`font-mono font-bold text-sm ${coverageTextColor(fetched ? pct : 0)}`}>
          {fetched ? `${pct.toFixed(1)}%` : '—'}
        </span>
      </div>

      <ChevronRight size={13} className="text-slate-600 group-hover:text-slate-400 transition-colors flex-shrink-0" />
    </button>
  );
}

export default function Leaderboard({ mode, stats, placesStats, selectedItem, onSelect, placesLoading, placesSetupStatus, onSetupPlaces }) {
  const items = useMemo(() => {
    if (mode === 'postcodes') {
      if (!stats?.postcodes) return [];
      return stats.postcodes.map(p => ({
        id: p.postcode,
        label: p.postcode,
        pct: p.coverage_pct,
        roads: p.total_roads,
        fetched: p.roads_fetched === 1,
      }));
    } else {
      if (!placesStats) return [];
      return placesStats.map(p => ({
        id: p.id,
        label: p.name,
        pct: p.coverage_pct,
        roads: p.total_roads,
        fetched: p.roads_fetched === 1,
      }));
    }
  }, [mode, stats, placesStats]);

  const scannedCount = items.filter(i => i.fetched).length;
  const title = mode === 'postcodes' ? 'Postcode Leaderboard' : 'Neighbourhood Leaderboard';

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy size={15} className="text-yellow-500" />
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <MapPin size={11} />
          <span>{scannedCount} scanned</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            {mode === 'places' ? (
              <>
                {placesLoading ? (
                  <>
                    <Loader2 size={24} className="mx-auto mb-3 animate-spin text-strava opacity-70" />
                    <p className="text-xs text-slate-400 leading-relaxed">{placesSetupStatus || 'Setting up neighbourhoods...'}</p>
                  </>
                ) : placesSetupStatus ? (
                  <>
                    <Trophy size={28} className="mx-auto mb-3 opacity-20" />
                    <p className="text-xs text-slate-400 mb-3 leading-relaxed">{placesSetupStatus}</p>
                    {placesSetupStatus.includes('Failed') || placesSetupStatus.includes('Error') ? (
                      <button
                        onClick={onSetupPlaces}
                        className="flex items-center gap-1.5 mx-auto px-3 py-1.5 rounded-lg text-xs font-medium
                                   bg-strava/15 text-strava hover:bg-strava/25 transition-colors cursor-pointer"
                      >
                        <RefreshCw size={11} />
                        Retry
                      </button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Trophy size={28} className="mx-auto mb-3 opacity-20" />
                    <p className="text-xs text-slate-400 mb-3">Neighbourhood data not set up yet.</p>
                    <button
                      onClick={onSetupPlaces}
                      className="flex items-center gap-1.5 mx-auto px-3 py-1.5 rounded-lg text-xs font-medium
                                 bg-strava/15 text-strava hover:bg-strava/25 transition-colors cursor-pointer"
                    >
                      <RefreshCw size={11} />
                      Set up now
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <Trophy size={28} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm">Connect Strava and sync to start tracking.</p>
              </>
            )}
          </div>
        ) : (
          items.map((item, i) => (
            <LeaderboardRow
              key={item.id}
              {...item}
              rank={i + 1}
              isSelected={selectedItem === item.id}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}
