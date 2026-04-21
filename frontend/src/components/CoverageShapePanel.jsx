import { useEffect, useMemo, useRef, useState } from "react";
import {
  createSvgProjector,
  geometryToSvgPath,
  getFeatureLabelPosition,
  getGeoBounds,
} from "../lib/geo";
import { formatNumber } from "../lib/format";
import EmptyState from "./EmptyState";

const ACCESS_COLORS = {
  low: "#16a34a",
  medium: "#f59e0b",
  high: "#dc2626",
  unknown: "#94a3b8",
};

function normalizeAccessBand(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === "low") return "low";
  if (normalized === "medium") return "medium";
  if (normalized === "high") return "high";
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

  const shapeItems = useMemo(() => {
    if (!features.length || !size.width || !size.height) {
      return [];
    }

    const bounds = getGeoBounds(features);
    if (!Number.isFinite(bounds.minLon) || !Number.isFinite(bounds.minLat)) {
      return [];
    }

    const project = createSvgProjector(bounds, size.width, size.height, 28);

    return features
      .map((feature, index) => {
        const properties = feature?.properties || {};
        const band = normalizeAccessBand(properties.school_access_band);
        const path = geometryToSvgPath(feature?.geometry, project);
        const label = getFeatureLabelPosition(feature, project);
        const coveragePct = Number(
          properties.school_service_coverage_pct ?? properties.metric_value,
        );

        return {
          id:
            feature?.id ||
            properties.admin_unit_id ||
            properties.admin_unit_name ||
            index,
          name: properties.admin_unit_name || properties.name || "Area",
          band,
          fill: ACCESS_COLORS[band] || ACCESS_COLORS.unknown,
          path,
          label,
          coveragePct: Number.isFinite(coveragePct) ? coveragePct : null,
        };
      })
      .filter((item) => item.path);
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

          {shapeItems.map((item) => (
            <path
              key={`coverage-shape-${item.id}`}
              d={item.path}
              fill={item.fill}
              fillOpacity="0.92"
              stroke="#ffffff"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {shapeItems.length === 1 && shapeItems[0].label ? (
            <g>
              <text
                x={shapeItems[0].label.x}
                y={shapeItems[0].label.y - 8}
                textAnchor="middle"
                fill="#0f172a"
                fontSize="14"
                fontWeight="700"
              >
                {shapeItems[0].name}
              </text>
              {shapeItems[0].coveragePct !== null ? (
                <text
                  x={shapeItems[0].label.x}
                  y={shapeItems[0].label.y + 12}
                  textAnchor="middle"
                  fill="#334155"
                  fontSize="12"
                  fontWeight="600"
                >
                  Coverage: {formatNumber(shapeItems[0].coveragePct, 1)}%
                </text>
              ) : null}
            </g>
          ) : null}
        </svg>

        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-[1px]">
            <span className="text-gray-500 font-bold uppercase tracking-widest text-xs">
              Loading Coverage Shape...
            </span>
          </div>
        ) : null}

        <div className="pointer-events-none absolute right-4 bottom-4 rounded-2xl border border-white/80 bg-white/92 px-4 py-3 shadow-md backdrop-blur-md min-w-[220px]">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate/50 leading-none mb-2.5">
            Access Levels
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: "low", label: "High Access" },
              { key: "medium", label: "Medium Access" },
              { key: "high", label: "Low Access" },
              { key: "unknown", label: "Unknown" },
            ].map((item) => (
              <div
                key={item.key}
                className="flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full border border-slate/10"
                  style={{ backgroundColor: ACCESS_COLORS[item.key] }}
                />
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
