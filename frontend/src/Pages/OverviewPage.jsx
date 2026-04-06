import { useState } from 'react';
import { Menu, Download, Users, School, HeartPulse, Accessibility } from 'lucide-react';
import { useDashboardData } from '../hooks/useDashboardData';
import { useDistrictOptions } from '../hooks/useDistrictOptions';
import { useDistrict } from '../context/DistrictContext';
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
  const { selectedDistrict, setSelectedDistrict } = useDistrict();
  const districts = useDistrictOptions();
  const summary = useDashboardData(buildDashboardPath('/dashboard/summary', { district: selectedDistrict }));
  const densityMap = useDashboardData(buildDashboardPath('/dashboard/admin-units', { type: 'District', district: selectedDistrict }));
  const healthServed = useDashboardData(buildDashboardPath('/dashboard/health/served-population/geojson', { admin_type: 'District', district: selectedDistrict }));

  // Mocked population data based on your specific screenshot's 22M Total Population
  const chartData = [
    { name: 'zomba', Moderate: 52, High: 45, Low: 85 },
    { name: 'Lilongwe', Moderate: 85, High: 60, Low: 86 },
    { name: 'Blantyre', Moderate: 75, High: 53, Low: 44 },
    { name: 'salima', Moderate: 78, High: 42, Low: 38 },
    { name: 'Chilazulu', Moderate: 52, High: 95, Low: 88 },
    { name: 'Ntchisi', Moderate: 32, High: 15, Low: 68 },
    { name: 'Phalombe', Moderate: 22, High: 92, Low: 18 },
    { name: 'Mzuzu', Moderate: 44, High: 30, Low: 22 },
    { name: 'Mzimba', Moderate: 18, High: 95, Low: 85 },
    { name: 'Mulanje', Moderate: 80, High: 48, Low: 90 },
    { name: 'Kasungu', Moderate: 60, High: 82, Low: 40 },
    { name: 'Chitipa', Moderate: 88, High: 58, Low: 56 },
  ];

  const pieData = [
    { name: 'Social Cash Transfer(SCTP)', value: 5400, color: '#4A72E4' },
    { name: 'School meals Programme', value: 5645, color: '#F4B41A' },
    { name: 'Public Works Programme', value: 3121, color: '#3BB182' },
    { name: 'Village savings & Loans', value: 1200, color: '#6974D6' }
  ];

  const formatStat = (val) => {
    if (!val) return '0';
    return Number(val).toLocaleString();
  };

  return (
    <div className="min-h-screen bg-white text-black font-sans pb-10">
      {/* Header Area */}
      <div className="flex items-center gap-4 px-8 py-8 border-b border-gray-200">
        <h1 className="text-[28px] font-extrabold tracking-tight">OVERVIEW</h1>
      </div>

      <div className="px-8 mt-8">
        <p className="text-[14px] font-semibold text-gray-500 mb-6">Showing All districts Records</p>
        
        {/* Actions Row */}
        <div className="flex gap-4 mb-8">
          <button className="flex items-center gap-2 border border-gray-300 rounded px-3 py-1.5 text-[13px] font-bold hover:bg-gray-50 transition-all shadow-sm active:scale-95">
            <Download className="h-4 w-4" />
            Download CSV
          </button>
          
          <div className="relative">
            <select 
              className="bg-black text-white rounded px-6 py-2 text-[14px] font-bold appearance-none min-w-[160px] cursor-pointer hover:bg-black/90"
              value={selectedDistrict}
              onChange={(e) => setSelectedDistrict(e.target.value)}
            >
              <option value="">Select District</option>
              {districts.options?.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
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
          {[
            { label: 'Total Population', value: formatStat(summary.data?.total_estimated_population || 22000000), icon: Users },
            { label: 'Schools', value: formatStat(summary.data?.total_schools || 220000), icon: School },
            { label: 'Health Facilities', value: formatStat(summary.data?.total_health_facilities || 2000), icon: HeartPulse },
            { label: 'Welfare Beneficiaries', value: formatStat(summary.data?.total_welfare_beneficiaries || 2000000), icon: Accessibility },
          ].map((stat, i) => (
            <div key={i} className="border border-gray-100 rounded p-6 shadow-md bg-white relative hover:shadow-lg transition-shadow">
              <div className="flex justify-between items-start">
                 <span className="text-[14px] text-gray-500 font-bold">{stat.label}</span>
                 <stat.icon className="h-5 w-5 text-gray-300" />
              </div>
              <div className="mt-4 text-[32px] font-extrabold tracking-tight">
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Middle Row (Map + Bar Chart) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
          
          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white flex flex-col">
            <h3 className="text-[16px] font-extrabold mb-6">District Map Overview</h3>
            <div className="w-full flex-1 aspect-[4/3] rounded overflow-hidden relative border border-gray-50 shadow-inner">
               <MapPanel
                geojson={densityMap.data}
                metricName="population_density"
                palette="heat"
                showLegend={false}
                showLabels={true}
                heightClass="h-full w-full"
              />
            </div>
          </div>
          
          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white flex flex-col">
            <h3 className="text-[16px] font-extrabold mb-6">Population by district</h3>
            <div className="w-full flex-1 aspect-[4/3]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis 
                    dataKey="name" 
                    angle={-45} 
                    textAnchor="end" 
                    tick={{ fontSize: 11, fill: '#64748B', fontWeight: 600 }} 
                    axisLine={false} 
                    tickLine={false} 
                    interval={0}
                  />
                  <YAxis 
                    tick={{ fontSize: 12, fill: '#64748B', fontWeight: 600 }} 
                    axisLine={false} 
                    tickLine={false} 
                  />
                  <Tooltip cursor={{ fill: '#F1F5F9' }} />
                  <Legend 
                    verticalAlign="bottom" 
                    iconType="square" 
                    wrapperStyle={{ paddingTop: '20px' }} 
                  />
                  <Bar dataKey="Moderate" fill="#9BA4EE" radius={[4, 4, 0, 0]} maxBarSize={15} />
                  <Bar dataKey="High" fill="#FF8D85" radius={[4, 4, 0, 0]} maxBarSize={15} />
                  <Bar dataKey="Low" fill="#58C8D6" radius={[4, 4, 0, 0]} maxBarSize={15} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

        {/* Bottom Row (Pie Chart) */}
        <div className="border border-gray-100 rounded p-10 shadow-sm bg-white">
          <h3 className="text-[16px] font-extrabold mb-10">Social Welfare Program Distribution</h3>
          <div className="w-full flex flex-col md:flex-row items-center justify-start gap-16">
            <div className="h-[300px] w-full md:w-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    outerRadius={130}
                    innerRadius={0}
                    dataKey="value"
                    stroke="none"
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
            <div className="flex flex-col gap-6">
              {pieData.map((entry, index) => (
                <div key={index} className="flex items-center gap-4">
                  <div className="w-5 h-5 rounded-full" style={{ backgroundColor: entry.color }} />
                  <span className="text-[16px] text-gray-700 font-semibold">{entry.name} :</span>
                  <span className="text-[16px] font-extrabold text-black">{entry.value.toLocaleString()}</span>
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
