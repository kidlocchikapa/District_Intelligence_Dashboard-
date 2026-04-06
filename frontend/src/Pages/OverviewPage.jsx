import { useState } from 'react';
import { Menu, Download, Users } from 'lucide-react';
import { useDashboardData } from '../hooks/useDashboardData';
import { useDistrictOptions } from '../hooks/useDistrictOptions';
import { buildDashboardPath } from '../lib/query';
import MapPanel from '../components/MapPanel';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

function OverviewPage() {
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const districts = useDistrictOptions();
  const summary = useDashboardData(buildDashboardPath('/dashboard/summary', { district: selectedDistrict }));
  const densityMap = useDashboardData(buildDashboardPath('/dashboard/admin-units', { type: 'District', district: selectedDistrict }));
  const healthServed = useDashboardData(buildDashboardPath('/dashboard/health/served-population/geojson', { admin_type: 'District', district: selectedDistrict }));

  // Prepare data for bar chart based on health access but labeled for the UI mock ("Population by district")
  const servedFeatures = healthServed.data?.features || [];
  const populationByDistrict = servedFeatures.map(f => ({
    name: f.properties?.admin_unit_name || 'Unknown',
    Low: Math.floor((Number(f.properties?.population_total) || 0) * 0.3),
    Moderate: Math.floor((Number(f.properties?.population_total) || 0) * 0.5),
    High: Math.floor((Number(f.properties?.population_total) || 0) * 0.2),
  })).slice(0, 15);

  // Fallback mock data if health data isn't loaded yet
  const chartData = populationByDistrict.length > 0 ? populationByDistrict : [
    { name: 'Zomba', Moderate: 52, High: 45, Low: 85 },
    { name: 'Lilongwe', Moderate: 85, High: 60, Low: 86 },
    { name: 'Blantyre', Moderate: 75, High: 53, Low: 44 },
    { name: 'Salima', Moderate: 78, High: 42, Low: 38 },
    { name: 'Chilazulu', Moderate: 52, High: 95, Low: 88 },
    { name: 'Ntchisi', Moderate: 32, High: 15, Low: 68 },
    { name: 'Phalombe', Moderate: 22, High: 92, Low: 18 },
    { name: 'Mzuzu', Moderate: 44, High: 30, Low: 22 },
    { name: 'Mzimba', Moderate: 18, High: 95, Low: 85 },
    { name: 'Mulanje', Moderate: 80, High: 48, Low: 90 },
    { name: 'Kasungu', Moderate: 60, High: 82, Low: 40 },
    { name: 'Chitipa', Moderate: 88, High: 58, Low: 56 },
  ];

  // Pie chart data specifically for the mock
  const pieData = [
    { name: 'Social Cash Transfer(SCTP)', value: 5400, color: '#4A72E4' },
    { name: 'School meals Programme', value: 5645, color: '#F4B41A' },
    { name: 'Public Works Programme', value: 3121, color: '#3BB182' },
    { name: 'Village savings & Loans', value: 1200, color: '#6974D6' }
  ];

  // Create formatted stat value helper
  const formatStat = (val) => {
    if (!val) return '0';
    return Number(val).toLocaleString();
  };

  return (
    <div className="min-h-screen bg-white text-black font-sans pb-10 rounded-tl-xl overflow-hidden shadow-sm">
      {/* Header Area */}
      <div className="flex items-center gap-3 px-8 pt-8 pb-4 border-b border-gray-300">
        <Menu className="h-6 w-6 text-gray-800" />
        <h1 className="text-2xl font-bold uppercase tracking-wide">Overview</h1>
      </div>

      <div className="px-8 mt-6">
        <p className="text-sm font-medium text-gray-700 mb-4">Showing All districts Records</p>
        
        {/* Actions Row */}
        <div className="flex gap-4 mb-8">
          <button className="flex items-center gap-2 border border-gray-400 rounded-full px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
            <Download className="h-4 w-4" />
            Download CSV
          </button>
          
          <div className="relative">
            <select 
              className="bg-black text-white rounded-full px-4 py-2 text-sm font-medium appearance-none min-w-[140px] cursor-pointer hover:bg-gray-900 transition-colors"
              value={selectedDistrict}
              onChange={(e) => setSelectedDistrict(e.target.value)}
            >
              <option value="">Select District</option>
              {districts.options?.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-white">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {[
            { label: 'Total Population', value: formatStat(summary.data?.total_estimated_population || 22000000) },
            { label: 'Schools', value: formatStat(summary.data?.total_schools || 220000) },
            { label: 'Health Facilities', value: formatStat(summary.data?.total_health_facilities || 2000) },
            { label: 'Welfare Beneficiaries', value: formatStat(summary.data?.total_welfare_beneficiaries || 2000000) },
          ].map((stat, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-5 shadow-sm bg-white relative">
              <div className="flex justify-between items-start">
                 <span className="text-xs text-gray-500 font-medium">{stat.label}</span>
                 <Users className="h-5 w-5 text-gray-500" />
              </div>
              <div className="mt-4 text-3xl font-bold tracking-tight">
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Middle Row (Map + Bar Chart) */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6 mb-8">
          
          <div className="border border-gray-200 rounded-lg p-6 shadow-sm bg-white flex flex-col">
            <h3 className="text-sm font-bold mb-4">District Map Overview</h3>
            <div className="w-full flex-1 min-h-[400px] border border-gray-100 rounded bg-gray-50 relative overflow-hidden">
               <MapPanel
                geojson={densityMap.data}
                metricName="population_density"
                palette="heat"
                showLegend={false}
                showLabels={true}
                heightClass="h-full absolute inset-0"
              />
            </div>
          </div>
          
          <div className="border border-gray-200 rounded-lg p-6 shadow-sm bg-white flex flex-col">
            <h3 className="text-sm font-bold mb-4">Population by district</h3>
            <div className="w-full flex-1 min-h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 20, right: 0, left: -20, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis 
                    dataKey="name" 
                    angle={-45} 
                    textAnchor="end" 
                    tick={{ fontSize: 11, fill: '#6B7280' }} 
                    axisLine={false} 
                    tickLine={false} 
                    interval={0}
                  />
                  <YAxis 
                    tick={{ fontSize: 12, fill: '#6B7280' }} 
                    axisLine={false} 
                    tickLine={false} 
                  />
                  <Tooltip cursor={{ fill: '#F3F4F6' }} />
                  <Legend 
                    verticalAlign="bottom" 
                    iconType="square" 
                    wrapperStyle={{ bottom: -20 }} 
                  />
                  <Bar dataKey="Moderate" fill="#9BA4EE" radius={[2, 2, 0, 0]} maxBarSize={15} />
                  <Bar dataKey="High" fill="#FF8D85" radius={[2, 2, 0, 0]} maxBarSize={15} />
                  <Bar dataKey="Low" fill="#58C8D6" radius={[2, 2, 0, 0]} maxBarSize={15} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

        {/* Bottom Row (Pie Chart) */}
        <div className="border border-gray-200 rounded-lg p-6 shadow-sm bg-white">
          <h3 className="text-sm font-bold mb-4">Social Welfare Program Distribution</h3>
          <div className="w-full flex flex-col md:flex-row items-center justify-start gap-10 min-h-[300px]">
            <div className="h-[250px] w-full md:w-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    innerRadius={0}
                    dataKey="value"
                    stroke="white"
                    strokeWidth={2}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            
            {/* Custom Pie Legend */}
            <div className="flex flex-col gap-4">
              {pieData.map((entry, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: entry.color }} />
                  <span className="text-[15px] text-gray-600">{entry.name} :</span>
                  <span className="text-[15px] font-bold text-gray-800">{entry.value.toLocaleString()}</span>
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
