import { ShieldAlert } from "lucide-react";

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function getPriorityBadgeMeta(band) {
  if (band === "Critical" || band === "High") {
    return {
      label: "High Priority",
      classes: "border-red-200 bg-red-50 text-red-700",
    };
  }

  if (band === "Moderate") {
    return {
      label: "Medium Priority",
      classes: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  return {
    label: "Watch Priority",
    classes: "border-blue-200 bg-blue-50 text-blue-700",
  };
}

function getDriverRanking(item) {
  const drivers = [
    { label: "Flood", value: Number(item?.flood_risk_score || 0) },
    { label: "Healthcare", value: Number(item?.health_vulnerability_score || 0) },
    { label: "Education", value: Number(item?.education_vulnerability_score || 0) },
    { label: "Service Gap", value: Number(item?.service_gap_score || 0) },
    { label: "Beneficiary Density", value: Number(item?.beneficiary_density_score || 0) },
  ]
    .filter((driver) => driver.value > 0)
    .sort((left, right) => right.value - left.value);

  return drivers;
}

function getDriverSubtitle(item) {
  const drivers = getDriverRanking(item);

  if (drivers.length >= 2) {
    return `${drivers[0].label} & ${drivers[1].label} Vulnerability`;
  }

  if (drivers.length === 1) {
    return `${drivers[0].label} Vulnerability`;
  }

  return "Composite Vulnerability Profile";
}

function getGeneratedTopInsight(primaryDriver) {
  if (primaryDriver === "Healthcare") {
    return "Healthcare continuity is the primary risk driver.";
  }

  if (primaryDriver === "Flood") {
    return "Flood exposure is the primary risk driver.";
  }

  if (primaryDriver === "Education") {
    return "Education pressure is the primary risk driver.";
  }

  if (primaryDriver === "Service Gap") {
    return "Service access gaps are the primary risk driver.";
  }

  if (primaryDriver === "Beneficiary Density") {
    return "Beneficiary concentration is the primary risk driver.";
  }

  return "Composite risk pressure indicates this area needs targeted action.";
}

function getTopInsight(item) {
  const primaryDriver = getDriverRanking(item)[0]?.label;
  const narrative = String(item?.narrative || "").trim();

  if (!narrative) {
    return getGeneratedTopInsight(primaryDriver);
  }

  const sentenceMatch = narrative.match(/^.*?[.!?](\s|$)/);
  const firstSentence = sentenceMatch ? sentenceMatch[0].trim() : narrative;
  return firstSentence.endsWith(".") ? firstSentence : `${firstSentence}.`;
}

function getRecommendedActions(item) {
  const actions = (item?.recommended_actions || [])
    .map((action) => String(action || "").trim())
    .filter(Boolean)
    .slice(0, 3);

  if (actions.length > 0) {
    return actions;
  }

  return [
    "Prepare area-specific contingency actions.",
    "Review critical service catchments.",
    "Deploy targeted outreach and continuity support.",
  ];
}

export default function PlanningPriorityPanel({
  planningPriorities,
  scopeLabel,
  compact = false,
  variant = "full",
  onSelectArea,
}) {
  const priorities = planningPriorities?.data?.priorities || [];
  const loading = planningPriorities?.loading;
  const isSummary = variant === "summary";
  const visiblePriorities = priorities.slice(
    0,
    compact ? (isSummary ? 5 : 4) : isSummary ? 8 : 6,
  );

  if (isSummary) {
    return (
      <section className="mt-10 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">
              <ShieldAlert className="h-4 w-4" />
              Priority Summary
            </div>
            <h3 className="mt-2 text-[18px] font-extrabold tracking-tight text-black">
              Priority Areas Action Queue
            </h3>
            <p className="mt-1 text-[13px] font-medium text-gray-500">
              Ranked areas to review after completing insights and recommendations for{" "}
              {scopeLabel}.
            </p>
          </div>
          {planningPriorities?.data?.summary?.highest_priority_area ? (
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-right">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">
                Highest Priority
              </div>
              <div className="mt-1 text-[14px] font-extrabold text-black">
                {planningPriorities.data.summary.highest_priority_area}
              </div>
              <div className="text-[11px] font-semibold text-gray-500">
                Score{" "}
                {formatNumber(
                  planningPriorities.data.summary.highest_priority_score,
                  1,
                )}
              </div>
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="rounded border border-dashed border-gray-200 px-4 py-8 text-sm font-medium text-gray-500">
            Loading planning priorities...
          </div>
        ) : visiblePriorities.length === 0 ? (
          <div className="rounded border border-dashed border-gray-200 px-4 py-8 text-sm font-medium text-gray-500">
            No ranked planning priorities are available for this scope yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {visiblePriorities.map((item) => (
              <PriorityCard
                key={`${item.admin_unit_type}-${item.admin_unit_id}`}
                item={item}
                onSelectArea={onSelectArea}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

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
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {visiblePriorities.map((item) => (
              <PriorityCard
                key={`${item.admin_unit_type}-${item.admin_unit_id}`}
                item={item}
                onSelectArea={onSelectArea}
              />
            ))}
          </div>
      )}
    </section>
  );
}

function PriorityCard({ item, onSelectArea }) {
  const clickable = typeof onSelectArea === "function";
  const CardTag = clickable ? "button" : "article";
  const badge = getPriorityBadgeMeta(item.priority_band);
  const actions = getRecommendedActions(item);

  return (
    <CardTag
      {...(clickable
        ? {
            type: "button",
            onClick: () => onSelectArea(item.admin_unit_name),
          }
        : {})}
      className={`w-full rounded-2xl border border-gray-200 bg-gray-50 p-4 text-left transition ${
        clickable ? "hover:border-gray-300 hover:bg-white" : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${badge.classes}`}
        >
          {badge.label}
        </span>
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-black px-2 text-[11px] font-extrabold text-white">
          {item.rank}
        </span>
      </div>

      <h4 className="mt-3 text-[22px] font-extrabold leading-tight text-black">
        {item.admin_unit_name}
      </h4>
      <p className="mt-1 text-[12px] font-semibold text-gray-500">
        {getDriverSubtitle(item)}
      </p>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white px-3 py-3">
        <div className="text-[30px] font-extrabold leading-none text-black">
          {formatNumber(item.planning_priority_score, 1)}
        </div>
        <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">
          Priority Score
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric label="Affected" value={formatNumber(item.beneficiary_count)} />
        <Metric
          label="Flood Exp"
          value={`${formatNumber(item.flood_exposed_population_pct, 1)}%`}
        />
        <Metric
          label="Health Risk"
          value={formatNumber(item.health_vulnerability_score, 1)}
        />
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white px-3 py-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">
          Top Insight
        </div>
        <p className="mt-1 text-[12px] font-semibold leading-5 text-gray-700">
          {getTopInsight(item)}
        </p>
      </div>

      <div className="mt-4">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">
          Recommended Actions
        </div>
        <div className="mt-2 space-y-1.5">
          {actions.map((action) => (
            <p key={action} className="text-[12px] font-semibold text-gray-700">
              {"\u2192"} {action}
            </p>
          ))}
        </div>
      </div>
    </CardTag>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-2.5 py-2.5">
      <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400">
        {label}
      </div>
      <div className="mt-1 text-[18px] font-extrabold leading-none text-black">
        {value}
      </div>
    </div>
  );
}
