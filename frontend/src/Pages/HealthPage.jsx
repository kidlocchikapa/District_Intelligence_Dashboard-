import { Activity, HeartPulse, Bed, Users, Download } from 'lucide-react';
import { useDashboardData } from '../hooks/useDashboardData';
import { useDistrict } from '../context/DistrictContext';
import { useDistrictOptions } from '../hooks/useDistrictOptions';
import { buildDashboardPath } from '../lib/query';
import { usePdfExport } from '../hooks/usePdfExport';
import MapPanel from '../components/MapPanel';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

function getFacilityBarColor(value, maxValue) {
  if (!Number.isFinite(value) || maxValue <= 0) {
    return '#cbd5e1';
  }

  const ratio = value / maxValue;

  if (ratio >= 0.8) return '#dc2626';
  if (ratio >= 0.55) return '#8b5e3c';
  if (ratio >= 0.3) return '#2563eb';
  return '#22c55e';
}

function formatDistrictAxisLabel(value) {
  if (!value) {
    return '';
  }

  if (value.length <= 8) {
    return value;
  }

  return `${value.slice(0, 8)}…`;
}

function HealthPage() {
  const { selectedDistrict, setSelectedDistrict } = useDistrict();
  const { contentRef, exportPdf } = usePdfExport('Health_Report.pdf');
  const districts = useDistrictOptions();
  const servedPopulationSummary = useDashboardData(
    buildDashboardPath('/dashboard/health/served-population', {
      district: selectedDistrict,
      admin_type: 'District',
    }),
  );
  
  // Summary Aggregates
  const healthSummary = useDashboardData(buildDashboardPath('/dashboard/health/summary', { 
    district: selectedDistrict,
    admin_type: 'District'
  }));
  const districtHealthSummary = useDashboardData(
    buildDashboardPath('/dashboard/health/summary', {
      admin_type: 'District',
    }),
  );

  // Health Facility GeoJSON for Map
  const healthLocations = useDashboardData(buildDashboardPath('/dashboard/health', { 
    district: selectedDistrict 
  }));

  const findMetricTotal = (name) => {
    return (healthSummary.data || [])
      .filter((metric) => metric.metric_name === name)
      .reduce((sum, metric) => sum + Number(metric.metric_value || 0), 0);
  };

  const formatStat = (val) => Number(val).toLocaleString();
  const facilityChartData = (districtHealthSummary.data || [])
    .filter((metric) => metric.metric_name === 'health_facility_count')
    .map((metric) => ({
      district: metric.admin_unit_name,
      facilities: Number(metric.metric_value || 0),
    }));
  const maxFacilities = Math.max(
    ...facilityChartData.map((item) => item.facilities || 0),
    0,
  );
  const getServedPopulationValue = (metricName) =>
    (servedPopulationSummary.data || [])
      .filter((metric) => metric.metric_name === metricName)
      .reduce((sum, metric) => sum + Number(metric.metric_value || 0), 0);
  const accessTotal = Math.max(
    getServedPopulationValue('health_population_served_total'),
    0,
  );
  const noAccessTotal = Math.max(
    getServedPopulationValue('health_population_unserved_total'),
    0,
  );
  const totalPopulationInAccessView = accessTotal + noAccessTotal;
  const accessPieData = [
    { name: 'Has access', value: accessTotal, color: '#2563eb' },
    { name: 'No access', value: noAccessTotal, color: '#dc2626' },
  ].filter((entry) => entry.value > 0);
  const accessShare = totalPopulationInAccessView
    ? (accessTotal / totalPopulationInAccessView) * 100
    : 0;

  const StatCardSkeleton = () => (
    <div className="border border-gray-100 rounded p-6 shadow-md bg-white animate-pulse">
      <div className="h-4 w-32 bg-gray-200 rounded mb-4"></div>
      <div className="h-8 w-24 bg-gray-200 rounded"></div>
    </div>
  );

  return (
    <div ref={contentRef} className="min-h-screen bg-white text-black font-sans pb-10">
      {/* Header Area */}
      <div className="flex items-center gap-4 px-8 py-8 border-b border-gray-200">
        <Activity className="h-8 w-8 text-black" />
        <h1 className="text-[28px] font-extrabold tracking-tight">HEALTH</h1>
      </div>

      <div className="px-8 mt-8">
        <p className="text-[14px] font-semibold text-gray-500 mb-6">
          {selectedDistrict ? `Health infrastructure for ${selectedDistrict}` : 'National Health Overview'}
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
              className="bg-black text-white rounded px-6 py-2 text-[14px] font-bold appearance-none min-w-[160px] cursor-pointer"
              value={selectedDistrict}
              onChange={(e) => setSelectedDistrict(e.target.value)}
            >
              <option value="">All Districts</option>
              {districts.options?.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {healthSummary.loading ? (
             [...Array(3)].map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            [
              { label: 'Facilities', value: formatStat(findMetricTotal('health_facility_count')), icon: HeartPulse },
              { label: 'Total Beds', value: formatStat(findMetricTotal('beds_count_total')), icon: Bed },
              { label: 'Patient Visits', value: formatStat(findMetricTotal('patient_visits_total')), icon: Users },
            ].map((stat, i) => (
              <div key={i} className="border border-gray-100 rounded p-6 shadow-md bg-white group hover:shadow-lg transition-all active:scale-95">
                <div className="flex justify-between items-start">
                   <span className="text-[14px] text-gray-500 font-bold group-hover:text-black">{stat.label}</span>
                   <stat.icon className="h-5 w-5 text-gray-300 group-hover:text-black" />
                </div>
                <div className="mt-4 text-[32px] font-extrabold tracking-tight">
                  {stat.value}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Map + Chart Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white h-[600px] flex flex-col">
            <h3 className="text-[16px] font-extrabold mb-6">Health Services Map</h3>
            <div className="flex-1 rounded overflow-hidden relative border border-gray-50 bg-gray-50">
               {healthLocations.loading ? (
                  <div className="absolute inset-0 flex items-center justify-center animate-pulse">
                    <span className="text-gray-400 font-bold uppercase tracking-widest">Loading Facilities...</span>
                  </div>
               ) : (
                  <MapPanel
                    geojson={healthLocations.data}
                    pointColor="#c56a3d"
                    popupFields={[
                      { key: 'type', label: 'Type' },
                      { key: 'beds_count', label: 'Beds' },
                      { key: 'patient_visits_total', label: 'Patient Visits' },
                    ]}
                    tooltipFields={[
                      { key: 'type', label: 'Type' },
                      { key: 'beds_count', label: 'Beds' },
                      { key: 'patient_visits_total', label: 'Patient Visits' },
                    ]}
                    showLegend={false}
                    showLabels={false}
                    heightClass="h-full w-full"
                  />
               )}
            </div>
          </div>

          <div className="h-[600px] flex flex-col gap-6">
            <div className="border border-gray-100 rounded p-6 shadow-sm bg-white h-[260px]">
              <h3 className="text-[16px] font-extrabold mb-4">Health Facilities by District</h3>
              <div className="h-[180px]">
                {districtHealthSummary.loading ? (
                  <div className="h-full w-full animate-pulse rounded bg-gray-50" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={facilityChartData}
                      margin={{ top: 8, right: 16, left: 8, bottom: 44 }}
                    >
                      <CartesianGrid
                        stroke="#f1f5f9"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="district"
                        axisLine={false}
                        tick={{ fill: '#64748b', fontSize: 9, fontWeight: 700 }}
                        tickFormatter={formatDistrictAxisLabel}
                        tickLine={false}
                        angle={-35}
                        textAnchor="end"
                        interval={0}
                        height={52}
                      />
                      <YAxis
                        axisLine={false}
                        tick={{ fill: '#64748b', fontSize: 11, fontWeight: 700 }}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(value) => Number(value).toLocaleString()}
                        labelFormatter={(label) => label}
                        contentStyle={{
                          borderRadius: '4px',
                          border: 'none',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                          fontSize: '12px',
                        }}
                        cursor={{ fill: '#f8fafc' }}
                      />
                      <Bar
                        dataKey="facilities"
                        radius={[2, 2, 0, 0]}
                        barSize={14}
                        activeBar={<Rectangle fill="#7e22ce" />}
                      >
                        {facilityChartData.map((entry) => (
                          <Cell
                            key={`health-facility-bar-${entry.district}`}
                            fill={getFacilityBarColor(entry.facilities, maxFacilities)}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="border border-gray-100 rounded p-6 shadow-sm bg-white flex-1 flex flex-col">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-[16px] font-extrabold">Population Access to Health Facilities</h3>
                  <p className="text-[13px] text-gray-500 font-semibold mt-1">
                    {selectedDistrict
                      ? `Estimated access split for ${selectedDistrict}`
                      : 'Estimated access split across all districts'}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-[30px] font-extrabold tracking-tight text-blue-600">
                    {accessShare.toFixed(1)}%
                  </div>
                  <div className="text-[12px] font-bold uppercase tracking-wide text-gray-400">
                    With access
                  </div>
                </div>
              </div>

              {servedPopulationSummary.loading ? (
                <div className="flex-1 animate-pulse rounded bg-gray-50" />
              ) : totalPopulationInAccessView === 0 ? (
                <div className="flex-1 flex items-center justify-center text-gray-400 font-semibold">
                  No served population data available
                </div>
              ) : (
                <div className="flex-1 min-w-0 flex flex-col xl:flex-row items-center xl:items-stretch gap-6">
                  <div className="h-[220px] w-full max-w-[240px] xl:w-[220px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={accessPieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={56}
                          outerRadius={84}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {accessPieData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value) => Number(value).toLocaleString()}
                          contentStyle={{
                            borderRadius: '4px',
                            border: 'none',
                            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                            fontSize: '12px',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="w-full min-w-0 flex-1 flex flex-col gap-4">
                    {accessPieData.map((entry) => {
                      const share = totalPopulationInAccessView
                        ? (entry.value / totalPopulationInAccessView) * 100
                        : 0;

                      return (
                        <div key={entry.name} className="min-w-0 border border-gray-100 rounded px-4 py-3">
                          <div className="flex items-center gap-3 mb-2">
                            <div
                              className="w-3.5 h-3.5 rounded-full"
                              style={{ backgroundColor: entry.color }}
                            />
                            <span className="text-[14px] font-bold text-gray-700">{entry.name}</span>
                          </div>
                          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 sm:gap-3 min-w-0">
                            <span className="min-w-0 break-words text-[22px] font-extrabold tracking-tight text-black">
                              {formatStat(entry.value)}
                            </span>
                            <span className="shrink-0 text-[18px] font-black" style={{ color: entry.color }}>
                              {share.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default HealthPage;
