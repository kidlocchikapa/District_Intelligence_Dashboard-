import { useCallback, useEffect, useMemo, useState } from "react";
import "leaflet/dist/leaflet.css";
import { CircleMarker, GeoJSON, ImageOverlay, MapContainer, Popup, Tooltip, ZoomControl, useMap } from "react-leaflet";
import { useDistrict } from "../context/DistrictContext";
import { getGeoBounds } from "../lib/geo";
import EmptyState from "./EmptyState";

const DEFAULT_METADATA_URL = "/worldpop/mwi_ppp_2020.preview.json";

function MapFitter({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds[0][0] !== Infinity) {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 12 });
    }
  }, [bounds, map]);
  return null;
}

function MapInstanceCapture({ onReady }) {
  const map = useMap();

  useEffect(() => {
    onReady?.(map);

    return () => {
      onReady?.(null);
    };
  }, [map, onReady]);

  return null;
}

function formatLegendNumber(value, digits = 1) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return number.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: Number.isInteger(number) ? 0 : digits,
  });
}

function resolveLegendEdgeLabels(metadata, legend) {
  const render = metadata?.render || {};
  const labelText = `${legend?.label || ""} ${legend?.lowLabel || ""} ${legend?.highLabel || ""}`.toLowerCase();
  const unit = String(render.unit || "").toLowerCase();
  const isTravelTime =
    unit.includes("minute") ||
    labelText.includes("travel time") ||
    labelText.includes("time to");
  const isDistance =
    unit === "km" ||
    unit.includes("kilomet") ||
    labelText.includes("distance") ||
    labelText.includes("within");

  if (
    render.surfaceMethod === "nearest-facility-distance" &&
    Number.isFinite(Number(render.coverageDistanceKm))
  ) {
    const distance = formatLegendNumber(render.coverageDistanceKm);
    return {
      low: `>${distance} km`,
      high: "0 km",
    };
  }

  if (isTravelTime && Number.isFinite(Number(render.clipMax))) {
    return {
      low: "0 min",
      high: `${formatLegendNumber(render.clipMax)} min`,
    };
  }

  if (isDistance && Number.isFinite(Number(render.clipMax))) {
    return {
      low: "0 km",
      high: `${formatLegendNumber(render.clipMax)} km`,
    };
  }

  return {
    low: legend?.lowLabel || "Low",
    high: legend?.highLabel || "High",
  };
}

