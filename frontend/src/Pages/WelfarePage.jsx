import { UserCheck, Heart, PieChart as PieChartIcon, ClipboardList, Download } from 'lucide-react';
import { useDashboardData } from '../hooks/useDashboardData';
import { useDistrict } from '../context/DistrictContext';
import { useDistrictOptions } from '../hooks/useDistrictOptions';
import { usePdfExport } from '../hooks/usePdfExport';
import { buildDashboardPath } from '../lib/query';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

const COLORS = ['#4A72E4', '#F4B41A', '#3BB182', '#6974D6'];

function WelfarePage() {
  const { selectedDistrict, setSelectedDistrict } = useDistrict();
  const { contentRef, exportPdf } = usePdfExport('Welfare_Report.pdf');
  const districts = useDistrictOptions();
  
  // Reuse the distribution data from dashboard highlights
  const welfareData = useDashboardData(buildDashboardPath('/dashboard/welfare-distribution', { 
    district: selectedDistrict 
  }));

  const pieData = welfareData.data || [];
  const totalBeneficiaries = pieData.reduce((acc, curr) => acc + curr.value, 0);

  const formatStat = (val) => Number(val).toLocaleString();

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
        <UserCheck className="h-8 w-8 text-black" />
        <h1 className="text-[28px] font-extrabold tracking-tight">SOCIAL WELFARE</h1>
      </div>

      <div className="px-8 mt-8">
        <p className="text-[14px] font-semibold text-gray-500 mb-6">
          {selectedDistrict ? `Welfare program reach for ${selectedDistrict}` : 'National Welfare Overview'}
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          {welfareData.loading ? (
             [...Array(2)].map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            [
              { label: 'Total Beneficiaries', value: formatStat(totalBeneficiaries), icon: Heart },
              { label: 'Active Programs', value: pieData.length, icon: ClipboardList },
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

        {/* Chart Section */}
        <div className="border border-gray-100 rounded p-10 shadow-sm bg-white">
          <h3 className="text-[16px] font-extrabold mb-10">Program Participation Breakdown</h3>
          <div className="w-full flex flex-col md:flex-row items-center justify-start gap-16">
              <div className="h-[300px] w-full md:w-[400px]">
                {welfareData.loading ? (
                   <div className="h-full w-full bg-gray-50 rounded-full animate-pulse flex items-center justify-center">
                      <div className="w-2/3 h-2/3 bg-white rounded-full"></div>
                   </div>
                ) : pieData.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-400">No program data recorded</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={70}
                        outerRadius={90}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ borderRadius: '4px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            
            <div className="flex flex-col gap-6 flex-1">
              {pieData.map((entry, index) => (
                <div key={index} className="flex items-center gap-4 group">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                  <span className="text-[15px] text-gray-600 font-bold group-hover:text-black transition-colors">{entry.name}</span>
                  <div className="ml-auto flex items-center gap-4">
                     <span className="text-[16px] font-black text-black">{formatStat(entry.value)}</span>
                     <span className="text-[12px] text-gray-400 font-bold w-12 text-right">
                        {((entry.value / totalBeneficiaries) * 100).toFixed(1)}%
                     </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default WelfarePage;
