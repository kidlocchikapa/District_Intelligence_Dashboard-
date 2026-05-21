import { ArrowRight, ChevronDown, ChevronUp, Circle } from "lucide-react";
import { useMemo, useState } from "react";

const PRIORITY_ORDER = ["high", "medium", "low"];

function normalizePriority(value) {
  const normalized = String(value || "").toLowerCase();
  return PRIORITY_ORDER.includes(normalized) ? normalized : "low";
}

function defaultPriorityLabel(priority) {
  if (priority === "high") return "High Priority";
  if (priority === "medium") return "Medium Priority";
  return "Planning Note";
}

function makeRecommendationId(item, index) {
  const base = String(item?.title || `recommendation-${index}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return item?.id || `${normalizePriority(item?.priority)}-${base || index}`;
}

function InteractiveRecommendations({
  recommendations = [],
  priorityConfig = {},
}) {
  const [activePriority, setActivePriority] = useState("all");
  const [expandedIds, setExpandedIds] = useState([]);

  const normalizedRecommendations = useMemo(() => {
    return recommendations.map((item, index) => ({
      ...item,
      id: makeRecommendationId(item, index),
      priority: normalizePriority(item?.priority),
    }));
  }, [recommendations]);

  const counts = useMemo(() => {
    const counter = {
      all: normalizedRecommendations.length,
      high: 0,
      medium: 0,
      low: 0,
    };

    normalizedRecommendations.forEach((item) => {
      counter[item.priority] = (counter[item.priority] || 0) + 1;
    });

    return counter;
  }, [normalizedRecommendations]);

  const filteredRecommendations = useMemo(() => {
    if (activePriority === "all") {
      return normalizedRecommendations;
    }
    return normalizedRecommendations.filter(
      (item) => item.priority === activePriority,
    );
  }, [activePriority, normalizedRecommendations]);

  const effectiveExpandedIds = useMemo(() => {
    if (!filteredRecommendations.length) {
      return [];
    }

    const visibleIds = new Set(filteredRecommendations.map((item) => item.id));
    const validIds = new Set(normalizedRecommendations.map((item) => item.id));
    const visibleExpanded = expandedIds.filter(
      (id) => validIds.has(id) && visibleIds.has(id),
    );

    if (visibleExpanded.length) {
      return visibleExpanded;
    }

    return [filteredRecommendations[0].id];
  }, [expandedIds, filteredRecommendations, normalizedRecommendations]);

  if (!normalizedRecommendations.length) {
    return (
      <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-5 text-sm font-semibold text-gray-500">
        No recommendations are available for this view yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {["all", ...PRIORITY_ORDER].map((priority) => {
          const isActive = activePriority === priority;
          const label =
            priority === "all"
              ? "All"
              : priorityConfig[priority]?.label || defaultPriorityLabel(priority);
          const count = counts[priority] || 0;
          return (
            <button
              key={priority}
              type="button"
              onClick={() => setActivePriority(priority)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition-all ${
                isActive
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-800"
              }`}
            >
              <span>{label}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  isActive ? "bg-white/20" : "bg-gray-100 text-gray-500"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {filteredRecommendations.map((rec) => {
          const cfg = priorityConfig[rec.priority] || {};
          const Icon = rec.icon || Circle;
          const isExpanded = effectiveExpandedIds.includes(rec.id);

          return (
            <div
              key={rec.id}
              className={`rounded border bg-white shadow-sm transition-all ${
                isExpanded ? "border-gray-300" : "border-gray-100"
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  setExpandedIds((current) =>
                    current.includes(rec.id)
                      ? current.filter((id) => id !== rec.id)
                      : [...current, rec.id],
                  )
                }
                className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <div className="mt-0.5 flex-shrink-0 rounded-lg bg-gray-50 p-2">
                    <Icon className="h-4 w-4 text-gray-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[14px] font-extrabold leading-tight text-black">
                      {rec.title}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${
                          cfg.classes || "border-gray-200 bg-gray-50 text-gray-700"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${cfg.dot || "bg-gray-400"}`}
                        />
                        {cfg.label || defaultPriorityLabel(rec.priority)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-1 flex-shrink-0 text-gray-400">
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </div>
              </button>

              {isExpanded ? (
                <div className="border-t border-gray-100 px-5 py-4">
                  <div className="text-[13px] leading-6 text-gray-600">{rec.body}</div>

                  <div className="mt-3 flex items-start gap-2 rounded bg-gray-50 px-3 py-2">
                    <ArrowRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                    <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                      {rec.action}
                    </p>
                  </div>

                  {Array.isArray(rec.metricLinks) && rec.metricLinks.length ? (
                    <div className="mt-3">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">
                        Metric Preview
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {rec.metricLinks.map((metric, index) => {
                          const metricId = metric?.id || `${rec.id}-metric-${index}`;
                          const disabled = !metric?.onClick;
                          return (
                            <button
                              key={metricId}
                              type="button"
                              onClick={() => metric.onClick?.()}
                              disabled={disabled}
                              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition-all ${
                                disabled
                                  ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                                  : "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-100"
                              }`}
                            >
                              <span>{metric?.label || "Metric"}</span>
                              {metric?.value !== undefined ? (
                                <span
                                  className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                                    disabled
                                      ? "bg-gray-200 text-gray-500"
                                      : "bg-white/80 text-blue-800"
                                  }`}
                                >
                                  {metric.value}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default InteractiveRecommendations;
