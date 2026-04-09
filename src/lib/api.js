const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  // Auth
  getAuthStatus: () => request('/auth/status'),
  getLoginUrl: () => request('/auth/login'),
  disconnect: () => request('/auth/disconnect', { method: 'POST' }),

  // Activities
  syncActivities: () => request('/activities/sync', { method: 'POST' }),
  getPolylines: () => request('/activities/polylines'),

  // Postcodes
  getPostcodeStatus: () => request('/postcodes/status'),
  setupPostcodes: async (onProgress) => {
    const res = await fetch(`${BASE}/postcodes/setup`, { method: 'POST' });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split('\n').filter(Boolean)) {
        try { onProgress?.(JSON.parse(line)); } catch {}
      }
    }
  },
  resetPostcodes: () => request('/postcodes/reset', { method: 'POST' }),
  getBoundaries: () => request('/postcodes/boundaries'),

  // Places
  getPlacesStatus: () => request('/places/status'),
  resetPlaces: () => request('/places/reset', { method: 'POST' }),
  computePlacesCoverage: () => request('/places/compute-coverage', { method: 'POST' }),
  setupPlaces: async (onProgress) => {
    const res = await fetch(`${BASE}/places/setup`, { method: 'POST' });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split('\n').filter(Boolean)) {
        try { onProgress?.(JSON.parse(line)); } catch {}
      }
    }
  },
  getPlacesBoundaries: () => request('/places/boundaries'),
  getPlacesStats: () => request('/places/stats'),

  // Full London scan — fetches roads for all postcodes
  fullLondonScan: (onEvent) => {
    return new Promise((resolve, reject) => {
      fetch(`${BASE}/sync/london`, { method: 'POST' })
        .then(res => {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          function pump() {
            return reader.read().then(({ done, value }) => {
              if (done) { resolve(); return; }
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop();
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try { onEvent?.(JSON.parse(line.slice(6))); } catch {}
                }
              }
              return pump();
            });
          }
          return pump();
        })
        .catch(reject);
    });
  },

  // Delta sync — only new activities
  fullSync: (onEvent) => {
    return new Promise((resolve, reject) => {
      fetch(`${BASE}/sync/full`, { method: 'POST' })
        .then(res => {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          function pump() {
            return reader.read().then(({ done, value }) => {
              if (done) { resolve(); return; }
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop();
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try { onEvent?.(JSON.parse(line.slice(6))); } catch {}
                }
              }
              return pump();
            });
          }
          return pump();
        })
        .catch(reject);
    });
  },

  // Road detail
  getRoadDetail: (mode, id) =>
    mode === 'postcodes'
      ? request(`/roads/postcode/${encodeURIComponent(id)}`)
      : request(`/roads/place/${encodeURIComponent(id)}`),

  // Stats
  getStats: () => request('/stats'),
};
