import { Activity, Route, Percent, Footprints } from 'lucide-react';

function StatCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="glass rounded-xl p-3 flex items-center gap-3 animate-count-up">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <div className="font-mono font-bold text-sm truncate">{value}</div>
        <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
        {sub && <div className="text-[10px] text-slate-600">{sub}</div>}
      </div>
    </div>
  );
}

export default function StatsBar({ stats }) {
  if (!stats) return null;

  const totalKm = (stats.totalDistance / 1000).toFixed(0);
  const coveredKm = (stats.totals.covered_length / 1000).toFixed(1);
  const totalRoadKm = (stats.totals.total_length / 1000).toFixed(1);

  return (
    <div className="px-4 py-3 border-b border-white/5">
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          icon={Activity}
          label="Activities"
          value={stats.activityCount.toLocaleString()}
          color="bg-strava/20 text-strava"
        />
        <StatCard
          icon={Route}
          label="Distance"
          value={`${totalKm} km`}
          color="bg-neon-blue/20 text-neon-blue"
        />
        <StatCard
          icon={Footprints}
          label="Roads Run"
          value={`${coveredKm} km`}
          sub={`of ${totalRoadKm} km`}
          color="bg-neon-cyan/20 text-neon-cyan"
        />
        <StatCard
          icon={Percent}
          label="Coverage"
          value={`${stats.totals.coveragePct}%`}
          sub={`${stats.totals.total_roads} roads`}
          color="bg-neon-purple/20 text-neon-purple"
        />
      </div>
    </div>
  );
}
