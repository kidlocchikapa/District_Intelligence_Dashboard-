import { useEffect, useMemo, useRef, useState } from "react";
import { getGeoBounds } from "../lib/geo";
import EmptyState from "./EmptyState";

const RISK_COLORS = {
  low: "#16a34a",
  medium: "#f59e0b",
  high: "#dc2626",
  unknown: "#94a3b8",
};

function normalizeRiskLevel(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === "low") return "low";
  if (normalized === "medium") return "medium";
  if (normalized === "high") return "high";
  return "unknown";
}

function geometryToPolygons(geometry) {
  if (!geometry || !geometry.coordinates) {
    return [];
  }

  if (geometry.type === "Polygon") {
    return [geometry.coordinates];
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates;
  }

  return [];
}

function FloodRiskRasterPanel({
  geojson,
  title,
  subtitle,
  heightClass = "h-[460px]",
  loading = false,
}) {
  const wrapperRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!wrapperRef.current) {
      return;
    }

    const element = wrapperRef.current;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextWidth = Math.max(Math.floor(entry.contentRect.width), 1);
      const nextHeight = Math.max(Math.floor(entry.contentRect.height), 1);
      setSize({ width: nextWidth, height: nextHeight });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const features = geojson?.features || [];

  const riskCounts = useMemo(() => {
    return features.reduce(
      (acc, feature) => {
        const props = feature?.properties || {};
        const riskLevel = normalizeRiskLevel(
          props.risk_level || props.dominant_risk_class,
        );
        acc[riskLevel] += 1;
        return acc;
      },
      { low: 0, medium: 0, high: 0, unknown: 0 },
    );
  }, [features]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width || !size.height || !features.length) {
      return;
    }

    const bounds = getGeoBounds(features);
    const lonSpan = Math.max(bounds.maxLon - bounds.minLon, 0.00001);
    const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.00001);

    const rasterWidth = 360;
    const rasterHeight = Math.max(
      220,
      Math.round((latSpan / lonSpan) * rasterWidth),
    );

    const rasterCanvas = document.createElement("canvas");
    rasterCanvas.width = rasterWidth;
    rasterCanvas.height = rasterHeight;
    const rctx = rasterCanvas.getContext("2d");

    if (!rctx) {
      return;
    }

    rctx.clearRect(0, 0, rasterWidth, rasterHeight);
    rctx.fillStyle = "#f8fafc";
    rctx.fillRect(0, 0, rasterWidth, rasterHeight);

    const project = ([lon, lat]) => {
      const x = ((lon - bounds.minLon) / lonSpan) * rasterWidth;
      const y = rasterHeight - ((lat - bounds.minLat) / latSpan) * rasterHeight;
      return [x, y];
    };

    features.forEach((feature) => {
      const props = feature?.properties || {};
      const riskLevel = normalizeRiskLevel(
        props.risk_level || props.dominant_risk_class,
      );
      const fill = RISK_COLORS[riskLevel] || RISK_COLORS.unknown;
      const polygons = geometryToPolygons(feature?.geometry);

      polygons.forEach((polygon) => {
        if (!polygon.length) return;

        rctx.beginPath();
        polygon.forEach((ring) => {
          ring.forEach((coord, index) => {
            const [x, y] = project(coord);
            if (index === 0) {
              rctx.moveTo(x, y);
            } else {
              rctx.lineTo(x, y);
            }
          });
          rctx.closePath();
        });

        rctx.fillStyle = fill;
        rctx.fill("evenodd");
        rctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
        rctx.lineWidth = 1;
        rctx.stroke();
      });
    });

    canvas.width = size.width;
    canvas.height = size.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.drawImage(rasterCanvas, 0, 0, size.width, size.height);
  }, [features, size.height, size.width]);

  if (!loading && !features.length) {
    return (
      <EmptyState
        title={title}
        description="No flood risk geometry is available for this filter yet."
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
        <canvas ref={canvasRef} className="h-full w-full" />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-[1px]">
            <span className="text-gray-500 font-bold uppercase tracking-widest text-xs">
              Rasterizing Flood Risk...
            </span>
          </div>
        )}

        <div className="pointer-events-none absolute left-4 bottom-4 rounded-2xl border border-white/80 bg-white/92 px-4 py-3 shadow-md backdrop-blur-md min-w-[220px]">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate/50 leading-none mb-2.5">
            Flood Risk Classes
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: "low", label: "Low" },
              { key: "medium", label: "Medium" },
              { key: "high", label: "High" },
              { key: "unknown", label: "Unknown" },
            ].map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between gap-2 rounded-full bg-white/75 px-3 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full border border-slate/10"
                    style={{ backgroundColor: RISK_COLORS[item.key] }}
                  />
                  <span className="text-[10px] font-semibold text-slate/70 uppercase tracking-wide">
                    {item.label}
                  </span>
                </div>
                <span className="text-[10px] font-bold text-slate/80">
                  {riskCounts[item.key]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default FloodRiskRasterPanel;
