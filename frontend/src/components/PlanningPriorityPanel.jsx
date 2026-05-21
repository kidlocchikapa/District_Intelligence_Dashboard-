import { ArrowRight, ShieldAlert } from "lucide-react";

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function getPriorityClasses(band) {
  if (band === "Critical") return "border-red-200 bg-red-50 text-red-700";
  if (band === "High") return "border-amber-200 bg-amber-50 text-amber-700";
  if (band === "Moderate") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default function PlanningPriorityPanel({
  planningPriorities,
  scopeLabel,
  compact = false,
}) {
  const priorities = planningPriorities?.data?.priorities || [];
  const loading = planningPriorities?.loading;

  return (
    <section className="border border-gray-100 rounded p-6 shadow-sm bg-white mb-10">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400">
            <ShieldAlert className="h-4 w-4" />
            Planning Intelligence
          </div>
          <h3 className="mt-2 text-[20px] font-extrabold tracking-tight text-black">
            Priority Areas For {scopeLabel}
          </h3>
          <p className="mt-1 text-[13px] font-medium text-gray-500">
            Ranked according to the current department context for this page.
          </p>
        </div>
        {planningPriorities?.data?.summary?.highest_priority_area ? (
          <div className="text-right">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400">
              Highest Priority
            </div>
            <div className="mt-1 text-[15px] font-extrabold text-black">
              {planningPriorities.data.summary.highest_priority_area}
            </div>
            <div className="text-[12px] font-semibold text-gray-500">
              Score {formatNumber(planningPriorities.data.summary.highest_priority_score, 1)}
            </div>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded border border-dashed border-gray-200 px-4 py-8 text-sm font-medium text-gray-500">
          Loading planning priorities...
        </div>
      ) : priorities.length === 0 ? (
        <div className="rounded border border-dashed border-gray-200 px-4 py-8 text-sm font-medium text-gray-500">
          No ranked planning priorities are available for this scope yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {priorities.slice(0, compact ? 4 : 6).map((item) => (
            <article
              key={`${item.admin_unit_type}-${item.admin_unit_id}`}
              className="rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black text-[12px] font-extrabold text-white">
                      {item.rank}
                    </span>
                    <h4 className="text-[16px] font-extrabold text-black">
                      {item.admin_unit_name}
                    </h4>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${getPriorityClasses(item.priority_band)}`}>
                      {item.priority_band}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] font-medium leading-6 text-gray-600">
                    {item.narrative}
                  </p>
                </div>
                <div className="text-right min-w-[116px]">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">
                    Priority Score
                  </div>
                  <div className="mt-1 text-[24px] font-extrabold tracking-tight text-black">
                    {formatNumber(item.planning_priority_score, 1)}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <Metric label="Beneficiaries" value={formatNumber(item.beneficiary_count)} />
                <Metric label="Flood Exposed %" value={`${formatNumber(item.flood_exposed_population_pct, 1)}%`} />
                <Metric label="Education Risk" value={formatNumber(item.education_vulnerability_score, 1)} />
                <Metric label="Health Risk" value={formatNumber(item.health_vulnerability_score, 1)} />
              </div>

              <div className="mt-4 space-y-2">
                {item.recommended_actions?.slice(0, 2).map((action) => (
                  <div key={action} className="flex items-start gap-2 text-[13px] font-medium text-gray-700">
                    <ArrowRight className="mt-0.5 h-4 w-4 flex-none text-gray-400" />
                    <span>{action}</span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-white bg-white px-3 py-3 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">
        {label}
      </div>
      <div className="mt-1 text-[16px] font-extrabold text-black">
        {value}
      </div>
    </div>
  );
}
