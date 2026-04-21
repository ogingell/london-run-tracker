import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, Polyline, useMap, CircleMarker } from 'react-leaflet';
import polylineCodec from '@mapbox/polyline';

const LONDON_CENTER = [51.505, -0.118];
const LONDON_ZOOM = 11;
const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const DARK_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

function coverageColor(pct) {
  if (pct === 0)   return '#1e293b'; // not entered — dark/invisible
  if (pct < 5)     return '#991b1b'; // red
  if (pct < 10)    return '#b91c1c'; // red
  if (pct < 15)    return '#ea580c'; // orange-red
  if (pct < 20)    return '#f97316'; // orange
  if (pct < 25)    return '#fb923c'; // light orange
  if (pct < 33)    return '#fbbf24'; // amber
  if (pct < 42)    return '#f59e0b'; // yellow-amber
  if (pct < 50)    return '#eab308'; // yellow
  if (pct < 60)    return '#84cc16'; // yellow-green
  if (pct < 70)    return '#4ade80'; // light green
  if (pct < 80)    return '#22c55e'; // green
  if (pct < 90)    return '#16a34a'; // medium green
  return '#15803d';                  // deep green
}

function coverageOpacity(pct, roadsFetched) {
  if (!roadsFetched) return 0.12;
  if (pct === 0) return 0.18;
  return 0.28 + (pct / 100) * 0.42;
}

const VIZ_MODES = ['heatmap', 'glow', 'runs'];
const VIZ_LABELS = { heatmap: 'Heatmap', glow: 'Glow', runs: 'Runs' };

