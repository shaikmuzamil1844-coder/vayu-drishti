"use client";

import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import type MapLibreGL from "maplibre-gl";
import {
  Map,
  MapControls,
  MapGeoJSON,
  MapPopup,
  useMap,
} from "@/components/ui/map";

interface GridNode {
  id: number;
  lat: number;
  lon: number;
  temp: number;
  rain: number;
  humidity: number;
  wind_u: number;
  wind_v: number;
  heat_stress: number;
  risk_zone: string;
  // INSAT satellite fields (populated when sensor_type === "satellite")
  insat_lst?: number;
  insat_sst?: number | null;
  insat_rain?: number;
  sensor?: string;
}

interface ClimateMapProps {
  grid: GridNode[];
  activeOverlay: "temp" | "rain" | "risk";
  onNodeSelect: (node: GridNode | null) => void;
}

// India border polygon for subtle outline
const INDIA_BORDER_COORDS: [number, number][] = [
  [74.5,35.5],[78.5,34.3],[78.8,31.0],[80.2,30.1],[88.2,27.2],
  [91.8,28.0],[96.2,28.2],[94.5,24.0],[92.0,22.0],[88.5,22.5],
  [83.5,17.5],[80.2,13.0],[77.5,8.0],[75.0,12.0],[73.8,15.0],
  [72.8,19.0],[68.2,23.0],[68.8,24.5],[71.0,27.0],[74.2,31.0],
  [76.0,33.0],[74.5,35.5],
];

const INDIA_BORDER_GEOJSON: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [INDIA_BORDER_COORDS] },
  }],
};

/**
 * Assign a hex color to each cell based on overlay type.
 */
function getCellColor(node: GridNode, overlay: "temp" | "rain" | "risk"): string {
  if (overlay === "temp") {
    if (node.temp > 40) return "#dc2626";
    if (node.temp > 35) return "#ef4444";
    if (node.temp > 30) return "#f59e0b";
    if (node.temp > 22) return "#14b8a6";
    if (node.temp > 10) return "#00d1ff";
    return "#3b82f6";
  }
  if (overlay === "rain") {
    if (node.rain > 25) return "#065f46";
    if (node.rain > 18) return "#14b8a6";
    if (node.rain > 8)  return "#00d1ff";
    if (node.rain > 1)  return "#64748b";
    return "#f59e0b";
  }
  // risk
  if (node.risk_zone === "CRITICAL") return "#ef4444";
  if (node.risk_zone === "WARNING")  return "#f59e0b";
  if (node.risk_zone === "LOW")      return "#22c55e";
  return "#14b8a6";
}

/**
 * Build a GeoJSON FeatureCollection of Points from the grid.
 */
function gridToPointsGeoJSON(
  grid: GridNode[],
  overlay: "temp" | "rain" | "risk"
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: grid.map((node) => ({
      type: "Feature" as const,
      properties: {
        id: node.id,
        color: getCellColor(node, overlay),
        temp: node.temp,
        rain: node.rain,
        humidity: node.humidity,
        heat_stress: node.heat_stress,
        risk_zone: node.risk_zone,
        lat: node.lat,
        lon: node.lon,
        // INSAT satellite fields
        insat_lst:  node.insat_lst  ?? null,
        insat_sst:  node.insat_sst  ?? null,
        insat_rain: node.insat_rain ?? null,
        sensor:     node.sensor     ?? null,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [node.lon, node.lat],
      },
    })),
  };
}

const SOURCE_ID = "climate-grid-src";
const LAYER_ID = "climate-grid-circles";

/**
 * Inner component that renders the circle layer using useMap() hook.
 * Must be a child of <Map>.
 */
function ClimateCircleLayer({
  geojson,
  onCellClick,
}: {
  geojson: GeoJSON.FeatureCollection;
  onCellClick: (node: GridNode) => void;
}) {
  const { map, isLoaded } = useMap();
  const sourceAdded = useRef(false);

  // Add the source + circle layer on mount
  useEffect(() => {
    if (!isLoaded || !map) return;

    // Clean up any leftover from a previous mount
    try {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    } catch { /* ignore */ }

    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: geojson,
    });

    map.addLayer({
      id: LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          3, 2.5,
          5, 4,
          7, 8,
          10, 14,
        ],
        "circle-color": ["get", "color"],
        "circle-opacity": 0.75,
        "circle-stroke-width": 0.5,
        "circle-stroke-color": "rgba(255,255,255,0.15)",
      },
    });

    sourceAdded.current = true;

    return () => {
      sourceAdded.current = false;
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch { /* style may be mid-reload */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map]);

  // Update data whenever geojson changes
  useEffect(() => {
    if (!isLoaded || !map || !sourceAdded.current) return;
    const source = map.getSource(SOURCE_ID) as MapLibreGL.GeoJSONSource | undefined;
    if (source) {
      source.setData(geojson);
    }
  }, [isLoaded, map, geojson]);

  // Click handler
  useEffect(() => {
    if (!isLoaded || !map) return;

    const handleClick = (e: MapLibreGL.MapLayerMouseEvent) => {
      const feat = e.features?.[0];
      if (!feat) return;
      const p = feat.properties;
      if (!p) return;
      onCellClick({
        id:          p.id          as number,
        lat:         p.lat         as number,
        lon:         p.lon         as number,
        temp:        p.temp        as number,
        rain:        p.rain        as number,
        humidity:    p.humidity    as number,
        wind_u:      3.0,
        wind_v:      4.0,
        heat_stress: p.heat_stress as number,
        risk_zone:   p.risk_zone   as string,
        // INSAT satellite fields (will be null when ground mode)
        insat_lst:  p.insat_lst  != null ? (p.insat_lst  as number) : undefined,
        insat_sst:  p.insat_sst  != null ? (p.insat_sst  as number) : undefined,
        insat_rain: p.insat_rain != null ? (p.insat_rain as number) : undefined,
        sensor:     p.sensor     != null ? (p.sensor     as string) : undefined,
      });
    };

    const handleEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const handleLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", LAYER_ID, handleClick);
    map.on("mouseenter", LAYER_ID, handleEnter);
    map.on("mouseleave", LAYER_ID, handleLeave);

    return () => {
      map.off("click", LAYER_ID, handleClick);
      map.off("mouseenter", LAYER_ID, handleEnter);
      map.off("mouseleave", LAYER_ID, handleLeave);
    };
  }, [isLoaded, map, onCellClick]);

  return null;
}

