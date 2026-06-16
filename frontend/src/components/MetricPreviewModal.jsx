import Modal from "./Modal";
import { Sparkles } from "lucide-react";
import { useAIPlanner } from "../context/AIPlannerContext";

const DEFAULT_EMPHASIS_KEYS = new Set([
  "adminUnit",
  "facilityName",
  "metric",
  "name",
  "ta",
]);

export default function MetricPreviewModal({
  metricPreview,
  onClose,
  description = "Previewing records behind this recommendation metric.",
  emptyMessage = "No preview records available for this metric.",
  emphasisKeys = DEFAULT_EMPHASIS_KEYS,
}) {
  const { openAIPlanner } = useAIPlanner();
  const columns = metricPreview?.columns || [];
  const rows = metricPreview?.rows || [];
  const emphasized = emphasisKeys instanceof Set ? emphasisKeys : new Set(emphasisKeys);

  return (
    <Modal
      isOpen={Boolean(metricPreview)}
      onClose={onClose}
      title={metricPreview?.title || "Metric Preview"}
      size="xl"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-600">
          {description}
        </p>
        <button
          type="button"
          onClick={() =>
            openAIPlanner({
              mode: "insights",
              title: metricPreview?.title || "Metric Preview",
              metricId: metricPreview?.metricId || metricPreview?.title || "",
              metricLabel: metricPreview?.title || "Selected metric",
              query:
                metricPreview?.aiQuery ||
                `What does ${metricPreview?.title || "this metric"} imply for planning in this area?`,
              sourceTitle: metricPreview?.title || "",
            })
          }
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Ask AI about this metric
        </button>
      </div>
      <div className="max-h-[68vh] overflow-auto rounded-lg border border-slate-200">
        <table className="min-w-[900px] w-full divide-y divide-slate-200 text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500"
                >
                  {column.label || column.key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.length ? (
              rows.map((row, rowIndex) => (
                <tr key={row.id || `row-${rowIndex}`}>
                  {columns.map((column) => (
                    <td
                      key={`${row.id || rowIndex}-${column.key}`}
                      className={`px-3 py-2 ${
                        emphasized.has(column.key)
                          ? "font-semibold text-slate-900"
                          : "text-slate-700"
                      }`}
                    >
                      {row[column.key] ?? "-"}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={Math.max(columns.length, 1)}
                  className="px-3 py-8 text-center text-sm font-semibold text-slate-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
