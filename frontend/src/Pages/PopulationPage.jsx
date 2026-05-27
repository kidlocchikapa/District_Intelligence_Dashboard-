import { useMemo, useState } from "react";
import { Download, Users2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import IntegrationSummaryPanel from "../components/IntegrationSummaryPanel";
import PopulationRasterPanel from "../components/PopulationRasterPanel";
import SharedDistrictSelector from "../components/SharedDistrictSelector";
import { useDistrict } from "../context/DistrictContext";
import { useDashboardData } from "../hooks/useDashboardData";
import { usePdfExport } from "../hooks/usePdfExport";
import { buildDashboardPath } from "../lib/query";

function getPopulationBarColor(value, maxPopulation) {
  if (!Number.isFinite(value) || maxPopulation <= 0) {
    return "#cbd5e1";
  }

  const ratio = value / maxPopulation;

  if (ratio >= 0.8) return "#dc2626";
  if (ratio >= 0.55) return "#8b5e3c";
  if (ratio >= 0.3) return "#2563eb";
  return "#22c55e";
}

function formatDistrictAxisLabel(value) {
  if (!value) {
    return "";
  }

  if (value.length <= 8) {
    return value;
  }

  return `${value.slice(0, 8)}...`;
}

function formatTaAxisLabel(value) {
  if (!value) {
    return "";
  }

  if (value.length <= 16) {
    return value;
  }

  return `${value.slice(0, 16)}...`;
}

function formatStat(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return Number(value).toLocaleString();
}

const POPULATION_CHART_LIMITS = [
  { value: 10, label: "Top 10" },
  { value: 20, label: "Top 20" },
  { value: 0, label: "All" },
];

function PopulationPage() {
  const { selectedDistrict, selectedTa, setSelectedTa } = useDistrict();
  const [chartSearch, setChartSearch] = useState("");
  const [chartLimit, setChartLimit] = useState(20);
  const [chartSortMode, setChartSortMode] = useState("population_desc");
  const { contentRef, exportDataPdf } = usePdfExport("Population_Report.pdf");
  const summary = useDashboardData(
    buildDashboardPath("/dashboard/summary", {
      district: selectedDistrict,
      ta: selectedTa,
    }),
  );
  const districtBoundaries = useDashboardData(
    buildDashboardPath("/dashboard/admin-units", {
      type: selectedDistrict || selectedTa ? "TA" : "District",
      district: selectedDistrict,
    }),
  );
  const populationDistribution = useDashboardData(
    selectedDistrict
      ? buildDashboardPath("/dashboard/population-by-admin3", {
          district: selectedDistrict,
          type: "TA",
        })
      : "/dashboard/population-by-district",
  );
  const populationIntegration = useDashboardData(
    buildDashboardPath("/dashboard/welfare/integration", {
      district: selectedDistrict,
      ta: selectedTa,
      admin_type: "District",
    }),
  );

  const chartData = useMemo(() => {
    return selectedDistrict
      ? (populationDistribution.data || []).map((item) => ({
          label: item.admin3_name,
          population: Number(item.population || 0),
        }))
      : (populationDistribution.data || []).map((item) => ({
          label: item.district,
          population: Number(item.population || 0),
        }));
  }, [populationDistribution.data, selectedDistrict]);

  const filteredChartData = useMemo(() => {
    const searchTerm = chartSearch.trim().toLowerCase();
    let rows = [...chartData];

    if (searchTerm) {
      rows = rows.filter((item) =>
        String(item.label || "").toLowerCase().includes(searchTerm),
      );
    }

    rows.sort((left, right) => {
      if (chartSortMode === "population_asc") {
        return Number(left.population || 0) - Number(right.population || 0);
      }

      if (chartSortMode === "label_asc") {
        return String(left.label || "").localeCompare(String(right.label || ""));
      }

      return Number(right.population || 0) - Number(left.population || 0);
    });

    if (chartLimit > 0) {
      return rows.slice(0, chartLimit);
    }

    return rows;
  }, [chartData, chartLimit, chartSearch, chartSortMode]);
  const totalPopulation = Number(summary.data?.total_estimated_population || 0);
  const maxPopulation = Math.max(
    ...filteredChartData.map((item) => Number(item.population) || 0),
    0,
  );

  const handleDownloadReport = async () => {
    const selectedAreaName = selectedTa
      ? `TA: ${selectedTa}`
      : selectedDistrict
        ? `District: ${selectedDistrict}`
        : "National";

    const rows = [
      {
        metric: "Estimated Population",
        value: totalPopulation.toLocaleString(),
      },
      {
        metric: "Population Density",
        value: formatStat(summary.data?.total_population_density || 0),
      },
      {
        metric: "Flood Exposed Population",
        value: formatStat(summary.data?.exposed_population || 0),
      },
      {
        metric: "Not Exposed Population",
        value: formatStat(summary.data?.not_exposed_population || 0),
      },
    ];

    const topRows = [...chartData]
      .sort((left, right) => Number(right.population || 0) - Number(left.population || 0))
      .slice(0, 8)
      .map((item) => ({
        metric: item.label,
        value: Number(item.population || 0).toLocaleString(),
      }));

    await exportDataPdf({
      title: "Population Area Analysis",
      selectedArea: selectedAreaName,
      sections: [
        {
          title: "Population Summary",
          columns: [
            { key: "metric", label: "Metric", width: 260 },
            { key: "value", label: "Value", width: 180 },
          ],
          rows,
        },
        {
          title: "Top Location Population",
          columns: [
            { key: "metric", label: selectedDistrict ? "TA" : "District", width: 260 },
            { key: "value", label: "Population", width: 180 },
          ],
          rows: topRows.length ? topRows : [
            { metric: "No population rows", value: "No data available" },
          ],
        },
      ],
    });
  };

  return (
    <div
      ref={contentRef}
      className="min-h-screen bg-white text-black font-sans pb-10"
    >
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-5 sm:gap-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <Users2 className="h-8 w-8 text-black" />
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">
          POPULATION
        </h1>
      </div>

      <div className="mt-6 px-4 sm:mt-8 sm:px-6 lg:px-8">
        <p className="mb-6 text-[14px] font-semibold text-gray-500">
          {selectedDistrict
            ? `Population surface focused on ${selectedTa || selectedDistrict}`
            : "Zomba population surface from the WorldPop raster"}
        </p>

        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          <button
            onClick={handleDownloadReport}
            className="flex w-full items-center justify-center gap-2 rounded border border-gray-300 px-3 py-2 text-[13px] font-bold shadow-sm transition-all hover:bg-gray-50 active:scale-95 sm:w-auto sm:justify-start sm:py-1.5"
          >
            <Download className="h-4 w-4" />
            Download Area Analysis
          </button>
          <SharedDistrictSelector />

        </div>

        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.75fr)]">
          <div className="rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
              <PopulationRasterPanel
                geojson={districtBoundaries.data}
                title="WorldPop Population Surface"
              subtitle="Rendered directly from the Zomba 2020 GeoTIFF so the map keeps the fine-grained heatmap pattern instead of district-wide color blocks."
              heightClass="h-[380px] sm:h-[500px] lg:h-[620px]"
                loading={districtBoundaries.loading}
                metadataUrl="/worldpop/zomba_ppp_2020.preview.json"
                selectedFeatureName={selectedTa}
                onFeatureClick={(feature) =>
                  setSelectedTa(feature?.properties?.name || "")
                }
              />
          </div>

          <div className="rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
            <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-gray-400">
              Coverage
            </p>
            <div className="mt-4 text-[38px] font-extrabold tracking-tight text-black">
              {totalPopulation.toLocaleString()}
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              Estimated total population currently visible in the dashboard
              summary.
            </p>

            <div className="mt-8 space-y-5">
              <div className="rounded-2xl bg-[#f8f8f3] p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400">
                  Raster Source
                </p>
                <p className="mt-2 text-base font-semibold text-black">
                  Malawi WorldPop 2020
                </p>
                <p className="mt-2 text-sm leading-6 text-gray-500">
                  Styled from the GeoTIFF so dense urban pockets remain visible
                  at a much finer resolution.
                </p>
              </div>

              <div className="rounded-2xl bg-[#f8f8f3] p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400">
                  District Overlay
                </p>
                <p className="mt-2 text-base font-semibold text-black">
                  {selectedDistrict || "All district outlines"}
                </p>
                <p className="mt-2 text-sm leading-6 text-gray-500">
                  Administrative boundaries are drawn on top only as a guide,
                  not as the color source.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-8">
          <IntegrationSummaryPanel
            title="Integrated Population Context"
            subtitle="Population distribution shown with linked beneficiary concentration, education access, health access, and flood exposure."
            loading={populationIntegration.loading}
            items={[
              {
                label: "Beneficiary Footprint",
                metrics: {
                  total_beneficiaries:
                    populationIntegration.data?.summary?.total_beneficiaries ||
                    0,
                  total_household_members:
                    populationIntegration.data?.summary
                      ?.total_household_members || 0,
                },
              },
              {
                label: "Service Access",
                metrics: {
                  beneficiaries_with_school_access:
                    populationIntegration.data?.summary?.school_access_count ||
                    0,
                  beneficiaries_with_health_access:
                    populationIntegration.data?.summary?.health_access_count ||
                    0,
                },
              },
              {
                label: "Risk Link",
                metrics: {
                  flood_affected_beneficiaries:
                    populationIntegration.data?.summary?.flood_affected_count ||
                    0,
                  flood_affected_pct:
                    populationIntegration.data?.summary?.flood_affected_pct ||
                    0,
                },
              },
            ]}
          />
        </div>

        <div className="rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
          <h3 className="mb-6 text-[16px] font-extrabold">
            {selectedDistrict
              ? `Population by TA in ${selectedTa || selectedDistrict}`
              : "Population by district"}
          </h3>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {POPULATION_CHART_LIMITS.map((option) => {
                const isActive = option.value === chartLimit;
                return (
                  <button
                    key={`population-limit-${option.label}`}
                    type="button"
                    onClick={() => setChartLimit(option.value)}
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] transition ${
                      isActive
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 bg-white text-gray-500 hover:text-black"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
              <select
                value={chartSortMode}
                onChange={(event) => setChartSortMode(event.target.value)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-600"
              >
                <option value="population_desc">Highest first</option>
                <option value="population_asc">Lowest first</option>
                <option value="label_asc">Name A-Z</option>
              </select>
            </div>
            <input
              type="search"
              value={chartSearch}
              onChange={(event) => setChartSearch(event.target.value)}
              placeholder={`Search ${selectedDistrict ? "TA" : "district"}...`}
              className="w-full rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 outline-none focus:border-gray-900 lg:w-80"
            />
          </div>
          <p className="mb-5 text-xs font-semibold text-gray-500">
            Showing {filteredChartData.length} of {chartData.length}{" "}
            {selectedDistrict ? "TAs" : "districts"}.
          </p>
          <div className="h-[340px] overflow-x-auto sm:h-[420px]">
            {filteredChartData.length ? (
              <div className="h-full min-w-[620px] sm:min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={filteredChartData}
                    margin={{ top: 20, right: 20, left: 12, bottom: 92 }}
                  >
                    <CartesianGrid
                      stroke="#f1f5f9"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tick={{ fill: "#64748b", fontSize: 9, fontWeight: 700 }}
                      tickFormatter={
                        selectedDistrict ? formatTaAxisLabel : formatDistrictAxisLabel
                      }
                      tickLine={false}
                      angle={-90}
                      textAnchor="end"
                      interval={0}
                      height={112}
                    />
                    <YAxis
                      axisLine={false}
                      tick={{ fill: "#64748b", fontSize: 11, fontWeight: 700 }}
                      tickLine={false}
                      tickFormatter={(value) =>
                        Number(value) >= 1000000
                          ? `${(value / 1000000).toFixed(1)}M`
                          : value
                      }
                    />
                    <Tooltip
                      formatter={(value) => Number(value).toLocaleString()}
                      labelFormatter={(label) => label}
                      contentStyle={{
                        borderRadius: "4px",
                        border: "none",
                        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                        fontSize: "12px",
                      }}
                      cursor={{ fill: "#f8fafc" }}
                    />
                    <Bar
                      dataKey="population"
                      radius={[2, 2, 0, 0]}
                      barSize={14}
                      activeBar={<Rectangle fill="#7e22ce" />}
                      onClick={(entry) => {
                        if (selectedDistrict && entry?.label) {
                          setSelectedTa(entry.label);
                        }
                      }}
                    >
                      {filteredChartData.map((entry) => {
                        const isSelected =
                          selectedTa &&
                          entry.label.toLowerCase() === selectedTa.toLowerCase();

                        return (
                          <Cell
                            key={`population-bar-${entry.label}`}
                            cursor={selectedDistrict ? "pointer" : "default"}
                            fill={
                              isSelected
                                ? "#7e22ce"
                                : getPopulationBarColor(
                                    Number(entry.population),
                                    maxPopulation,
                                  )
                            }
                            stroke={isSelected ? "#111827" : "transparent"}
                            strokeWidth={isSelected ? 2 : 0}
                            fillOpacity={selectedTa && !isSelected ? 0.28 : 1}
                          />
                        );
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded border border-dashed border-gray-200 bg-gray-50 text-sm font-semibold text-gray-400">
                No rows match the current chart filters.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PopulationPage;