export default function ClimateMap({ grid, activeOverlay, onNodeSelect }: ClimateMapProps) {
  const [popupInfo, setPopupInfo] = useState<GridNode | null>(null);

  const gridGeoJSON = useMemo(
    () => (grid.length > 0 ? gridToPointsGeoJSON(grid, activeOverlay) : null),
    [grid, activeOverlay]
  );

  const handleCellClick = useCallback(
    (node: GridNode) => {
      setPopupInfo(node);
      onNodeSelect(node);
    },
    [onNodeSelect]
  );

  return (
    <div className="relative w-full h-full overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#020617] backdrop-blur-[16px] shadow-[0_4px_30px_rgba(0,0,0,0.3)]">
      <Map
        theme="dark"
        center={[82.5, 22.5]}
        zoom={4.2}
        minZoom={3}
        maxZoom={10}
        className="h-full w-full"
      >
        {/* Zoom + compass controls */}
        <MapControls position="bottom-right" showZoom showCompass />

        {/* India border outline */}
        <MapGeoJSON
          id="india-border"
          data={INDIA_BORDER_GEOJSON}
          fillPaint={{
            "fill-color": "rgba(20, 184, 166, 0.03)",
            "fill-opacity": 0.5,
          }}
          linePaint={{
            "line-color": "rgba(255, 255, 255, 0.15)",
            "line-width": 1,
          }}
        />

        {/* Climate grid circles (native MapLibre circle layer) */}
        {gridGeoJSON && (
          <ClimateCircleLayer
            geojson={gridGeoJSON}
            onCellClick={handleCellClick}
          />
        )}

        {/* Popup for clicked cell */}
        {popupInfo && (
          <MapPopup
            longitude={popupInfo.lon}
            latitude={popupInfo.lat}
            onClose={() => setPopupInfo(null)}
            closeButton
            className="bg-slate-950/90 backdrop-blur-xl border-white/10 text-white p-0 max-w-none"
          >
            <div className="p-4 font-mono text-[10px] space-y-1.5 min-w-[180px]">
              <div className="text-white font-bold text-[11px] border-b border-white/10 pb-1.5 flex justify-between">
                <span>CELL #{popupInfo.id}</span>
                <span className="text-teal-400">
                  {popupInfo.lat.toFixed(1)}°N / {popupInfo.lon.toFixed(1)}°E
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Temperature</span>
                <span className="text-amber-400 font-bold">{popupInfo.temp}°C</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Precipitation</span>
                <span className="text-teal-400 font-bold">{popupInfo.rain} mm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Humidity</span>
                <span className="text-emerald-400">{popupInfo.humidity}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Heat Stress</span>
                <span>{popupInfo.heat_stress}</span>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-1.5 mt-1">
                <span className="text-slate-400">Risk Zone</span>
                <span className={`font-bold px-2 py-0.5 rounded-full text-[8px] border ${
                  popupInfo.risk_zone === "CRITICAL"
                    ? "bg-red-500/15 border-red-500/30 text-red-400"
                    : popupInfo.risk_zone === "WARNING"
                      ? "bg-amber-500/15 border-amber-500/30 text-amber-400"
                      : "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                }`}>
                  {popupInfo.risk_zone}
                </span>
              </div>
            </div>
          </MapPopup>
        )}
      </Map>

      {/* HUD overlay */}
      <div className="absolute top-4 left-4 z-20 pointer-events-none select-none">
        <div className="font-mono text-[8px] text-white/40 space-y-0.5">
          <div>MAPLIBRE GL · CARTO DARK MATTER</div>
          <div>NODES: {grid.length} · OVERLAY: {activeOverlay.toUpperCase()}</div>
        </div>
      </div>
    </div>
  );
}
