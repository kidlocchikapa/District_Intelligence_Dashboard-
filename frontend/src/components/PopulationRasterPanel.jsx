import { useEffect, useState } from "react";
import "leaflet/dist/leaflet.css";
import { GeoJSON, ImageOverlay, MapContainer, ZoomControl } from "react-leaflet";
import EmptyState from "./EmptyState";

const DEFAULT_METADATA_URL = "/worldpop/mwi_ppp_2020.preview.json";

function PopulationRasterPanel({
  geojson,
  title,
  subtitle,
  metadataUrl = DEFAULT_METADATA_URL,
  heightClass = "h-[460px]",
}) {
  const [metadata, setMetadata] = useState(null);
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
  const bounds = metadata.bounds;
  const features = geojson?.features || [];

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
        <MapContainer
          bounds={bounds}
          boundsOptions={{ padding: [12, 12] }}
          className="h-full w-full"
          scrollWheelZoom
          zoomControl={false}
          attributionControl={false}
        >
          <ZoomControl position="topright" />
          <ImageOverlay bounds={bounds} url={imageUrl} opacity={0.94} />
          {features.length ? (
            <GeoJSON
              data={geojson}
              style={() => ({
                color: "#6d7a65",
                weight: features.length === 1 ? 2 : 0.9,
                opacity: 0.45,
                fillOpacity: 0,
              })}
            />
          ) : null}
        </MapContainer>

        <div className="pointer-events-none absolute inset-x-4 bottom-4 flex items-end justify-between gap-4">
          <div className="rounded-2xl border border-white/80 bg-white/92 px-4 py-3 shadow-sm backdrop-blur">
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
