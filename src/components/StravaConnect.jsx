import { RefreshCw, LogOut, Plug, Map, Globe } from 'lucide-react';

export default function StravaConnect({ auth, onConnect, onDisconnect, onSync, onFullScan, onRebuild, processing }) {
  if (!auth?.connected) {
    return (
      <button
        onClick={onConnect}
        className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl
                   bg-gradient-to-r from-strava to-orange-600 hover:from-strava-dark hover:to-orange-700
                   text-white font-semibold text-sm transition-all duration-200
                   shadow-lg shadow-strava/20 hover:shadow-strava/40 active:scale-[0.98] cursor-pointer"
      >
        <Plug size={16} />
        Connect with Strava
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs font-medium truncate">{auth.athlete?.name}</span>
        </div>
      </div>

      <button
        onClick={onSync}
        disabled={processing}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                   bg-strava/15 text-strava hover:bg-strava/25 transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        title="Sync new activities only"
      >
        <RefreshCw size={12} className={processing ? 'animate-spin' : ''} />
        {processing ? 'Processing...' : 'Sync'}
      </button>

      <button
        onClick={onFullScan}
        disabled={processing}
        className="p-1.5 rounded-lg text-slate-500 hover:text-neon-purple
                   hover:bg-neon-purple/10 transition-colors cursor-pointer disabled:opacity-30"
        title="Scan all London postcodes (slow, one-time)"
      >
        <Globe size={14} />
      </button>

      <button
        onClick={onRebuild}
        disabled={processing}
        className="p-1.5 rounded-lg text-slate-500 hover:text-neon-cyan
                   hover:bg-neon-cyan/10 transition-colors cursor-pointer disabled:opacity-30"
        title="Rebuild postcode boundaries from OpenStreetMap"
      >
        <Map size={14} />
      </button>

      <button
        onClick={onDisconnect}
        className="p-1.5 rounded-lg text-slate-500 hover:text-red-400
                   hover:bg-red-500/10 transition-colors cursor-pointer"
        title="Disconnect Strava"
      >
        <LogOut size={14} />
      </button>
    </div>
  );
}
