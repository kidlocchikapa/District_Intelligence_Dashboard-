import { useCallback, useEffect, useMemo, useState } from "react";
import "leaflet/dist/leaflet.css";
import { CircleMarker, GeoJSON, ImageOverlay, MapContainer, Tooltip, ZoomControl, useMap } from "react-leaflet";
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

function PopulationRasterPanel({
  geojson,
  pointsGeojson,
  title,
  subtitle,
  metadataUrl = DEFAULT_METADATA_URL,
  heightClass = "h-[460px]",
  loading = false,
  onFeatureClick,
  onFeatureHover,
  selectedFeatureName,
  hoveredFeatureName,
  featureNameResolver,
  customTooltipMetrics,
  pointLayerLabel,
  showPointLayerToggle = true,
}) {
  const { selectedDistrict, setSelectedDistrict } = useDistrict();
  const [metadata, setMetadata] = useState(null);
  const [hoveredDistrict, setHoveredDistrict] = useState(null);
  const [showPointLayer, setShowPointLayer] = useState(true);
  const [error, setError] = useState(null);

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

  const focusFeature = hoveredFeature || selectedFeature;
  const focusProperties = focusFeature?.properties || {};
  const focusName =
    (focusFeature ? getFeatureName(focusFeature) : null) ||
    hoveredFeatureName ||
    null;
  const focusLabel = hoveredFeature ? "Hovering Area" : "Selected Area";
  const baseTooltipMetrics = [
    {
      key: "population_total",
      label: "Population",
      show: focusProperties.population_total !== undefined,
    },
    {
      key: "population_density",
      label: "Density",
      digits: 1,
      show: focusProperties.population_density !== undefined,
    },
  ];
  const visibleBaseTooltipMetrics = baseTooltipMetrics.filter((metric) => metric.show);

  function legendBackground(colors = []) {
    if (!Array.isArray(colors) || !colors.length) {
      return "linear-gradient(90deg, #e5e7eb, #9ca3af)";
    }
    return `linear-gradient(90deg, ${colors.join(", ")})`;
  }

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
        className={`relative isolate ${heightClass} min-h-0 overflow-hidden rounded-[1.5rem] border border-fog bg-[#f8f8f3] group`}
      >
        {showPointLayerToggle && hasPointLayer ? (
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
          <MapFitter bounds={activeBounds || defaultBounds} />
          <ZoomControl position="topright" />
          {imageUrl ? (
            <ImageOverlay
              key={imageUrl}
              bounds={defaultBounds}
              url={imageUrl}
              opacity={0.94}
            />
          ) : null}
          {features.length ? (
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
                const name =
                  f.properties?.school_name ||
                  f.properties?.facility_name ||
                  f.properties?.name ||
                  "Location";
                return (
                  <CircleMarker
                    key={f.id ?? `${lat}-${lng}-${name}`}
                    center={[lat, lng]}
                    radius={3.5}
                    pathOptions={{
                      color: "#ffffff",
                      weight: 1.2,
                      fillColor: "#f59e0b",
                      fillOpacity: 0.92,
                      opacity: 1,
                    }}
                  >
                    <Tooltip
                      direction="top"
                      offset={[0, -6]}
                      opacity={0.96}
                      className="health-ta-tooltip"
                    >
                      {name}
                    </Tooltip>
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
          <div className="pointer-events-none absolute bottom-2 right-2 z-[401] w-[160px] rounded-xl border border-white/80 bg-white/92 px-3 py-2 shadow-md backdrop-blur-md sm:bottom-4 sm:right-4 sm:w-[190px] sm:rounded-2xl sm:px-4 sm:py-3">
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
              <span>{legend.lowLabel || "Low"}</span>
              <span>{legend.highLabel || "High"}</span>
            </div>
            {hasPointLayer ? (
              <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2.5">
                <span
                  className="inline-block h-3 w-3 flex-shrink-0 rounded-full border-2 border-white shadow-sm"
                  style={{
                    background: "#f59e0b",
                    opacity: showPointLayer ? 1 : 0.4,
                  }}
                />
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate/55">
                  {resolvedPointLayerLabel}
                </span>
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate/45">
                  {showPointLayer ? "Shown" : "Hidden"}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {focusFeature ? (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 z-[401] flex items-end justify-start gap-4 sm:inset-x-4 sm:bottom-4">
            <div className="w-full max-w-[240px] rounded-xl border border-white/80 bg-white/92 px-3 py-3 shadow-md backdrop-blur-md sm:min-w-[240px] sm:max-w-none sm:rounded-2xl sm:px-5 sm:py-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate/50 leading-none mb-2.5">
                {focusLabel}
              </p>
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

