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
import { useDistrict } from "../context/DistrictContext";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDistrictOptions } from "../hooks/useDistrictOptions";
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

  return `${value.slice(0, 8)}…`;
}

function PopulationPage() {
  const { selectedDistrict, setSelectedDistrict } = useDistrict();
  const { contentRef, exportPdf } = usePdfExport('Population_Report.pdf');
  const districts = useDistrictOptions();
  const summary = useDashboardData(
    buildDashboardPath("/dashboard/summary", { district: selectedDistrict }),
  );
  const districtBoundaries = useDashboardData(
    buildDashboardPath("/dashboard/admin-units", {
      type: "District",
      district: selectedDistrict,
    }),
  );
  const populationDistribution = useDashboardData(
    "/dashboard/population-by-district",
  );
  const populationIntegration = useDashboardData(
    buildDashboardPath("/dashboard/welfare/integration", {
      district: selectedDistrict,
      admin_type: "District",
    }),
  );

  const chartData = populationDistribution.data || [];
  const totalPopulation = Number(summary.data?.total_estimated_population || 0);
  const maxPopulation = Math.max(
    ...chartData.map((item) => Number(item.population) || 0),
    0,
  );

  return (
    <div ref={contentRef} className="min-h-screen bg-white text-black font-sans pb-10">
      <div className="flex items-center gap-4 border-b border-gray-200 px-8 py-8">
        <Users2 className="h-8 w-8 text-black" />
        <h1 className="text-[28px] font-extrabold tracking-tight">POPULATION</h1>
      </div>

      <div className="mt-8 px-8">
        <p className="mb-6 text-[14px] font-semibold text-gray-500">
          {selectedDistrict
            ? `Population surface focused on ${selectedDistrict}`
            : "Zomba and Zomba City population surface from the WorldPop raster"}
        </p>

        <div className="mb-8 flex gap-4">
          <button 
            onClick={exportPdf}
            className="flex items-center gap-2 rounded border border-gray-300 px-3 py-1.5 text-[13px] font-bold transition-all hover:bg-gray-50 active:scale-95 shadow-sm"
          >
            <Download className="h-4 w-4" />
            Download PDF
          </button>

          <div className="relative">
            <select
              className="min-w-[160px] cursor-pointer appearance-none rounded bg-black px-6 py-2 text-[14px] font-bold text-white"
              value={selectedDistrict}
              onChange={(event) => setSelectedDistrict(event.target.value)}
            >
              <option value="">All Districts</option>
              {districts.options?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.75fr)]">
          <div className="rounded border border-gray-100 bg-white p-8 shadow-sm">
            <PopulationRasterPanel
              geojson={districtBoundaries.data}
              title="WorldPop Population Surface"
              subtitle="Rendered directly from the Zomba 2020 GeoTIFF so the map keeps the fine-grained heatmap pattern instead of district-wide color blocks."
              heightClass="h-[620px]"
              loading={districtBoundaries.loading}
              metadataUrl="/worldpop/zomba_ppp_2020.preview.json"
            />
          </div>

          <div className="rounded border border-gray-100 bg-white p-8 shadow-sm">
            <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-gray-400">
              Coverage
            </p>
            <div className="mt-4 text-[38px] font-extrabold tracking-tight text-black">
              {totalPopulation.toLocaleString()}
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              Estimated total population currently visible in the dashboard summary.
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
                  Styled from the GeoTIFF so dense urban pockets remain visible at a much finer resolution.
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
                  Administrative boundaries are drawn on top only as a guide, not as the color source.
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

        <div className="rounded border border-gray-100 bg-white p-8 shadow-sm">
          <h3 className="mb-6 text-[16px] font-extrabold">
            Population by district
          </h3>
          <div className="h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 20, right: 20, left: 12, bottom: 92 }}
              >
                <CartesianGrid
                  stroke="#f1f5f9"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="district"
                  axisLine={false}
                  tick={{ fill: "#64748b", fontSize: 9, fontWeight: 700 }}
                  tickFormatter={formatDistrictAxisLabel}
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
                >
                  {chartData.map((entry) => (
                    <Cell
                      key={`population-bar-${entry.district}`}
                      fill={getPopulationBarColor(
                        Number(entry.population),
                        maxPopulation,
                      )}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PopulationPage;