function BoundaryLayer({ data, mode, selectedItem, onItemSelect, vizMode }) {
  const map = useMap();

  const getItemId = (feature) => {
    return mode === 'postcodes'
      ? feature.properties.postcode
      : feature.properties.id;
  };

  const getLabel = (feature) => {
    return mode === 'postcodes'
      ? feature.properties.postcode
      : feature.properties.name;
  };

  const style = useMemo(() => (feature) => {
    const { coveragePct, roadsFetched } = feature.properties;
    const id = getItemId(feature);
    const isSelected = id === selectedItem;
    const col = coverageColor(coveragePct);

    if (vizMode === 'glow') {
      // Outline-only: thin colored border + very faint fill fade
      return {
        fillColor: col,
        fillOpacity: isSelected ? 0.22 : (roadsFetched ? 0.07 : 0.03),
        color: isSelected ? '#f1f5f9' : col,
        weight: isSelected ? 2.5 : mode === 'places' ? 1 : 1.5,
        opacity: isSelected ? 1 : (roadsFetched ? 0.75 : 0.2),
      };
    }

    if (vizMode === 'runs') {
      // Nearly invisible — let the run traces speak
      return {
        fillColor: col,
        fillOpacity: isSelected ? 0.18 : 0,
        color: isSelected ? '#f1f5f9' : col,
        weight: isSelected ? 1.5 : 0.4,
        opacity: isSelected ? 0.9 : (roadsFetched ? 0.25 : 0.1),
      };
    }

    // heatmap (default)
    return {
      fillColor: col,
      fillOpacity: isSelected ? 0.72 : coverageOpacity(coveragePct, roadsFetched),
      color: isSelected ? '#f1f5f9' : col,
      weight: isSelected ? 2.5 : mode === 'places' ? 0.5 : 0.8,
      opacity: isSelected ? 1 : 0.4,
    };
  }, [selectedItem, mode, vizMode]);

  const onEachFeature = useMemo(() => (feature, layer) => {
    const { coveragePct, totalRoads, roadsFetched } = feature.properties;
    const label = getLabel(feature);
    const pctStr = roadsFetched ? `${coveragePct.toFixed(1)}%` : 'Not yet scanned';

    layer.bindTooltip(
      `<div class="font-semibold text-sm">${label}</div>
       <div class="text-xs text-slate-400">${pctStr}${roadsFetched && totalRoads ? ` · ${totalRoads} roads` : ''}</div>`,
      { className: 'postcode-tooltip', sticky: true }
    );

    layer.on('click', () => onItemSelect(getItemId(feature)));
    layer.on('mouseover', (e) => {
      if (getItemId(feature) !== selectedItem) {
        e.target.setStyle({ fillOpacity: 0.5, weight: 1.5, opacity: 0.7 });
      }
    });
    layer.on('mouseout', (e) => {
      // Re-apply the computed style directly — avoids stale ref issues with resetStyle
      e.target.setStyle(style(feature));
    });
  }, [selectedItem, onItemSelect, mode, style]);

  // Fly to selected item
  useEffect(() => {
    if (selectedItem && data) {
      const feature = data.features.find(f => getItemId(f) === selectedItem);
      if (feature) {
        try {
          const coords = feature.geometry.type === 'Polygon'
            ? feature.geometry.coordinates[0]
            : feature.geometry.coordinates[0][0];
          if (coords?.length) {
            const lats = coords.map(c => c[1]);
            const lngs = coords.map(c => c[0]);
            map.flyToBounds(
              [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
              { padding: [60, 60], duration: 0.7, maxZoom: 15 }
            );
          }
        } catch {}
      }
    }
  }, [selectedItem, data, map]);

  if (!data) return null;

  return (
    <GeoJSON
      key={`${mode}-${JSON.stringify(data.features.map(f => f.properties.coveragePct))}`}
      data={data}
      style={style}
      onEachFeature={onEachFeature}
    />
  );
}

function RoadHighlight({ road }) {
  const map = useMap();

  useEffect(() => {
    if (road?.latlngs?.length) {
      // Fit map to highlighted road with zoom floor of 16
      const lats = road.latlngs.map(p => p[0]);
      const lngs = road.latlngs.map(p => p[1]);
      map.flyToBounds(
        [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
        { padding: [80, 80], duration: 0.5, maxZoom: 17 }
      );
    }
  }, [road, map]);

  if (!road) return null;

  const color = road.covered ? '#facc15' : '#f87171'; // yellow=run, red=unrun

  return (
    <>
      {/* Glow halo */}
      <Polyline
        positions={road.latlngs}
        pathOptions={{ color, weight: 14, opacity: 0.25 }}
      />
      {/* Main highlight */}
      <Polyline
        positions={road.latlngs}
        pathOptions={{ color, weight: 5, opacity: 0.95, dashArray: road.covered ? undefined : '6 5' }}
      />
      {/* End-point dots */}
      <CircleMarker center={road.latlngs[0]} radius={5} pathOptions={{ color, fillColor: color, fillOpacity: 1, weight: 2 }} />
      <CircleMarker center={road.latlngs[road.latlngs.length - 1]} radius={5} pathOptions={{ color, fillColor: color, fillOpacity: 1, weight: 2 }} />
    </>
  );
}

function ActivityTraces({ polylines }) {
  const decoded = useMemo(() => (
    polylines.map(p => ({
      id: p.id,
      positions: polylineCodec.decode(p.polyline),
    }))
  ), [polylines]);

  return decoded.map(trace => (
    <Polyline
      key={trace.id}
      positions={trace.positions}
      pathOptions={{ color: '#fc4c02', weight: 1.5, opacity: 0.45 }}
    />
  ));
}

export default function Map({ boundaries, mode, polylines, selectedItem, onItemSelect, highlightedRoad }) {
  const [vizModeIdx, setVizModeIdx] = useState(0);
  const vizMode = VIZ_MODES[vizModeIdx];
  const cycleViz = () => setVizModeIdx(i => (i + 1) % VIZ_MODES.length);

  return (
    <div className="h-full w-full relative">
      <MapContainer
        center={LONDON_CENTER}
        zoom={LONDON_ZOOM}
        className="h-full w-full"
        zoomControl={true}
        attributionControl={true}
      >
        <TileLayer url={DARK_TILES} attribution={DARK_ATTRIBUTION} />
        {polylines.length > 0 && <ActivityTraces polylines={polylines} />}
        <BoundaryLayer
          data={boundaries}
          mode={mode}
          selectedItem={selectedItem}
          onItemSelect={onItemSelect}
          vizMode={vizMode}
        />
        <RoadHighlight road={highlightedRoad} />
      </MapContainer>

      {/* Viz mode cycle button */}
      <button
        onClick={cycleViz}
        title="Cycle visualisation mode"
        className="absolute bottom-8 right-3 z-[1000] flex items-center gap-1.5 px-2.5 py-1.5
                   bg-dark-800/90 backdrop-blur-sm border border-white/10 rounded-lg
                   text-xs font-semibold text-slate-300 hover:text-white hover:border-white/25
                   transition-all cursor-pointer shadow-lg"
      >
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">View</span>
        <span>{VIZ_LABELS[vizMode]}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-slate-500">
          <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      </button>
    </div>
  );
}
