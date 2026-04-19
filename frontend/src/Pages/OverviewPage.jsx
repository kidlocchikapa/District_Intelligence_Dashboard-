import {
  Download,
  Users,
  School,
  HeartPulse,
  Accessibility,
} from "lucide-react";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDistrictOptions } from "../hooks/useDistrictOptions";
import { useDistrict } from "../context/DistrictContext";
import { buildDashboardPath } from "../lib/query";
import { usePdfExport } from "../hooks/usePdfExport";
import PopulationRasterPanel from "../components/PopulationRasterPanel";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Rectangle,
  Cell,
} from "recharts";

const COLORS = ["#4A72E4", "#F4B41A", "#3BB182", "#6974D6"];

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

function OverviewPage() {
  const { selectedDistrict, setSelectedDistrict } = useDistrict();
  const districts = useDistrictOptions();
  const summary = useDashboardData(
    buildDashboardPath("/dashboard/summary", { district: selectedDistrict }),
  );
  const densityMap = useDashboardData(
    buildDashboardPath("/dashboard/admin-units", {
      type: "District",
      district: selectedDistrict,
    }),
  );
  const populationDistribution = useDashboardData(
    buildDashboardPath("/dashboard/population-by-district", {
      district: selectedDistrict,
    }),
  );
  const floodSummary = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood/summary", {
      district: selectedDistrict,
      admin_type: "District",
    }),
  );

  const chartData = populationDistribution.data || [];
  const exposedPopulation = Math.max(
    Number(floodSummary.data?.exposed_population || 0),
    0,
  );
  const notExposedPopulation = Math.max(
    Number(floodSummary.data?.not_exposed_population || 0),
    0,
  );
  const pieData = [
    { name: "Exposed", value: exposedPopulation },
    { name: "Not Exposed", value: notExposedPopulation },
  ].filter((entry) => entry.value > 0);
  const maxPopulation = Math.max(
    ...chartData.map((item) => Number(item.population) || 0),
    0,
  );

  const { contentRef, exportPdf } = usePdfExport("Overview_Report.pdf");

  const formatStat = (val) => {
    if (!val) return "0";
    return Number(val).toLocaleString();
  };

  const StatCardSkeleton = () => (
    <div className="border border-gray-100 rounded p-6 shadow-md bg-white relative animate-pulse">
      <div className="flex justify-between items-start mb-4">
        <div className="h-4 w-32 bg-gray-200 rounded"></div>
        <div className="h-5 w-5 bg-gray-100 rounded-full"></div>
      </div>
      <div className="h-8 w-24 bg-gray-200 rounded mt-2"></div>
    </div>
  );

  const ChartSkeleton = () => (
    <div className="h-full w-full flex flex-col gap-4 animate-pulse">
      <div className="flex-1 bg-gray-50 rounded-lg relative overflow-hidden">
        <div className="absolute inset-0 flex items-end justify-around px-4 pb-4">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="w-8 bg-gray-200 rounded-t"
              style={{ height: `${Math.random() * 60 + 20}%` }}
            ></div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div
      ref={contentRef}
      className="min-h-screen bg-white text-black font-sans pb-10"
    >
      {/* Header Area */}
      <div className="flex items-center gap-4 px-8 py-8 border-b border-gray-200">
        <h1 className="text-[28px] font-extrabold tracking-tight">OVERVIEW</h1>
      </div>

      <div className="px-8 mt-8">
        <p className="text-[14px] font-semibold text-gray-500 mb-6">
          {selectedDistrict
            ? `Showing ${selectedDistrict} Records`
            : "Showing All districts Records"}
        </p>

        {/* Actions Row */}
        <div className="flex gap-4 mb-8">
          <button
            onClick={exportPdf}
            className="flex items-center gap-2 border border-gray-300 rounded px-3 py-1.5 text-[13px] font-bold hover:bg-gray-50 transition-all shadow-sm active:scale-95"
          >
            <Download className="h-4 w-4" />
            Download PDF
          </button>

          <div className="relative">
            <select
              className="bg-black text-white rounded px-6 py-2 text-[14px] font-bold appearance-none min-w-[160px] cursor-pointer hover:bg-black/90"
              value={selectedDistrict}
              onChange={(e) => setSelectedDistrict(e.target.value)}
            >
              <option value="">Select District</option>
              {districts.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-white">
              <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          {summary.loading
            ? [...Array(4)].map((_, i) => <StatCardSkeleton key={i} />)
            : [
                {
                  label: "Total Population",
                  value: formatStat(
                    summary.data?.total_estimated_population || 0,
                  ),
                  icon: Users,
                },
                {
                  label: "Schools",
                  value: formatStat(summary.data?.total_schools || 0),
                  icon: School,
                },
                {
                  label: "Health Facilities",
                  value: formatStat(summary.data?.total_health_facilities || 0),
                  icon: HeartPulse,
                },
                {
                  label: "Flood Exposed Population",
                  value: formatStat(exposedPopulation),
                  icon: Accessibility,
                },
              ].map((stat, i) => (
                <div
                  key={i}
                  className="border border-gray-100 rounded p-6 shadow-md bg-white relative hover:shadow-lg transition-all group active:scale-95 cursor-default"
                >
                  <div className="flex justify-between items-start">
                    <span className="text-[14px] text-gray-500 font-bold group-hover:text-black transition-colors">
                      {stat.label}
                    </span>
                    <stat.icon className="h-5 w-5 text-gray-300 group-hover:text-black transition-colors" />
                  </div>
                  <div className="mt-4 text-[32px] font-extrabold tracking-tight">
                    {stat.value}
                  </div>
                </div>
              ))}
        </div>

        {/* Middle Row (Map + Bar Chart) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white flex flex-col h-[480px]">
            <h3 className="text-[16px] font-extrabold mb-6">
              District Map Overview
            </h3>
            <div className="w-full flex-1 rounded overflow-hidden relative border border-gray-50 shadow-inner bg-gray-50">
              <PopulationRasterPanel
                geojson={densityMap.data}
                title={null}
                subtitle={null}
                heightClass="h-full w-full"
                loading={densityMap.loading}
              />
            </div>
          </div>

          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white flex flex-col min-h-[460px]">
            <h3 className="text-[16px] font-extrabold mb-6">
              Population by district
            </h3>
            <div className="flex-1">
              {populationDistribution.loading ? (
                <ChartSkeleton />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 20, right: 20, left: 12, bottom: 92 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#f1f5f9"
                    />
                    <XAxis
                      dataKey="district"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#64748b", fontSize: 9, fontWeight: 700 }}
                      tickFormatter={formatDistrictAxisLabel}
                      angle={-90}
                      textAnchor="end"
                      interval={0}
                      height={112}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#64748b", fontSize: 11, fontWeight: 700 }}
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
              )}
            </div>
          </div>
        </div>

        {/* Bottom Row (Pie Chart) */}
        <div className="border border-gray-100 rounded p-10 shadow-sm bg-white">
          <h3 className="text-[16px] font-extrabold mb-10">
            Flood Exposure Distribution
          </h3>
          <div className="w-full flex flex-col md:flex-row items-center justify-start gap-16">
            <div className="h-[280px] w-full md:w-[400px]">
              {floodSummary.loading ? (
                <div className="flex items-center justify-center h-full text-gray-400">
                  Loading flood exposure data...
                </div>
              ) : pieData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-400">
                  No data available
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: "4px",
                        border: "none",
                        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Custom Pie Legend */}
            <div className="flex flex-col gap-6">
              {pieData.map((entry, index) => (
                <div key={index} className="flex items-center gap-4">
                  <div
                    className="w-5 h-5 rounded-full"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="text-[16px] text-gray-700 font-semibold">
                    {entry.name} :
                  </span>
                  <span className="text-[16px] font-extrabold text-black">
                    {entry.value.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OverviewPage;
