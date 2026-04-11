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

  if (error) {
    return <EmptyState title={title} description={error} />;
  }

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
  const defaultBounds = metadata.bounds;
  const features = geojson?.features || [];

  let dynamicBounds = defaultBounds;
  if (features.length > 0) {
    const b = getGeoBounds(features);
    if (b.minLat !== Infinity) {
      dynamicBounds = [[b.minLat, b.minLon], [b.maxLat, b.maxLon]];
    }
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
          <MapFitter bounds={dynamicBounds} />
          <ZoomControl position="topright" />
          <ImageOverlay bounds={defaultBounds} url={imageUrl} opacity={0.94} />
          {features.length ? (
            <GeoJSON
              key={`pop-raster-geojson-${features.length}-${selectedDistrict}`}
              data={geojson}
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

        <div className="pointer-events-none absolute inset-x-4 bottom-4 flex items-end justify-between gap-4">
          <div className="rounded-2xl border border-white/80 bg-white/92 px-4 py-3 shadow-sm backdrop-blur">
            {hoveredDistrict && (
              <div className="mb-2 pb-2 border-b border-slate/10">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate/40">Current District</p>
                <p className="text-sm font-extrabold text-slate">{hoveredDistrict}</p>
              </div>
            )}
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/55">
              {metadata.legend?.label || "Population Density"}
            </p>
            <div className="mt-2 flex items-end gap-3">
              <div className="flex items-stretch overflow-hidden rounded-full border border-slate/10">
                {(metadata.legend?.colors || []).map((color) => (
                  <span
                    key={color}
                    className="h-3 w-7"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate/75">
                <span>{metadata.legend?.lowLabel || "Low"}</span>
                <span className="text-slate/30">to</span>
                <span>{metadata.legend?.highLabel || "High"}</span>
              </div>
            </div>
          </div>

          <div className="rounded-full border border-white/80 bg-white/92 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/60 shadow-sm backdrop-blur">
            WorldPop raster preview
          </div>
        </div>
      </div>
    </div>
  );
}

export default PopulationRasterPanel;
