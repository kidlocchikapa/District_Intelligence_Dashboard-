import { useEffect, useMemo, useState } from "react";
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
import { useDistrict } from "../context/DistrictContext";

const RISK_BAND_COLORS = {
  low: "#16a34a",
  medium: "#f59e0b",
  high: "#dc2626",
  unknown: "#94a3b8",
};

const PRIORITY_BAND_COLORS = {
  critical: "#b91c1c",
  high: "#f97316",
  moderate: "#2563eb",
  watch: "#16a34a",
  unknown: "#94a3b8",
};

function normalizeRiskCategory(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "low") return "low";
  if (normalized === "medium") return "medium";
  if (normalized === "high") return "high";
  return "unknown";
}

function normalizePriorityBand(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "moderate") return "moderate";
  if (normalized === "watch") return "watch";
  return "unknown";
}

function MapFitter({ bounds }) {
  const map = useMap();

  const hasValidBounds =
    Number.isFinite(bounds?.minLat) &&
    Number.isFinite(bounds?.minLon) &&
    Number.isFinite(bounds?.maxLat) &&
    Number.isFinite(bounds?.maxLon);

  useEffect(() => {
    if (!hasValidBounds) {
      return;
    }

    const targetBounds = [
      [bounds.minLat, bounds.minLon],
      [bounds.maxLat, bounds.maxLon],
    ];

    // Keep Leaflet aware of panel size changes before fitting queried extents.
    map.invalidateSize();
    map.fitBounds(targetBounds, {
      padding: [16, 16],
      maxZoom: 15,
      animate: true,
      duration: 0.45,
    });
  }, [
    hasValidBounds,
    bounds?.minLat,
    bounds?.minLon,
    bounds?.maxLat,
    bounds?.maxLon,
    map,
  ]);
  return null;
}

function MapResizeObserver({ watchKey }) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    let frameId;

    const refreshSize = () => {
      frameId = window.requestAnimationFrame(() => {
        map.invalidateSize({ animate: false });
      });
    };

    refreshSize();

    if (typeof ResizeObserver === "undefined" || !container) {
      return () => {
        if (frameId) {
          window.cancelAnimationFrame(frameId);
        }
      };
    }

    const observer = new ResizeObserver(refreshSize);
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [map, watchKey]);

  return null;
}

