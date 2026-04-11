import { useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import {
  CHOROPLETH_PALETTES,
  featureCenter,
  getChoroplethColor,
  getGeoBounds,
  getLegendStops,
  getMetricRange,
} from "../lib/geo";
import { formatNumber, titleizeMetric } from "../lib/format";
import EmptyState from "./EmptyState";

import { useEffect } from "react";
import { useDistrict } from "../context/DistrictContext";

function MapFitter({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.minY && bounds.minX) {
      map.fitBounds([
        [bounds.minY, bounds.minX],
        [bounds.maxY, bounds.maxX]
      ], { padding: [20, 20], maxZoom: 14 });
    }
  }, [bounds, map]);
  return null;
}

function MapPanel({
  geojson,
  metricName,
  title,
  subtitle,
  defaultCenter = [-13.5, 34.3],
  zoom = 7,
  popupFields = [],
  tooltipFields = [],
  pointColor = "#c56a3d",
  palette = "default",
  showLegend = false,
  legendTitle,
  showLabels = false,
  showZoomControls = true,
  heightClass = "h-[380px]",
  loading = false,
}) {
  const { setSelectedDistrict } = useDistrict();
  const [activeGeojson, setActiveGeojson] = useState(geojson);
  const [activeBounds, setActiveBounds] = useState(getGeoBounds(geojson?.features || []));

  useEffect(() => {
    if (!loading && geojson) {
      setActiveGeojson(geojson);
      setActiveBounds(getGeoBounds(geojson.features || []));
    }
  }, [geojson, loading]);

  const features = activeGeojson?.features || [];

  if (!loading && !features.length) {
    return (
      <EmptyState
        title={title}
        description="No mapped data is available for this view yet."
      />
    );
  }

  const range = getMetricRange(features, metricName);
  const firstCenter = featureCenter(features[0]) || defaultCenter;
  const hasPointFeatures = features.some(
    (feature) => feature?.geometry?.type === "Point",
  );
  
  const colorStops = CHOROPLETH_PALETTES[palette] || CHOROPLETH_PALETTES.default;
  const legendStops = getLegendStops(range.min, range.max, colorStops);
  const bounds = activeBounds;

  function popupContent(feature) {
    const properties = feature?.properties || {};
    const titleValue =
      properties.admin_unit_name || properties.name || "Location";
    const lines = [`<strong>${titleValue}</strong>`];

    if (
      metricName &&
      properties[metricName] !== undefined &&
      properties[metricName] !== null
    ) {
      lines.push(
        `${titleizeMetric(metricName)}: ${formatNumber(properties[metricName], 1)}`,
      );
    }

    popupFields.forEach((field) => {
      const value = properties[field.key];
      if (value === undefined || value === null || value === "") {
        return;
      }

      if (Array.isArray(value) && !value.length) {
        return;
      }

      lines.push(
        `${field.label || titleizeMetric(field.key)}: ${Array.isArray(value) ? value.join(", ") : value}`,
      );
    });

    return `<div>${lines.join("<br/>")}</div>`;
  }

  function tooltipContent(feature) {
    const properties = feature?.properties || {};
    const titleValue =
      properties.admin_unit_name || properties.name || "Location";
    const lines = [`<strong>${titleValue}</strong>`];

    tooltipFields.forEach((field) => {
      const value = properties[field.key];
      if (value === undefined || value === null || value === "") {
        return;
      }

      lines.push(
        `${field.label || titleizeMetric(field.key)}: ${Array.isArray(value) ? value.join(", ") : value}`,
      );
    });

    return `<div>${lines.join("<br/>")}</div>`;
  }

  const styleFeature = (feature) => {
    if (hasPointFeatures) return {};
    
    const value = Number(feature.properties?.[metricName]);
    const fillColor = getChoroplethColor(value, range.min, range.max, colorStops) || "#fff8ee";
    
    return {
      fillColor,
      weight: 1.4,
      opacity: 1,
      color: 'white',
      dashArray: '3',
      fillOpacity: 0.7
    };
  };

  const onEachFeatureInteraction = (feature, layer) => {
    layer.bindPopup(popupContent(feature));

    let tcontent = tooltipContent(feature);
    if (!hasPointFeatures && metricName && feature.properties[metricName] !== undefined) {
      tcontent += `<br/>${titleizeMetric(metricName)}: ${formatNumber(feature.properties[metricName], 1)}`;
    }
    
    if (tooltipFields.length || (!hasPointFeatures && metricName)) {
      layer.bindTooltip(tcontent, {
        direction: "top",
        sticky: true,
        opacity: 0.95,
      });
    }

    if (!hasPointFeatures) {
       layer.on({
        mouseover: (e) => {
          const layer = e.target;
          layer.setStyle({
            weight: 3,
            color: '#666',
            dashArray: '',
            fillOpacity: 0.9
          });
          layer.bringToFront();
        },
        mouseout: (e) => {
          e.target.setStyle(styleFeature(feature));
        },
        click: (e) => {
          const properties = feature?.properties || {};
          const districtName = properties.admin_unit_name || properties.name;
          if (districtName) {
            setSelectedDistrict(districtName);
          }
        }
      });
    }
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      {(title || subtitle) && (
        <div className="shrink-0 mb-2">
          <h4 className="text-lg font-semibold text-slate">{title}</h4>
          {subtitle ? (
            <p className="mt-1 text-sm leading-6 text-slate/60">{subtitle}</p>
          ) : null}
        </div>
      )}
      
      <div className={`relative flex-1 ${heightClass} w-full overflow-hidden rounded-[1.5rem] border border-fog`}>
        <MapContainer
          center={firstCenter}
          zoom={zoom}
          scrollWheelZoomControls={showZoomControls}
          scrollWheelZoom={showZoomControls}
          zoomControl={showZoomControls}
          className="h-full w-full z-0"
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {bounds && bounds.minY !== Infinity && (
            <MapFitter bounds={bounds} />
          )}
          
          <GeoJSON
            key={`${metricName}-${features.length}`}
            data={activeGeojson}
            style={styleFeature}
            pointToLayer={hasPointFeatures ? (feature, latlng) =>
              L.circleMarker(latlng, {
                radius: 6,
                color: "#fff7ef",
                weight: 1.5,
                fillColor: pointColor,
                fillOpacity: 0.95,
              }) : undefined
            }
            onEachFeature={onEachFeatureInteraction}
          />
        </MapContainer>

        {/* Subtle Background Loading Indicator */}
        {loading && (
          <div className="absolute top-4 left-4 z-[400] animate-in fade-in duration-500">
             <div className="flex items-center gap-3 bg-white/95 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-white/50 shadow-lg shadow-blue-900/5">
                <div className="h-4 w-4 border-2 border-blue-600/20 border-t-blue-600 rounded-full animate-spin"></div>
                <span className="text-[10px] font-bold text-slate uppercase tracking-widest">Updating Map Data...</span>
             </div>
          </div>
        )}
      </div>

      {!hasPointFeatures && metricName && showLegend ? (
        <div className="shrink-0 rounded-[1.25rem] border border-fog bg-cream/70 px-4 py-3 mt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate">
              {legendTitle || titleizeMetric(metricName)}
            </p>
            <p className="text-xs text-slate/55">
              {formatNumber(range.min, 1)} to {formatNumber(range.max, 1)}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-5 flex-wrap">
            {legendStops.map((stop) => (
              <div
                key={`${stop.color}-${stop.from}-${stop.to}`}
                className="flex items-center gap-2 rounded-full bg-white/75 px-3 py-2"
              >
                <span
                  className="h-3 w-3 rounded-full border border-slate/10"
                  style={{ backgroundColor: stop.color }}
                />
                <span className="text-xs text-slate/70 whitespace-nowrap">
                  {formatNumber(stop.from, 1)} - {formatNumber(stop.to, 1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default MapPanel;
