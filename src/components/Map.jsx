import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, GeoJSON, Polyline, useMap } from 'react-leaflet';
import polylineCodec from '@mapbox/polyline';

const LONDON_CENTER = [51.505, -0.118];
const LONDON_ZOOM = 11;
const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const DARK_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

function coverageColor(pct) {
  if (pct === 0) return '#1e293b';
  if (pct < 5) return '#7f1d1d';
  if (pct < 15) return '#b91c1c';
  if (pct < 30) return '#dc2626';
  if (pct < 50) return '#f59e0b';
  if (pct < 70) return '#84cc16';
  if (pct < 85) return '#22c55e';
  return '#06d6a0';
}

function coverageOpacity(pct, roadsFetched) {
  if (!roadsFetched) return 0.12;
  if (pct === 0) return 0.18;
  return 0.28 + (pct / 100) * 0.42;
}

function BoundaryLayer({ data, mode, selectedItem, onItemSelect }) {
  const geoJsonRef = useRef();
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
    return {
      fillColor: coverageColor(coveragePct),
      fillOpacity: isSelected ? 0.72 : coverageOpacity(coveragePct, roadsFetched),
      color: isSelected ? '#f1f5f9' : coverageColor(coveragePct),
      weight: isSelected ? 2.5 : mode === 'places' ? 0.5 : 0.8,
      opacity: isSelected ? 1 : 0.4,
    };
  }, [selectedItem, mode]);

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
      if (geoJsonRef.current) geoJsonRef.current.resetStyle(e.target);
    });
  }, [selectedItem, onItemSelect, mode]);

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
      ref={geoJsonRef}
      key={`${mode}-${JSON.stringify(data.features.map(f => f.properties.coveragePct))}`}
      data={data}
      style={style}
      onEachFeature={onEachFeature}
    />
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

export default function Map({ boundaries, mode, polylines, selectedItem, onItemSelect }) {
  return (
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
      />
    </MapContainer>
  );
}
