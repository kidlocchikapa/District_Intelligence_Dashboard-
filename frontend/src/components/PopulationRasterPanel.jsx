import { useCallback, useEffect, useMemo, useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { CircleMarker, GeoJSON, ImageOverlay, MapContainer, Tooltip, ZoomControl, useMap } from "react-leaflet";
import { useDistrict } from "../context/DistrictContext";
import { getGeoBounds } from "../lib/geo";
import EmptyState from "./EmptyState";

const DEFAULT_METADATA_URL = "/worldpop/mwi_ppp_2020.preview.json";

function MapFitter({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds[0][0] !== Infinity) {
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
}) {
  const { selectedDistrict, setSelectedDistrict } = useDistrict();
  const [metadata, setMetadata] = useState(null);
  const [hoveredDistrict, setHoveredDistrict] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let ignore = false;

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
  const features = geojson?.features || [];
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
    return findFeatureByName(hoveredFeatureName);
  }, [findFeatureByName, hoveredFeatureName]);
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

  function resolveLegendLabel(rawLabel) {
    if (!rawLabel) {
      return "Raster surface";
    }

    if (/estimated people per grid cell/i.test(rawLabel)) {
      return "People per grid cell";
    }

    return String(rawLabel);
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

  const focusProperties = hoveredFeature?.properties || {};
  const focusName =
    (hoveredFeature ? getFeatureName(hoveredFeature) : null) ||
    hoveredFeatureName ||
    null;

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
            <ImageOverlay bounds={defaultBounds} url={imageUrl} opacity={0.94} />
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
          {pointsGeojson?.features?.length
            ? pointsGeojson.features
                .filter(
                  (f) =>
                    f?.geometry?.type === "Point" &&
                    Array.isArray(f.geometry.coordinates) &&
                    f.geometry.coordinates.length >= 2,
                )
                .map((f) => {
                  const [lng, lat] = f.geometry.coordinates;
                  const name =
                    f.properties?.school_name ||
                    f.properties?.name ||
                    "School";
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
          <div className="absolute top-4 left-4 z-[400] animate-in fade-in duration-500">
             <div className="flex items-center gap-3 bg-white/95 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-white/50 shadow-lg shadow-blue-900/5">
                <div className="h-4 w-4 border-2 border-blue-600/20 border-t-blue-600 rounded-full animate-spin"></div>
                <span className="text-[10px] font-bold text-slate uppercase tracking-widest">District Data Refreshing...</span>
             </div>
          </div>
        )}

        {legend ? (
          <div className="pointer-events-none absolute right-4 bottom-4 z-[401] w-[190px] rounded-2xl border border-white/80 bg-white/92 px-4 py-3 shadow-md backdrop-blur-md">
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
            {pointsGeojson?.features?.length ? (
              <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2.5">
                <span
                  className="inline-block h-3 w-3 flex-shrink-0 rounded-full border-2 border-white shadow-sm"
                  style={{ background: "#f59e0b" }}
                />
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate/55">
                  Schools
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {hoveredFeature ? (
          <div className="pointer-events-none absolute inset-x-4 bottom-4 flex items-end justify-start gap-4 z-[401]">
            <div className="rounded-2xl border border-white/80 bg-white/92 px-5 py-4 shadow-md backdrop-blur-md min-w-[240px]">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate/50 leading-none mb-2.5">
                Hovering Area
              </p>
              {focusName ? (
                <div className="space-y-3">
                  <p className="text-[15px] font-black text-slate leading-none">
                    {focusName}
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-[11px] font-semibold text-slate/65">
                    <div>
                      <p className="uppercase tracking-[0.12em] text-slate/40">
                        Population
                      </p>
                      <p className="mt-1 text-[14px] font-black text-slate">
                        {formatStat(focusProperties.population_total)}
                      </p>
                    </div>
                    <div>
                      <p className="uppercase tracking-[0.12em] text-slate/40">
                        Density
                      </p>
                      <p className="mt-1 text-[14px] font-black text-slate">
                        {formatStat(focusProperties.population_density, 1)}
                      </p>
                    </div>
                    {tooltipMetrics.map((metric) =>
                      focusProperties[metric.key] !== undefined ? (
                        <div key={metric.key}>
                          <p className="uppercase tracking-[0.12em] text-slate/40">
                            {metric.label}
                          </p>
                          <p className="mt-1 text-[14px] font-black text-slate">
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

            {legend ? (
              <div className="w-[148px] self-end rounded-xl border border-white/80 bg-white/92 px-3 py-2.5 shadow-md backdrop-blur-md sm:self-auto sm:shrink-0">
                <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate/50">
                  Legend
                </p>
                <p className="mt-1 text-[11px] font-semibold leading-4 text-slate">
                  {resolveLegendLabel(legend.label || title || "Raster surface")}
                </p>
                <div
                  className="mt-2 h-2.5 w-full rounded-full border border-slate-200/80"
                  style={{ background: legendBackground(legend.colors) }}
                />
                <div className="mt-1.5 flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.12em] text-slate/55">
                  <span>{legend.lowLabel || "Low"}</span>
                  <span>{legend.highLabel || "High"}</span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default PopulationRasterPanel;

