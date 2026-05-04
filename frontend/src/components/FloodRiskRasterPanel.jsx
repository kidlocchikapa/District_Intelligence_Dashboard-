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

function pointInRing(point, ring) {
  if (!ring || ring.length < 3) {
    return false;
  }

  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInPolygon(point, polygon) {
  if (!polygon.length) {
    return false;
  }

  const [outer, ...holes] = polygon;
  if (!pointInRing(point, outer)) {
    return false;
  }

  return !holes.some((hole) => pointInRing(point, hole));
}

function geometryContainsPoint(geometry, point) {
  const polygons = geometryToPolygons(geometry);
  return polygons.some((polygon) => pointInPolygon(point, polygon));
}

function FloodRiskRasterPanel({
  geojson,
  title,
  subtitle,
  heightClass = "h-[460px]",
  loading = false,
  onSelectArea,
  selectedAreaName,
}) {
  const wrapperRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoveredFeature, setHoveredFeature] = useState(null);

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
  const bounds = useMemo(() => getGeoBounds(features), [features]);
  const selectedFeature = useMemo(() => {
    if (!selectedAreaName) {
      return null;
    }
    return (
      features.find(
        (feature) =>
          (feature?.properties?.admin_unit_name ||
            feature?.properties?.name) === selectedAreaName,
      ) || null
    );
  }, [features, selectedAreaName]);

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

    if (!selectedFeature?.geometry) {
      return;
    }

    const projectDisplay = ([lon, lat]) => {
      const x = ((lon - bounds.minLon) / lonSpan) * size.width;
      const y = size.height - ((lat - bounds.minLat) / latSpan) * size.height;
      return [x, y];
    };

    const polygons = geometryToPolygons(selectedFeature.geometry);
    polygons.forEach((polygon) => {
      if (!polygon.length) return;
      ctx.beginPath();
      polygon.forEach((ring) => {
        ring.forEach((coord, index) => {
          const [x, y] = projectDisplay(coord);
          if (index === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });
        ctx.closePath();
      });
      ctx.fillStyle = "rgba(15, 23, 42, 0.08)";
      ctx.fill("evenodd");
      ctx.strokeStyle = "rgba(15, 23, 42, 0.85)";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }, [features, size.height, size.width, selectedFeature, bounds]);

  const hasValidBounds =
    Number.isFinite(bounds?.minLat) &&
    Number.isFinite(bounds?.minLon) &&
    Number.isFinite(bounds?.maxLat) &&
    Number.isFinite(bounds?.maxLon);

  const handleMouseMove = (event) => {
    if (!wrapperRef.current || !hasValidBounds || !features.length) {
      setHoveredFeature(null);
      return;
    }

    const rect = wrapperRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      setHoveredFeature(null);
      return;
    }

    const lonSpan = Math.max(bounds.maxLon - bounds.minLon, 0.00001);
    const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.00001);
    const lon = bounds.minLon + (x / rect.width) * lonSpan;
    const lat = bounds.maxLat - (y / rect.height) * latSpan;

    const match = features.find((feature) =>
      geometryContainsPoint(feature?.geometry, [lon, lat]),
    );

    if (!match) {
      setHoveredFeature(null);
      return;
    }

    setHoveredFeature({
      name:
        match?.properties?.admin_unit_name ||
        match?.properties?.name ||
        "Selected area",
      x,
      y,
    });
  };

  const handleMouseLeave = () => setHoveredFeature(null);

  const handleClick = (event) => {
    if (!onSelectArea) {
      return;
    }
    if (!wrapperRef.current || !hasValidBounds || !features.length) {
      return;
    }

    const rect = wrapperRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      return;
    }

    const lonSpan = Math.max(bounds.maxLon - bounds.minLon, 0.00001);
    const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.00001);
    const lon = bounds.minLon + (x / rect.width) * lonSpan;
    const lat = bounds.maxLat - (y / rect.height) * latSpan;

    const match = features.find((feature) =>
      geometryContainsPoint(feature?.geometry, [lon, lat]),
    );

    if (!match) {
      return;
    }

    onSelectArea(match);
  };

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
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
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

        {hoveredFeature ? (
          <div
            className="pointer-events-none absolute rounded-xl border border-white/80 bg-white/95 px-3 py-2 text-xs font-semibold text-slate-700 shadow-lg"
            style={{
              left: Math.min(hoveredFeature.x + 12, size.width - 180),
              top: Math.max(hoveredFeature.y - 12, 12),
            }}
          >
            {hoveredFeature.name}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default FloodRiskRasterPanel;
