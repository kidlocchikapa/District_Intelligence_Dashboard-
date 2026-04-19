import { useEffect, useState } from "react";
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
}) {
  const { selectedDistrict, setSelectedDistrict } = useDistrict();
  const [metadata, setMetadata] = useState(null);
  const [activeGeojson, setActiveGeojson] = useState(geojson);
  const [activeBounds, setActiveBounds] = useState(null);
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

  if (error) {
    return <EmptyState title={title} description={error} />;
  }

  const defaultBounds = metadata?.bounds;

  useEffect(() => {
    if (!loading && geojson && metadata) {
      setActiveGeojson(geojson);
      const features = geojson.features || [];
      if (features.length > 0) {
        const b = getGeoBounds(features);
        if (b.minLat !== Infinity) {
          setActiveBounds([[b.minLat, b.minLon], [b.maxLat, b.maxLon]]);
        } else {
          setActiveBounds(defaultBounds);
        }
      } else {
        setActiveBounds(defaultBounds);
      }
    }
  }, [geojson, loading, defaultBounds, metadata]);

  const hasHeader = Boolean(title || subtitle);
  const wrapperClassName = hasHeader
    ? "flex h-full min-h-0 flex-col gap-4"
    : "h-full";

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
  const features = activeGeojson?.features || [];

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
              key={`pop-raster-geojson-${features.length}-${selectedDistrict}`}
              data={activeGeojson}
              style={(feature) => ({
                color: "#6d7a65",
                weight: features.length === 1 || feature.properties.admin_unit_name === hoveredDistrict ? 2.5 : 1,
                opacity: 0.6,
                fillColor: feature.properties.admin_unit_name === hoveredDistrict ? "#6d7a65" : "transparent",
                fillOpacity: feature.properties.admin_unit_name === hoveredDistrict ? 0.1 : 0,
              })}
              onEachFeature={(feature, layer) => {
                layer.on({
                  mouseover: (e) => {
                    const name = feature.properties.admin_unit_name || feature.properties.name;
                    setHoveredDistrict(name);
                    const layer = e.target;
                    layer.setStyle({
                      weight: 3,
                      opacity: 0.8,
                      fillOpacity: 0.15
                    });
                  },
                  mouseout: (e) => {
                    setHoveredDistrict(null);
                    const layer = e.target;
                    layer.setStyle({
                      weight: features.length === 1 ? 2.5 : 1,
                      opacity: 0.6,
                      fillOpacity: 0
                    });
                  },
                  click: () => {
                    const name = feature.properties.admin_unit_name || feature.properties.name;
                    if (name) setSelectedDistrict(name);
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
          <div className="rounded-2xl border border-white/80 bg-white/92 px-5 py-4 shadow-md backdrop-blur-md min-w-[220px]">
            {hoveredDistrict && (
              <div className="mb-3 pb-3 border-b border-slate/10 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600/60 leading-none">Hovering District</p>
                <p className="mt-1.5 text-[15px] font-black text-slate leading-none">{hoveredDistrict}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate/50 leading-none mb-2.5">
                {metadata.legend?.label || "Population Density"}
              </p>
              <div className="flex flex-col gap-3">
                <div className="flex items-stretch overflow-hidden rounded-full border border-slate/10 h-2.5 w-full">
                  {(metadata.legend?.colors || []).map((color) => (
                    <span
                      key={color}
                      className="flex-1"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between text-[10px] font-bold text-slate/60 uppercase tracking-wider">
                  <span>{metadata.legend?.lowLabel || "Low"}</span>
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate/5 border border-slate/5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500/50 animate-pulse"></span>
                    <span className="text-[9px]">Live Data</span>
                  </div>
                  <span>{metadata.legend?.highLabel || "High"}</span>
                </div>
              </div>
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
