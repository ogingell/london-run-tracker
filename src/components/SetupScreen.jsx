import { useState } from 'react';
import { MapPin, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';

export default function SetupScreen({ onComplete }) {
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  const handleSetup = async () => {
    setStatus('loading');
    setError(null);

    try {
      await api.setupPostcodes((data) => {
        if (data.progress) {
          setProgress(data);
        }
        if (data.done) {
          setStatus('done');
        }
        if (data.error) {
          setError(data.error);
          setStatus('error');
        }
      });
      setStatus('done');
      setTimeout(() => onComplete(), 1000);
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  };

  return (
    <div className="h-screen w-screen bg-dark-900 flex items-center justify-center">
      <div className="max-w-md w-full mx-4">
        <div className="text-center mb-8 animate-fade-in">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-strava to-orange-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-strava/30">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">London Run Tracker</h1>
          <p className="text-slate-400 text-sm">Track every road you run across London</p>
        </div>

        <div className="glass rounded-2xl p-6 animate-fade-in" style={{ animationDelay: '100ms' }}>
          <div className="flex items-center gap-3 mb-4">
            <MapPin size={20} className="text-neon-cyan" />
            <div>
              <h2 className="font-semibold text-sm">Setup Postcode Boundaries</h2>
              <p className="text-xs text-slate-500">
                Fetching London postcode districts from postcodes.io
              </p>
            </div>
          </div>

          {status === 'idle' && (
            <button
              onClick={handleSetup}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-neon-cyan to-neon-blue
                         text-white font-semibold text-sm hover:opacity-90 transition-opacity
                         shadow-lg shadow-neon-cyan/20 active:scale-[0.98] cursor-pointer"
            >
              Initialize London Map
            </button>
          )}

          {status === 'loading' && (
            <div className="text-center py-4">
              <Loader2 size={24} className="animate-spin mx-auto text-neon-cyan mb-3" />
              <p className="text-sm text-slate-300">Setting up postcode boundaries...</p>
              {progress && (
                <p className="text-xs text-slate-500 mt-2">
                  Processed {progress.progress} outcodes, added {progress.added}
                </p>
              )}
              <p className="text-xs text-slate-600 mt-2">
                This may take a few minutes on first run
              </p>
            </div>
          )}

          {status === 'done' && (
            <div className="text-center py-4 animate-fade-in">
              <CheckCircle size={24} className="mx-auto text-neon-cyan mb-3" />
              <p className="text-sm text-neon-cyan font-medium">Setup complete!</p>
              <p className="text-xs text-slate-500 mt-1">Loading your map...</p>
            </div>
          )}

          {status === 'error' && (
            <div className="text-center py-4">
              <AlertCircle size={24} className="mx-auto text-red-400 mb-3" />
              <p className="text-sm text-red-400">{error}</p>
              <button
                onClick={handleSetup}
                className="mt-3 px-4 py-2 rounded-lg bg-dark-600 text-sm hover:bg-dark-500 transition-colors cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-600 mt-6 animate-fade-in" style={{ animationDelay: '200ms' }}>
          Uses free OpenStreetMap data and postcodes.io API. No costs involved.
        </p>
      </div>
    </div>
  );
}
