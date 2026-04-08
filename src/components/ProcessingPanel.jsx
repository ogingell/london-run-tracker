import { Loader2 } from 'lucide-react';

const PHASE_LABELS = {
  scan: 'Scanning runs',
  fetch: 'Loading roads',
  match: 'Matching roads',
};

export default function ProcessingPanel({ status, detail }) {
  const pct = detail?.total > 0 ? Math.round((detail.done / detail.total) * 100) : null;
  const phaseLabel = detail?.phase ? PHASE_LABELS[detail.phase] : null;

  return (
    <div className="px-4 py-3 border-b border-white/5 bg-strava/5">
      <div className="flex items-center gap-2.5">
        <Loader2 size={14} className="animate-spin text-strava flex-shrink-0" />
        <p className="text-xs text-slate-300 leading-snug">{status}</p>
      </div>

      {pct !== null && (
        <div className="mt-2.5">
          <div className="flex justify-between items-center mb-1.5">
            {phaseLabel && (
              <span className="text-xs font-medium text-slate-500">{phaseLabel}</span>
            )}
            <span className="text-xs text-slate-400 ml-auto tabular-nums">
              {detail.done}/{detail.total} · {pct}%
            </span>
          </div>
          <div className="h-1 bg-dark-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-strava to-orange-500 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