function PopulationRasterPanel({
  geojson,
  pointsGeojson,
  title,
  subtitle,
  exportTitle,
  exportSubtitle,
  metadataUrl = DEFAULT_METADATA_URL,
  heightClass = "h-[460px]",
  loading = false,
  pointLayerLabel,
  showPointLayerToggle = true,
  legendPositionClass = "right-2 top-2 sm:right-4 sm:top-4",
  baseTooltipMetrics,
  onFeatureClick,
  onFeatureHover,
  selectedFeatureName,
  hoveredFeatureName,
  featureNameResolver,
  customTooltipMetrics,
  onPanelLeave,
}) {
  const { selectedDistrict, setSelectedDistrict } = useDistrict();
  const [metadata, setMetadata] = useState(null);
  const [hoveredDistrict, setHoveredDistrict] = useState(null);
  const [showPointLayer, setShowPointLayer] = useState(true);
  const [showRasterLayer, setShowRasterLayer] = useState(true);
  const [showBoundaryLayer, setShowBoundaryLayer] = useState(true);
  const [mapInstance, setMapInstance] = useState(null);
  const [error, setError] = useState(null);
  const [isResetViewActive, setIsResetViewActive] = useState(false);
  const [selectedPointKey, setSelectedPointKey] = useState(null);

  useEffect(() => {
    let ignore = false;
    setMetadata(null);
    setError(null);

    async function loadMetadata() {
      try {
        const response = await fetch(metadataUrl);
        if (!response.ok) {
          throw new Error("Failed to load population raster preview.");
        }

        const payload = await response.json();
        if (!ignore) {
          setMetadata(payload);
        }
      } catch (err) {
        if (!ignore) {
          setError(err.message || "Failed to load population raster preview.");
        }
      }
    }

    loadMetadata();

    return () => {
      ignore = true;
    };
  }, [metadataUrl]);

  const defaultBounds = metadata?.bounds;
  const legend = metadata?.legend || null;
  const features = useMemo(() => geojson?.features || [], [geojson?.features]);
  const findFeatureByName = useCallback((featureName) => {
    if (!featureName) {
      return null;
    }

    return (
      features.find((feature) => {
        const name =
          typeof featureNameResolver === "function"
            ? featureNameResolver(feature)
            : feature?.properties?.admin_unit_name ||
              feature?.properties?.name;

        return (
          name &&
          String(name).toLowerCase() ===
            String(featureName).toLowerCase()
        );
      }) || null
    );
  }, [featureNameResolver, features]);

  const selectedFeature = useMemo(() => {
    return findFeatureByName(selectedFeatureName);
  }, [findFeatureByName, selectedFeatureName]);
  const hoveredFeature = useMemo(() => {
    return findFeatureByName(hoveredFeatureName || hoveredDistrict);
  }, [findFeatureByName, hoveredDistrict, hoveredFeatureName]);
  const activeBounds = useMemo(() => {
    if (!metadata) {
      return null;
    }

    if (!features.length) {
      return defaultBounds;
    }

    const bounds = getGeoBounds(
      selectedFeature ? [selectedFeature] : features,
    );

    if (bounds.minLat === Infinity) {
      return defaultBounds;
    }

    return [
      [bounds.minLat, bounds.minLon],
      [bounds.maxLat, bounds.maxLon],
    ];
  }, [defaultBounds, features, metadata, selectedFeature]);
  const mapFitterBounds = useMemo(() => {
    if (isResetViewActive) {
      return defaultBounds || activeBounds || null;
    }

    return activeBounds || defaultBounds || null;
  }, [activeBounds, defaultBounds, isResetViewActive]);

  useEffect(() => {
    setIsResetViewActive(false);
  }, [selectedFeatureName, metadataUrl]);

  useEffect(() => {
    setSelectedPointKey(null);
  }, [metadataUrl, pointsGeojson]);
  const pointFeatures = useMemo(() => {
    return (pointsGeojson?.features || []).filter(
      (feature) =>
        feature?.geometry?.type === "Point" &&
        Array.isArray(feature.geometry.coordinates) &&
        feature.geometry.coordinates.length >= 2,
    );
  }, [pointsGeojson]);
  const hasPointLayer = pointFeatures.length > 0;
  const resolvedPointLayerLabel = useMemo(() => {
    if (pointLayerLabel) {
      return pointLayerLabel;
    }

    const hasSchoolPoints = pointFeatures.some((feature) => {
      const properties = feature?.properties || {};
      return properties.school_name || properties.school_id;
    });

    if (hasSchoolPoints) {
      return "Schools";
    }

    const hasHospitalPoints = pointFeatures.some((feature) => {
      const properties = feature?.properties || {};
      return (
        properties.facility_name ||
        properties.hospital_name ||
        properties.doctor_count !== undefined ||
        properties.nurse_midwife_count !== undefined
      );
    });

    if (hasHospitalPoints) {
      return "Hospitals";
    }

    return "Points";
  }, [pointFeatures, pointLayerLabel]);

  const hasHeader = Boolean(title || subtitle);
  const wrapperClassName = hasHeader
    ? "flex h-full min-h-0 flex-col gap-4"
    : "h-full";

  const formatStat = (value, digits = 0) => {
    const number = Number(value || 0);

    return number.toLocaleString(undefined, {
      maximumFractionDigits: digits,
    });
  };

  const formatPointMetric = (value, format = "number", digits = 0) => {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (format === "text") {
      return String(value);
    }

    const number = Number(value);
    if (!Number.isFinite(number)) {
      return null;
    }

    if (format === "ratio") {
      return `1:${formatStat(number, digits)}`;
    }

    return formatStat(number, digits);
  };

  function getPointDetails(properties) {
    const hasSchoolFields =
      properties?.school_name ||
      properties?.school_id ||
      properties?.student_enrollment_total !== undefined;
    const hasHealthFields =
      properties?.facility_name ||
      properties?.doctor_count !== undefined ||
      properties?.nurse_midwife_count !== undefined;

    if (hasSchoolFields) {
      return [
        {
          label: "Enrollment",
          value: formatPointMetric(properties.student_enrollment_total),
        },
        {
          label: "Teachers",
          value: formatPointMetric(
            properties.teacher_count ?? properties.teacher_distribution,
          ),
        },
        {
          label: "Classrooms",
          value: formatPointMetric(properties.blocks_count),
        },
        {
          label: "Risk",
          value: formatPointMetric(properties.risk_category, "text"),
        },
      ].filter((item) => item.value !== null);
    }

    if (hasHealthFields) {
      return [
        {
          label: "Beds",
          value: formatPointMetric(
            properties.beds_count ?? properties.bed_capacity,
          ),
        },
        {
          label: "Doctors",
          value: formatPointMetric(properties.doctor_count),
        },
        {
          label: "Nurses/Midwives",
          value: formatPointMetric(properties.nurse_midwife_count),
        },
      ].filter((item) => item.value !== null);
    }

    return [];
  }

  if (error) {
    return <EmptyState title={title} description={error} />;
  }

  if (!metadata) {
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
          className={`relative isolate ${heightClass} min-h-0 overflow-hidden rounded-[1.5rem] border border-fog bg-[#f8f8f3]`}
        >
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#f7f7ef] via-white to-[#f0f8e9]" />
        </div>
      </div>
    );
  }

  const hasValidBounds =
    Array.isArray(defaultBounds) &&
    defaultBounds.length === 2 &&
    Array.isArray(defaultBounds[0]) &&
    Array.isArray(defaultBounds[1]) &&
    defaultBounds[0].length === 2 &&
    defaultBounds[1].length === 2;

  const metadataImage =
    typeof metadata?.image === "string" && metadata.image.length
      ? metadata.image
      : null;

  const imageUrl = metadataImage
    ? metadataImage.startsWith("/")
      ? metadataImage
      : `${metadataUrl.slice(0, metadataUrl.lastIndexOf("/") + 1)}${metadataImage}`
    : null;

  if (!hasValidBounds) {
    return (
      <EmptyState
        title={title}
        description="Raster preview metadata is missing map bounds."
      />
    );
  }

  function getFeatureName(feature) {
    if (typeof featureNameResolver === "function") {
      return featureNameResolver(feature);
    }

    return (
      feature?.properties?.admin_unit_name ||
      feature?.properties?.name ||
      null
    );
  }

  function getFeatureType(feature) {
    return (
      feature?.properties?.admin_unit_type ||
      feature?.properties?.type ||
      null
    );
  }

  const tooltipMetrics = customTooltipMetrics && customTooltipMetrics.length
    ? customTooltipMetrics
    : [
        { key: "beneficiary_count", label: "Beneficiaries" },
        { key: "flood_affected_count", label: "Flood Affected" },
        { key: "exposed_population", label: "Flood Exposed" },
        {
          key: "exposed_population_pct",
          label: "Exposure %",
          format: "pct",
          digits: 1,
        },
      ];

  const activeFeature = hoveredFeature || selectedFeature || null;
  const focusProperties = activeFeature?.properties || {};
  const focusName =
    (activeFeature ? getFeatureName(activeFeature) : null) ||
    hoveredFeatureName ||
    selectedFeatureName ||
    null;
  const focusLabel = hoveredFeature ? "Hovering Area" : "Selected Area";
  const visibleBaseTooltipMetrics = (
    baseTooltipMetrics || [
      { key: "population_total", label: "Population" },
      { key: "school_age_population_total", label: "School-age Pop." },
      { key: "health_population_served_total", label: "Served Pop." },
      { key: "health_population_unserved_total", label: "Unserved Pop." },
    ]
  ).filter(
    (metric) =>
      focusProperties[metric.key] !== undefined &&
      !tooltipMetrics.some((tooltipMetric) => tooltipMetric.key === metric.key),
  );
  const activeFeatureBounds = (() => {
    if (!activeFeature) {
      return null;
    }

    const bounds = getGeoBounds([activeFeature]);
    if (bounds.minLat === Infinity) {
      return null;
    }

    return [
      [bounds.minLat, bounds.minLon],
      [bounds.maxLat, bounds.maxLon],
    ];
  })();

  function legendBackground(colors = []) {
    if (!Array.isArray(colors) || !colors.length) {
      return "linear-gradient(90deg, #e5e7eb, #9ca3af)";
    }
    return `linear-gradient(90deg, ${colors.join(", ")})`;
  }

  const legendEdgeLabels = resolveLegendEdgeLabels(metadata, legend);

  const exportLegendItems = [
    legend
      ? {
          label: `${legend.label || title || "Raster surface"} (${legendEdgeLabels.low} to ${legendEdgeLabels.high})`,
          color: Array.isArray(legend.colors) && legend.colors.length
            ? legend.colors[Math.floor(legend.colors.length / 2)]
            : "#56ab91",
        }
      : { label: title || "Raster surface", color: "#56ab91" },
    features.length ? { label: "TA boundary", color: "#5f6d5b", type: "line" } : null,
    selectedFeatureName ? { label: "Selected area", color: "#111827" } : null,
    hasPointLayer ? { label: resolvedPointLayerLabel, color: "#f59e0b" } : null,
  ].filter(Boolean);

  const zoomToBounds = (targetBounds) => {
    if (!mapInstance || !Array.isArray(targetBounds)) {
      return;
    }

    mapInstance.fitBounds(targetBounds, {
      padding: [18, 18],
      maxZoom: 13,
      animate: true,
      duration: 0.45,
    });
  };

  const handleZoomToFocus = () => {
    if (!activeFeatureBounds) {
      return;
    }

    setIsResetViewActive(false);
    zoomToBounds(activeFeatureBounds);
  };

  const handleResetView = () => {
    if (defaultBounds) {
      setIsResetViewActive(true);
      zoomToBounds(defaultBounds);
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
        data-map-export
        data-map-title={exportTitle || title || "Map"}
        data-map-subtitle={exportSubtitle || subtitle || ""}
        data-map-legend={JSON.stringify(exportLegendItems)}
        className={`relative ${heightClass} min-h-0 overflow-hidden rounded-[1.5rem] border border-fog bg-[#f8f8f3] group`}
        onMouseLeave={() => {
          setHoveredDistrict(null);
          onFeatureHover?.(null);
          onPanelLeave?.();
        }}
      >
        {showPointLayerToggle && hasPointLayer && !legend ? (
          <div className="absolute left-2 top-2 z-[402] sm:left-4 sm:top-4">
            <button
              type="button"
              onClick={() => setShowPointLayer((current) => !current)}
              className="rounded-full border border-white/80 bg-white/92 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.1em] text-slate/70 shadow-sm backdrop-blur-md transition hover:bg-white sm:px-3 sm:text-[10px] sm:tracking-[0.12em]"
            >
              {showPointLayer
                ? `Hide ${resolvedPointLayerLabel}`
                : `Show ${resolvedPointLayerLabel}`}
            </button>
          </div>
        ) : null}
        <MapContainer
          bounds={defaultBounds}
          boundsOptions={{ padding: [12, 12] }}
          className="h-full w-full"
          scrollWheelZoom
          zoomControl={false}
          attributionControl={false}
        >
          <MapInstanceCapture onReady={setMapInstance} />
          <MapFitter bounds={mapFitterBounds} />
          <ZoomControl position="topright" />
          {imageUrl && showRasterLayer ? (
            <ImageOverlay
              key={imageUrl}
              bounds={defaultBounds}
              url={imageUrl}
              opacity={0.94}
            />
          ) : null}
          {features.length && showBoundaryLayer ? (
            <GeoJSON
              key={`pop-raster-geojson-${features.map((feature) => feature.id || getFeatureName(feature)).join("|")}-${selectedDistrict}-${selectedFeatureName || "all"}-${hoveredFeatureName || "none"}`}
              data={geojson}
              style={(feature) => {
                const featureName = getFeatureName(feature);
                const isSelected =
                  selectedFeatureName &&
                  featureName &&
                  String(featureName).toLowerCase() ===
                    String(selectedFeatureName).toLowerCase();
                const isSharedHovered =
                  hoveredFeatureName &&
                  featureName &&
                  String(featureName).toLowerCase() ===
                    String(hoveredFeatureName).toLowerCase();
                const isHovered =
                  featureName === hoveredDistrict || isSharedHovered;

                return {
                  color: isSelected ? "#111827" : "#5f6d5b",
                  weight:
                    isSelected || features.length === 1 || isHovered
                      ? 2.7
                      : 1.35,
                  opacity: isSelected ? 0.95 : 0.82,
                  fillColor:
                    isSelected || isHovered ? "#5f6d5b" : "transparent",
                  fillOpacity: isSelected ? 0.08 : isHovered ? 0.05 : 0,
                };
              }}
              onEachFeature={(feature, layer) => {
                const name = getFeatureName(feature);
                layer.on({
                  mouseover: (e) => {
                    setHoveredDistrict(name);
                    onFeatureHover?.(feature, e);
                    const layer = e.target;
                    layer.setStyle({
                      weight: 3,
                      opacity: 0.95,
                      fillOpacity: 0.08
                    });
                  },
                  mouseout: (e) => {
                    setHoveredDistrict(null);
                    onFeatureHover?.(null, e);
                    const isSelected =
                      selectedFeatureName &&
                      name &&
                      String(name).toLowerCase() ===
                        String(selectedFeatureName).toLowerCase();
                    const layer = e.target;
                    layer.setStyle({
                      color: isSelected ? "#111827" : "#5f6d5b",
                      weight:
                        isSelected || features.length === 1 ? 2.7 : 1.35,
                      opacity: isSelected ? 0.95 : 0.82,
                      fillColor: isSelected ? "#5f6d5b" : "transparent",
                      fillOpacity: isSelected ? 0.08 : 0
                    });
                  },
                  click: (e) => {
                    const featureType = getFeatureType(feature);
                    if (typeof onFeatureClick === "function") {
                      setIsResetViewActive(false);
                      onFeatureClick(feature, e);
                    } else if (
                      name &&
                      String(featureType).toLowerCase() === "district"
                    ) {
                      setSelectedDistrict(name);
                    }
                  }
                });
              }}
            />
          ) : null}

          {/* School point overlay */}
          {hasPointLayer && showPointLayer
            ? pointFeatures.map((f) => {
                const [lng, lat] = f.geometry.coordinates;
                const properties = f.properties || {};
                const name =
                  properties.school_name ||
                  properties.facility_name ||
                  properties.name ||
                  "Location";
                const pointKey = f.id ?? `${lat}-${lng}-${name}`;
                const pointDetails = getPointDetails(properties);
                const isSelectedPoint = selectedPointKey === pointKey;
                const baseMarkerStyle = {
                  color: isSelectedPoint ? "#111827" : "#ffffff",
                  weight: isSelectedPoint ? 1.6 : 1.2,
                  fillColor: "#f59e0b",
                  fillOpacity: 0.92,
                  opacity: 1,
                };
                return (
                  <CircleMarker
                    key={pointKey}
                    center={[lat, lng]}
                    radius={isSelectedPoint ? 6.4 : 5.2}
                    pathOptions={baseMarkerStyle}
                    interactive
                    eventHandlers={{
                      mouseover: (event) => {
                        const marker = event.target;
                        marker.setStyle({
                          ...baseMarkerStyle,
                          weight: 1.8,
                        });
                        marker.setRadius(isSelectedPoint ? 6.8 : 6.2);
                        marker.bringToFront();
                        marker.openTooltip();
                      },
                      mouseout: (event) => {
                        const marker = event.target;
                        marker.setStyle(baseMarkerStyle);
                        marker.setRadius(isSelectedPoint ? 6.4 : 5.2);
                      },
                      click: () =>
                        setSelectedPointKey((current) =>
                          current === pointKey ? null : pointKey,
                        ),
                    }}
                  >
                    <Tooltip
                      direction="top"
                      offset={[0, -6]}
                      opacity={0.96}
                      sticky
                      className="health-ta-tooltip"
                    >
                      <div className="min-w-[170px]">
                        <p className="text-xs font-extrabold text-black">
                          {name}
                        </p>
                        {pointDetails.length ? (
                          <div className="mt-1 space-y-0.5 text-[11px] font-semibold text-gray-600">
                            {pointDetails.map((detail) => (
                              <p key={`${pointKey}-${detail.label}`}>
                                {detail.label}: {detail.value}
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </Tooltip>
                    {isSelectedPoint ? (
                      <Popup
                        closeButton={false}
                        autoPan
                        autoPanPadding={[16, 16]}
                        className="health-ta-tooltip"
                      >
                        <div className="min-w-[180px]">
                          <p className="text-xs font-extrabold text-black">
                            {name}
                          </p>
                          {pointDetails.length ? (
                            <div className="mt-1 space-y-0.5 text-[11px] font-semibold text-gray-600">
                              {pointDetails.map((detail) => (
                                <p key={`${pointKey}-popup-${detail.label}`}>
                                  {detail.label}: {detail.value}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-1 text-[11px] font-semibold text-gray-500">
                              No additional point details available.
                            </p>
                          )}
                        </div>
                      </Popup>
                    ) : null}
                  </CircleMarker>
                );
              })
            : null}
        </MapContainer>

        {/* Subtle Background Loading Indicator */}
        {loading && (
          <div
            className={`absolute left-2 z-[400] animate-in fade-in duration-500 sm:left-4 ${showPointLayerToggle && hasPointLayer ? "top-12 sm:top-[3.2rem]" : "top-2 sm:top-4"}`}
          >
             <div className="flex items-center gap-2 rounded-xl border border-white/50 bg-white/95 px-3 py-2 shadow-lg shadow-blue-900/5 backdrop-blur-md sm:gap-3 sm:rounded-2xl sm:px-4 sm:py-2.5">
                <div className="h-4 w-4 border-2 border-blue-600/20 border-t-blue-600 rounded-full animate-spin"></div>
                <span className="text-[9px] font-bold uppercase tracking-wide text-slate sm:text-[10px] sm:tracking-widest">District Data Refreshing...</span>
             </div>
          </div>
        )}

        {legend ? (
          <div
            data-map-export-skip
            className={`absolute z-[401] w-[185px] max-h-[calc(100%-1rem)] overflow-y-auto rounded-xl border border-white/80 bg-white/92 px-3 py-2 shadow-md backdrop-blur-md sm:w-[220px] sm:rounded-2xl sm:px-4 sm:py-3 ${legendPositionClass}`}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate/50">
              Legend
            </p>
            <p className="mt-1 text-[12px] font-semibold leading-5 text-slate">
              {legend.label || title || "Raster surface"}
            </p>
            <div
              className="mt-3 h-3 w-full rounded-full border border-slate-200/80"
              style={{ background: legendBackground(legend.colors) }}
            />
            <div className="mt-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-slate/55">
              <span>{legendEdgeLabels.low}</span>
              <span>{legendEdgeLabels.high}</span>
            </div>
            <div className="mt-3 border-t border-slate-100 pt-2.5">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate/45">
                Layer Controls
              </p>
              <div className="mt-2 grid gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowRasterLayer((current) => !current)}
                  className={`rounded-full border px-2.5 py-1 text-left text-[10px] font-bold uppercase tracking-[0.11em] transition ${
                    showRasterLayer
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-gray-200 bg-white text-gray-500"
                  }`}
                >
                  Raster {showRasterLayer ? "On" : "Off"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowBoundaryLayer((current) => !current)}
                  className={`rounded-full border px-2.5 py-1 text-left text-[10px] font-bold uppercase tracking-[0.11em] transition ${
                    showBoundaryLayer
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-500"
                  }`}
                >
                  Boundaries {showBoundaryLayer ? "On" : "Off"}
                </button>
                {hasPointLayer && showPointLayerToggle ? (
                  <button
                    type="button"
                    onClick={() => setShowPointLayer((current) => !current)}
                    className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-left text-[10px] font-bold uppercase tracking-[0.11em] transition ${
                      showPointLayer
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-gray-200 bg-white text-gray-500"
                    }`}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full border border-white shadow-sm"
                      style={{ background: "#f59e0b" }}
                    />
                    {resolvedPointLayerLabel} {showPointLayer ? "On" : "Off"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {activeFeature ? (
          <div className="absolute inset-x-3 bottom-3 z-[401] flex max-h-[calc(100%-1.5rem)] items-end justify-start sm:inset-x-4 sm:bottom-4">
            <div className="max-h-[calc(100%-1rem)] min-w-[240px] overflow-y-auto rounded-2xl border border-white/80 bg-white/92 px-5 py-4 shadow-md backdrop-blur-md">
            <div>
              <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate/50 leading-none">
                  {focusLabel}
                </p>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={handleZoomToFocus}
                    className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-gray-600 transition hover:border-gray-300 hover:text-black"
                  >
                    Zoom
                  </button>
                  <button
                    type="button"
                    onClick={handleResetView}
                    className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-gray-600 transition hover:border-gray-300 hover:text-black"
                  >
                    Reset
                  </button>
                  {hoveredFeature &&
                  !selectedFeatureName &&
                  typeof onFeatureClick === "function" ? (
                    <button
                      type="button"
                      onClick={() => onFeatureClick(hoveredFeature)}
                      className="rounded-full border border-gray-900 bg-gray-900 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white transition hover:bg-black"
                    >
                      Lock
                    </button>
                  ) : null}
                  {selectedFeatureName && typeof onFeatureClick === "function" ? (
                    <button
                      type="button"
                      onClick={() => onFeatureClick(null)}
                      className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-gray-600 transition hover:border-gray-300 hover:text-black"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
              {focusName ? (
                <div className="space-y-3">
                  <p className="text-[13px] font-black leading-none text-slate sm:text-[15px]">
                    {focusName}
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-semibold text-slate/65 sm:gap-3 sm:text-[11px]">
                    {visibleBaseTooltipMetrics.map((metric) => (
                      <div key={metric.key}>
                        <p className="uppercase tracking-[0.12em] text-slate/40">
                          {metric.label}
                        </p>
                        <p className="mt-1 text-[12px] font-black text-slate sm:text-[14px]">
                          {formatStat(
                            focusProperties[metric.key],
                            metric.digits || 0,
                          )}
                        </p>
                      </div>
                    ))}
                    {tooltipMetrics.map((metric) =>
                      focusProperties[metric.key] !== undefined ? (
                        <div key={metric.key}>
                          <p className="uppercase tracking-[0.12em] text-slate/40">
                            {metric.label}
                          </p>
                          <p className="mt-1 text-[12px] font-black text-slate sm:text-[14px]">
                            {metric.format === "pct"
                              ? `${formatStat(
                                  focusProperties[metric.key],
                                  metric.digits ?? 1,
                                )}%`
                              : formatStat(
                                  focusProperties[metric.key],
                                  metric.digits || 0,
                                )}
                          </p>
                        </div>
                      ) : null
                    )}
                  </div>
                </div>
                  ) : (
                    <p className="text-[12px] font-semibold text-slate/60">
                      Select a TA to view its local stats.
                    </p>
                  )}
                </div>
              </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default PopulationRasterPanel;
