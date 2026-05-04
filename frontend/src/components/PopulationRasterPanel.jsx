import { useEffect, useMemo, useState } from "react";
import "leaflet/dist/leaflet.css";
import { GeoJSON, ImageOverlay, MapContainer, ZoomControl, useMap } from "react-leaflet";
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
  title,
  subtitle,
  metadataUrl = DEFAULT_METADATA_URL,
  heightClass = "h-[460px]",
  loading = false,
  onFeatureClick,
  selectedFeatureName,
  featureNameResolver,
}) {
  const { selectedDistrict, setSelectedDistrict } = useDistrict();
  const [metadata, setMetadata] = useState(null);
  const [hoveredDistrict, setHoveredDistrict] = useState(null);
  const [hoveredFeature, setHoveredFeature] = useState(null);
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
  const features = geojson?.features || [];
  const activeBounds = useMemo(() => {
    if (!metadata) {
      return null;
    }

    if (!features.length) {
      return defaultBounds;
    }

    const bounds = getGeoBounds(features);

    if (bounds.minLat === Infinity) {
      return defaultBounds;
    }

    return [
      [bounds.minLat, bounds.minLon],
      [bounds.maxLat, bounds.maxLon],
    ];
  }, [defaultBounds, features, metadata]);

  const selectedFeature = useMemo(() => {
    if (!selectedFeatureName) {
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
            String(selectedFeatureName).toLowerCase()
        );
      }) || null
    );
  }, [featureNameResolver, features, selectedFeatureName]);

  const focusFeature = hoveredFeature || selectedFeature;
  const focusProperties = focusFeature?.properties || {};
  const focusName =
    hoveredDistrict ||
    focusProperties.admin_unit_name ||
    focusProperties.name ||
    selectedFeatureName;

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
          className={`relative ${heightClass} min-h-0 overflow-hidden rounded-[1.5rem] border border-fog bg-[#f8f8f3]`}
        >
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#f7f7ef] via-white to-[#f0f8e9]" />
        </div>
      </div>
    );
  }

  const imageUrl = metadata.image.startsWith("/")
    ? metadata.image
    : `${metadataUrl.slice(0, metadataUrl.lastIndexOf("/") + 1)}${metadata.image}`;

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
        className={`relative ${heightClass} min-h-0 overflow-hidden rounded-[1.5rem] border border-fog bg-[#f8f8f3] group`}
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
          <ImageOverlay bounds={defaultBounds} url={imageUrl} opacity={0.94} />
          {features.length ? (
            <GeoJSON
              key={`pop-raster-geojson-${features.map((feature) => feature.id || getFeatureName(feature)).join("|")}-${selectedDistrict}-${selectedFeatureName || "all"}`}
              data={geojson}
              style={(feature) => {
                const featureName = getFeatureName(feature);
                const isSelected =
                  selectedFeatureName &&
                  featureName &&
                  String(featureName).toLowerCase() ===
                    String(selectedFeatureName).toLowerCase();
                const isHovered = featureName === hoveredDistrict;

                return {
                  color: isSelected ? "#111827" : "#6d7a65",
                  weight:
                    isSelected || features.length === 1 || isHovered
                      ? 2.5
                      : 1,
                  opacity: isSelected ? 0.9 : 0.6,
                  fillColor:
                    isSelected || isHovered ? "#6d7a65" : "transparent",
                  fillOpacity: isSelected ? 0.16 : isHovered ? 0.1 : 0,
                };
              }}
              onEachFeature={(feature, layer) => {
                layer.on({
                  mouseover: (e) => {
                    const name = getFeatureName(feature);
                    setHoveredDistrict(name);
                    setHoveredFeature(feature);
                    const layer = e.target;
                    layer.setStyle({
                      weight: 3,
                      opacity: 0.8,
                      fillOpacity: 0.15
                    });
                  },
                  mouseout: (e) => {
                    setHoveredDistrict(null);
                    setHoveredFeature(null);
                    const layer = e.target;
                    layer.setStyle({
                      weight: features.length === 1 ? 2.5 : 1,
                      opacity: 0.6,
                      fillOpacity: 0
                    });
                  },
                  click: (e) => {
                    const name = getFeatureName(feature);
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

        <div className="pointer-events-none absolute inset-x-4 bottom-4 flex items-end justify-between gap-4 z-[401]">
          <div className="rounded-2xl border border-white/80 bg-white/92 px-5 py-4 shadow-md backdrop-blur-md min-w-[240px]">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate/50 leading-none mb-2.5">
                {hoveredFeature ? "Hovering Area" : selectedFeature ? "Selected Area" : "Area Stats"}
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
                    {focusProperties.beneficiary_count !== undefined ? (
                      <div>
                        <p className="uppercase tracking-[0.12em] text-slate/40">
                          Beneficiaries
                        </p>
                        <p className="mt-1 text-[14px] font-black text-slate">
                          {formatStat(focusProperties.beneficiary_count)}
                        </p>
                      </div>
                    ) : null}
                    {focusProperties.flood_affected_count !== undefined ? (
                      <div>
                        <p className="uppercase tracking-[0.12em] text-slate/40">
                          Flood Affected
                        </p>
                        <p className="mt-1 text-[14px] font-black text-slate">
                          {formatStat(focusProperties.flood_affected_count)}
                        </p>
                      </div>
                    ) : null}
                    {focusProperties.exposed_population !== undefined ? (
                      <div>
                        <p className="uppercase tracking-[0.12em] text-slate/40">
                          Flood Exposed
                        </p>
                        <p className="mt-1 text-[14px] font-black text-slate">
                          {formatStat(focusProperties.exposed_population)}
                        </p>
                      </div>
                    ) : null}
                    {focusProperties.exposed_population_pct !== undefined ? (
                      <div>
                        <p className="uppercase tracking-[0.12em] text-slate/40">
                          Exposure %
                        </p>
                        <p className="mt-1 text-[14px] font-black text-slate">
                          {formatStat(focusProperties.exposed_population_pct, 1)}%
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="text-[12px] font-semibold text-slate/60">
                  Hover a TA to view its local stats.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-full border border-white/80 bg-white/92 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate/50 shadow-sm backdrop-blur-md border-b-2 border-b-slate/10">
            WorldPop GIS Source
          </div>
        </div>
      </div>
    </div>
  );
}

export default PopulationRasterPanel;