function MapPanel({
  geojson,
  metricName,
  colorByField,
  title,
  subtitle,
  defaultCenter = [-13.5, 34.3],
  zoom = 7,
  popupFields = [],
  tooltipFields = [],
  pointColor = "#c56a3d",
  pointColorResolver,
  palette = "default",
  showLegend = false,
  legendTitle,
  showZoomControls = true,
  heightClass = "h-[380px]",
  loading = false,
  onFeatureClick,
  selectedFeatureName,
  featureNameResolver,
}) {
  const { setSelectedDistrict } = useDistrict();
  const hasHeader = Boolean(title || subtitle);
  const useStackedLayout = hasHeader || showLegend;
  const [activeGeojson, setActiveGeojson] = useState(geojson);

  useEffect(() => {
    if (loading || !geojson || geojson === activeGeojson) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      setActiveGeojson(geojson);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeGeojson, geojson, loading]);

  const features = useMemo(() => activeGeojson?.features ?? [], [activeGeojson]);
  const bounds = useMemo(() => getGeoBounds(features), [features]);
  const layerDataKey = useMemo(
    () =>
      features
        .map((feature) => {
          const properties = feature?.properties || {};
          const featureName =
            typeof featureNameResolver === "function"
              ? featureNameResolver(feature)
              : properties.admin_unit_name || properties.name || "";
          const metricValue =
            metricName && properties[metricName] !== undefined
              ? properties[metricName]
              : "";
          const colorValue =
            colorByField && properties[colorByField] !== undefined
              ? properties[colorByField]
              : "";

          return [
            feature?.id ?? "",
            featureName,
            metricValue,
            colorValue,
          ].join(":");
        })
        .join("|"),
    [colorByField, featureNameResolver, features, metricName],
  );

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
  const hasAreaFeatures = features.some(
    (feature) => feature?.geometry?.type !== "Point",
  );
  const isRiskBandPalette = palette === "risk-bands";
  const isPriorityBandPalette = palette === "priority-bands";

  const colorStops =
    CHOROPLETH_PALETTES[palette] || CHOROPLETH_PALETTES.default;
  const legendStops = getLegendStops(range.min, range.max, colorStops);
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
    const isPointFeature = feature?.geometry?.type === "Point";
    if (isPointFeature) return {};
    const properties = feature?.properties || {};
    const featureName =
      typeof featureNameResolver === "function"
        ? featureNameResolver(feature)
        : properties.admin_unit_name || properties.name;
    const isSelected =
      selectedFeatureName &&
      featureName &&
      String(featureName).toLowerCase() ===
        String(selectedFeatureName).toLowerCase();

    let fillColor;
    if (isPriorityBandPalette) {
      const categoryKey = normalizePriorityBand(
        feature?.properties?.[colorByField || metricName],
      );
      fillColor =
        PRIORITY_BAND_COLORS[categoryKey] || PRIORITY_BAND_COLORS.unknown;
    } else if (isRiskBandPalette) {
      const categoryKey = normalizeRiskCategory(
        feature?.properties?.[colorByField || metricName],
      );
      fillColor = RISK_BAND_COLORS[categoryKey] || RISK_BAND_COLORS.unknown;
    } else {
      const value = Number(feature.properties?.[metricName]);
      fillColor =
        getChoroplethColor(value, range.min, range.max, colorStops) ||
        "#fff8ee";
    }

    return {
      fillColor,
      weight: isSelected ? 3 : 1.4,
      opacity: 1,
      color: isSelected ? "#111827" : "white",
      dashArray: isSelected ? "" : "3",
      fillOpacity: isSelected ? 0.92 : 0.7,
    };
  };

  const onEachFeatureInteraction = (feature, layer) => {
    const isPointFeature = feature?.geometry?.type === "Point";
    layer.bindPopup(popupContent(feature));

    let tcontent = tooltipContent(feature);
    if (
      !isPointFeature &&
      metricName &&
      feature.properties[metricName] !== undefined
    ) {
      tcontent += `<br/>${titleizeMetric(metricName)}: ${formatNumber(feature.properties[metricName], 1)}`;
    }

    if (tooltipFields.length || (!isPointFeature && metricName)) {
      layer.bindTooltip(tcontent, {
        direction: "top",
        sticky: true,
        opacity: 0.95,
      });
    }

    if (!isPointFeature) {
      layer.on({
        mouseover: (e) => {
          const layer = e.target;
          layer.setStyle({
            weight: 3,
            color: "#666",
            dashArray: "",
            fillOpacity: 0.9,
          });
          layer.bringToFront();
        },
        mouseout: (e) => {
          e.target.setStyle(styleFeature(feature));
        },
        click: (e) => {
          const properties = feature?.properties || {};
          const districtName = properties.admin_unit_name || properties.name;
          if (typeof onFeatureClick === "function") {
            onFeatureClick(feature, e);
          } else if (districtName) {
            setSelectedDistrict(districtName);
          }
        },
      });
    } else if (typeof onFeatureClick === "function") {
      layer.on({
        click: (e) => {
          onFeatureClick(feature, e);
        },
      });
    }
  };

  return (
    <div
      className={
        useStackedLayout
          ? "flex h-full w-full flex-col min-h-0 space-y-4"
          : "h-full w-full"
      }
    >
      {hasHeader && (
        <div className="shrink-0 mb-2">
          <h4 className="text-lg font-semibold text-slate">{title}</h4>
          {subtitle ? (
            <p className="mt-1 text-sm leading-6 text-slate/60">{subtitle}</p>
          ) : null}
        </div>
      )}

      <div
        className={`relative ${useStackedLayout ? "flex-1 min-h-0" : ""} ${heightClass} w-full overflow-hidden rounded-[1.5rem] border border-fog`}
      >
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
          {bounds && bounds.minLat !== Infinity && (
            <MapFitter bounds={bounds} />
          )}
          <MapResizeObserver watchKey={layerDataKey} />

          <GeoJSON
            key={`${metricName}-${colorByField || "metric"}-${selectedFeatureName || "all"}-${layerDataKey}`}
            data={activeGeojson}
            style={styleFeature}
            pointToLayer={
              hasPointFeatures
                ? (feature, latlng) => {
                    const resolvedPointColor =
                      typeof pointColorResolver === "function"
                        ? pointColorResolver(feature)
                        : pointColor;

                    return L.circleMarker(latlng, {
                      radius: 6,
                      color: "#fff7ef",
                      weight: 1.5,
                      fillColor: resolvedPointColor || pointColor,
                      fillOpacity: 0.95,
                    });
                  }
                : undefined
            }
            onEachFeature={onEachFeatureInteraction}
          />
        </MapContainer>

        {/* Subtle Background Loading Indicator */}
        {loading && (
          <div className="absolute left-2 top-2 z-[400] animate-in fade-in duration-500 sm:left-4 sm:top-4">
            <div className="flex items-center gap-2 rounded-xl border border-white/50 bg-white/95 px-3 py-2 shadow-lg shadow-blue-900/5 backdrop-blur-md sm:gap-3 sm:rounded-2xl sm:px-4 sm:py-2.5">
              <div className="h-4 w-4 border-2 border-blue-600/20 border-t-blue-600 rounded-full animate-spin"></div>
              <span className="text-[9px] font-bold uppercase tracking-wide text-slate sm:text-[10px] sm:tracking-widest">
                Updating Map Data...
              </span>
            </div>
          </div>
        )}
      </div>

      {hasAreaFeatures && showLegend ? (
        <div className="shrink-0 rounded-[1.25rem] border border-fog bg-cream/70 px-4 py-3 mt-4">
          {isPriorityBandPalette ? (
            <>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate">
                  {legendTitle || "Priority Bands"}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-5 flex-wrap">
                {[
                  { key: "critical", label: "Critical" },
                  { key: "high", label: "High" },
                  { key: "moderate", label: "Moderate" },
                  { key: "watch", label: "Watch" },
                  { key: "unknown", label: "Unknown" },
                ].map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center gap-2 rounded-full bg-white/75 px-3 py-2"
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-slate/10"
                      style={{
                        backgroundColor: PRIORITY_BAND_COLORS[item.key],
                      }}
                    />
                    <span className="text-xs text-slate/70 whitespace-nowrap">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : isRiskBandPalette ? (
            <>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate">
                  {legendTitle || "Risk Levels"}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-4 flex-wrap">
                {[
                  { key: "low", label: "Low" },
                  { key: "medium", label: "Medium" },
                  { key: "high", label: "High" },
                  { key: "unknown", label: "Unknown" },
                ].map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center gap-2 rounded-full bg-white/75 px-3 py-2"
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-slate/10"
                      style={{ backgroundColor: RISK_BAND_COLORS[item.key] }}
                    />
                    <span className="text-xs text-slate/70 whitespace-nowrap">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default MapPanel;
