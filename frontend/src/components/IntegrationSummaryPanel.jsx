function formatMetricValue(key, value) {
  const numericValue = Number(value || 0);

  if (key.includes("pct")) {
    return `${numericValue.toFixed(1)}%`;
  }

  return numericValue.toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

function IntegrationSummaryPanel({
  title,
  subtitle,
  items = [],
  loading = false,
}) {
  if (loading) {
    return (
      <div className="rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
        <div className="h-5 w-56 rounded bg-gray-200 animate-pulse" />
        <div className="mt-3 h-4 w-80 rounded bg-gray-100 animate-pulse" />
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
          {[...Array(3)].map((_, index) => (
            <div
              key={index}
              className="rounded border border-gray-100 bg-gray-50 p-5 animate-pulse"
            >
              <div className="h-4 w-28 rounded bg-gray-200" />
              <div className="mt-4 space-y-3">
                {[...Array(3)].map((__, metricIndex) => (
                  <div key={metricIndex} className="h-4 rounded bg-gray-100" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!items.length) {
    return null;
  }

  return (
    <div className="rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
      <h3 className="text-[16px] font-extrabold">{title}</h3>
      {subtitle ? (
        <p className="mt-2 text-sm leading-6 text-gray-500">{subtitle}</p>
      ) : null}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded border border-gray-100 bg-[#f8f8f3] p-5"
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400">
              {item.label}
            </p>
            <div className="mt-4 space-y-3">
              {Object.entries(item.metrics || {}).map(([key, value]) => (
                <div
                  key={key}
                  className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <span className="text-[12px] font-semibold capitalize text-gray-500">
                    {key.replace(/_/g, " ")}
                  </span>
                  <span className="text-[14px] font-black text-black">
                    {formatMetricValue(key, value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default IntegrationSummaryPanel;
