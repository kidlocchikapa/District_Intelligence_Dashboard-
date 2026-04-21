import { useEffect, useMemo, useRef, useState } from "react";
import {
  createSvgProjector,
  geometryToSvgPath,
  getGeoBounds,
} from "../lib/geo";
import { formatNumber } from "../lib/format";
import EmptyState from "./EmptyState";

const ZONE_COLORS = {
  served: "#16a34a",
  unserved: "#dc2626",
  unknown: "#94a3b8",
};

function normalizeZoneType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === "served") return "served";
  if (normalized === "unserved") return "unserved";
  if (normalized === "school_point") return "school_point";
  return "unknown";
}

function CoverageShapePanel({
  geojson,
  title,
  subtitle,
  heightClass = "h-[420px]",
  loading = false,
}) {
  const wrapperRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const features = geojson?.features || [];

  useEffect(() => {
    if (!wrapperRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const width = Math.max(Math.floor(entry.contentRect.width), 1);
      const height = Math.max(Math.floor(entry.contentRect.height), 1);
      setSize({ width, height });
    });

    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, []);

  const renderedFeatures = useMemo(() => {
    if (!features.length || !size.width || !size.height) {
      return {
        zonePolygons: [],
        schoolPoints: [],
        districtName: null,
        servedPct: null,
      };
    }

    const bounds = getGeoBounds(features);
    if (!Number.isFinite(bounds.minLon) || !Number.isFinite(bounds.minLat)) {
      return {
        zonePolygons: [],
        schoolPoints: [],
        districtName: null,
        servedPct: null,
      };
    }

    const project = createSvgProjector(bounds, size.width, size.height, 28);
    const zonePolygons = [];
    const schoolPoints = [];
    let districtName = null;
    let servedPct = null;

    features.forEach((feature, index) => {
      const properties = feature?.properties || {};
      const zoneType = normalizeZoneType(properties.zone_type);
      const geometryType = feature?.geometry?.type;

      if (!districtName && properties.district_name) {
        districtName = properties.district_name;
      }

      if (
        servedPct === null &&
        Number.isFinite(Number(properties.coverage_pct))
      ) {
        servedPct = Number(properties.coverage_pct);
      }

      if (geometryType === "Point" || zoneType === "school_point") {
        const coords = feature?.geometry?.coordinates;
        if (
          Array.isArray(coords) &&
          Number.isFinite(coords[0]) &&
          Number.isFinite(coords[1])
        ) {
          const [x, y] = project(coords);
          schoolPoints.push({
            id: feature?.id || properties.school_id || `school-${index}`,
            x,
            y,
            name: properties.school_name || "School",
          });
        }
        return;
      }

      const path = geometryToSvgPath(feature?.geometry, project);
      if (!path) {
        return;
      }

      zonePolygons.push({
        id:
          feature?.id ||
          properties.admin_unit_id ||
          properties.admin_unit_name ||
          index,
        zoneType,
        fill: ZONE_COLORS[zoneType] || ZONE_COLORS.unknown,
        path,
      });
    });

    return {
      zonePolygons,
      schoolPoints,
      districtName,
      servedPct,
    };
  }, [features, size.height, size.width]);

  if (!loading && !features.length) {
    return (
      <EmptyState
        title={title}
        description="No district coverage shape is available for this filter."
      />
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-4">
      {(title || subtitle) && (
        <div>
          {title ? (
            <h4 className="text-lg font-semibold text-slate">{title}</h4>
          ) : null}
          {subtitle ? (
            <p className="mt-1 text-sm leading-6 text-slate/60">{subtitle}</p>
          ) : null}
        </div>
      )}

      <div
        ref={wrapperRef}
        className={`relative ${heightClass} min-h-0 overflow-hidden rounded-[1.5rem] border border-fog bg-[#f8f8f3]`}
      >
        <svg
          viewBox={`0 0 ${Math.max(size.width, 640)} ${Math.max(size.height, 420)}`}
          className="h-full w-full"
          role="img"
          aria-label="Education access coverage shape"
        >
          <rect width="100%" height="100%" fill="#f4f4ee" />

          {renderedFeatures.zonePolygons.map((item) => (
            <path
              key={`coverage-shape-${item.id}`}
              d={item.path}
              fill={item.fill}
              fillOpacity={item.zoneType === "unserved" ? "0.88" : "0.82"}
              stroke="#ffffff"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {renderedFeatures.schoolPoints.map((point) => (
            <circle
              key={`school-point-${point.id}`}
              cx={point.x}
              cy={point.y}
              r="2.6"
              fill="#0f172a"
              fillOpacity="0.95"
              stroke="#ffffff"
              strokeWidth="0.9"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-[1px]">
            <span className="text-gray-500 font-bold uppercase tracking-widest text-xs">
              Loading Coverage Shape...
            </span>
          </div>
        ) : null}

        <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-white/80 bg-white/92 px-3 py-2 shadow-sm backdrop-blur-md">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate/50">
            {renderedFeatures.districtName || "District"}
          </p>
          <p className="mt-1 text-xs font-semibold text-slate/80">
            5km school access buffer
          </p>
          {renderedFeatures.servedPct !== null ? (
            <p className="mt-1 text-xs font-bold text-slate/80">
              Served area: {formatNumber(renderedFeatures.servedPct, 1)}%
            </p>
          ) : null}
        </div>

        <div className="pointer-events-none absolute right-4 bottom-4 rounded-2xl border border-white/80 bg-white/92 px-4 py-3 shadow-md backdrop-blur-md min-w-[220px]">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate/50 leading-none mb-2.5">
            Access Zones
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: "served", label: "Served (<=5km)" },
              { key: "unserved", label: "No Access (>5km)" },
              { key: "school", label: "School Point" },
              { key: "unknown", label: "Unknown" },
            ].map((item) => (
              <div
                key={item.key}
                className="flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5"
              >
                {item.key === "school" ? (
                  <span className="h-2.5 w-2.5 rounded-full border border-white bg-slate-900" />
                ) : (
                  <span
                    className="h-2.5 w-2.5 rounded-full border border-slate/10"
                    style={{
                      backgroundColor:
                        ZONE_COLORS[item.key] || ZONE_COLORS.unknown,
                    }}
                  />
                )}
                <span className="text-[10px] font-semibold text-slate/70 uppercase tracking-wide">
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CoverageShapePanel;
