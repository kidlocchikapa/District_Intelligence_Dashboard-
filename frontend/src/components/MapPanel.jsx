import { useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { GeoJSON, MapContainer, TileLayer } from "react-leaflet";
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

function MapFitter({ bounds }) {
  const map = require("react-leaflet").useMap();
  require("react").useEffect(() => {
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
}) {
  const features = geojson?.features || [];
  const [zoomLevel, setZoomLevel] = useState(1);
  const hasHeader = Boolean(title || subtitle);
  const wrapperClassName = hasHeader
    ? "flex h-full min-h-0 flex-col gap-4"
    : "h-full";

  if (!features.length) {
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
  const bounds = getGeoBounds(features);
  const leafletBounds = [
    [bounds.minLat, bounds.minLon],
    [bounds.maxLat, bounds.maxLon],
  ];
  const project = createSvgProjector(bounds, svgWidth, svgHeight, 18);
  const viewWidth = svgWidth / zoomLevel;
  const viewHeight = svgHeight / zoomLevel;
  const viewBoxX = (svgWidth - viewWidth) / 2;
  const viewBoxY = (svgHeight - viewHeight) / 2;

  function handleWheelZoom(event) {
    if (hasPointFeatures) {
      return;
    }

    event.preventDefault();
    const direction = event.deltaY < 0 ? 0.25 : -0.25;
    setZoomLevel((current) => Math.min(5, Math.max(1, current + direction)));
  }

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
        }
      });
    }
  };

  return (
    <div className={wrapperClassName}>
      {hasHeader ? (
        <div>
          {title ? (
            <h4 className="text-lg font-semibold text-slate">{title}</h4>
          ) : null}
          {subtitle ? (
            <p className="mt-1 text-sm leading-6 text-slate/60">{subtitle}</p>
          ) : null}
        </div>
      ) : null}
      <div
        className={`relative ${heightClass} min-h-0 overflow-hidden rounded-[1.5rem] border border-fog`}
        onWheel={handleWheelZoom}
      >
        {hasPointFeatures ? (
          <MapContainer
            bounds={leafletBounds}
            boundsOptions={{ padding: [16, 16] }}
            center={firstCenter}
            zoom={zoom}
            scrollWheelZoom
            className="h-full w-full"
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <GeoJSON
              data={geojson}
              pointToLayer={(feature, latlng) =>
                L.circleMarker(latlng, {
                  radius: 7,
                  color: "#fff7ef",
                  weight: 1.5,
                  fillColor: pointColor,
                  fillOpacity: 0.95,
                })
              }
              onEachFeature={(feature, layer) => {
                layer.bindPopup(popupContent(feature));
                if (tooltipFields.length) {
                  layer.bindTooltip(tooltipContent(feature), {
                    direction: "top",
                    sticky: true,
                    opacity: 0.95,
                  });
                }
              }}
            />
          </MapContainer>
        ) : (
          <svg
            viewBox={`${viewBoxX} ${viewBoxY} ${viewWidth} ${viewHeight}`}
            className="h-full w-full bg-white transition-all duration-200"
          >
            <rect width={svgWidth} height={svgHeight} fill="#ffffff" />
            {features.map((feature, index) => {
              const properties = feature?.properties || {};
              const path = geometryToSvgPath(feature?.geometry, project);
              const label = properties.admin_unit_name || properties.name;
              const value = Number(properties?.[metricName]);
              const labelPosition = showLabels
                ? getFeatureLabelPosition(feature, project)
                : null;
              const labelBox = showLabels
                ? getFeatureLabelBox(feature, project)
                : null;
              const labelWidth = Math.max(
                Math.min((labelBox?.width || 0) * 0.72, 90),
                28,
              );
              const estimatedFontSize = label
                ? Math.floor(labelWidth / Math.max(label.length * 0.72, 1))
                : 8;
              const fontSize = Math.max(6.5, Math.min(estimatedFontSize, 8.5));

              if (!path) {
                return null;
              }

              return (
                <g key={`${feature.id || label || "feature"}-${index}`}>
                  <path
                    d={path}
                    fill={getChoroplethColor(
                      value,
                      range.min,
                      range.max,
                      colorStops,
                    )}
                    stroke="#fff8ee"
                    strokeWidth="1.4"
                  >
                    <title>
                      {tooltipContent(feature).replace(/<[^>]+>/g, " ")}
                    </title>
                  </path>
                  {showLabels && labelPosition ? (
                    <text
                      x={labelPosition.x}
                      y={labelPosition.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={fontSize}
                      fontWeight="700"
                      textLength={labelWidth}
                      lengthAdjust="spacingAndGlyphs"
                      className="fill-slate tracking-[0.04em]"
                      style={{ pointerEvents: "none" }}
                    >
                      {label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        )}
        {!hasPointFeatures && showZoomControls ? (
          <div className="absolute right-4 top-4 flex flex-col gap-2">
            <button
              type="button"
              className="h-10 w-10 rounded-full border border-fog bg-white/90 text-lg font-semibold text-slate shadow-sm transition hover:bg-white"
              onClick={() =>
                setZoomLevel((current) => Math.min(current + 0.5, 5))
              }
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className="h-10 w-10 rounded-full border border-fog bg-white/90 text-lg font-semibold text-slate shadow-sm transition hover:bg-white"
              onClick={() =>
                setZoomLevel((current) => Math.max(current - 0.5, 1))
              }
              aria-label="Zoom out"
            >
              -
            </button>
            <button
              type="button"
              className="rounded-full border border-fog bg-white/90 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate shadow-sm transition hover:bg-white"
              onClick={() => setZoomLevel(1)}
            >
              Reset
            </button>
          </div>
        ) : null}
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
