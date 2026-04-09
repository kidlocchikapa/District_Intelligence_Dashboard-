import { ShieldAlert, Zap, Thermometer, Map as MapIcon, Download } from 'lucide-react';
import { useDashboardData } from '../hooks/useDashboardData';
import { useDistrict } from '../context/DistrictContext';
import { useDistrictOptions } from '../hooks/useDistrictOptions';
import { usePdfExport } from '../hooks/usePdfExport';
import { buildDashboardPath } from '../lib/query';
import MapPanel from '../components/MapPanel';

function DisasterPage() {
  const { selectedDistrict, setSelectedDistrict } = useDistrict();
  const { contentRef, exportPdf } = usePdfExport('DisasterRisk_Report.pdf');  
  const districts = useDistrictOptions();
  
  // Summary Aggregates
  const disasterSummary = useDashboardData(buildDashboardPath('/dashboard/disaster/summary', { 
    district: selectedDistrict,
    admin_type: 'District'
  }));

  // Disaster Zone GeoJSON for Map
  const disasterZones = useDashboardData(buildDashboardPath('/dashboard/disaster', { 
    district: selectedDistrict 
  }));

  const findMetric = (name) => {
    return disasterSummary.data?.find(m => m.metric_name === name)?.metric_value || 0;
  };

  const formatStat = (val, isPct = true) => {
    const num = Number(val);
    return isPct ? `${num.toFixed(1)}%` : num.toFixed(1);
  };

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
        <ShieldAlert className="h-8 w-8 text-black" />
        <h1 className="text-[28px] font-extrabold tracking-tight">DISASTER RISK</h1>
      </div>

      <div className="px-8 mt-8">
        <p className="text-[14px] font-semibold text-gray-500 mb-6">
          {selectedDistrict ? `Risk analysis for ${selectedDistrict}` : 'National Vulnerability Overview'}
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
          {disasterSummary.loading ? (
             [...Array(3)].map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            [
              { label: 'Vulnerability Score', value: formatStat(findMetric('disaster_vulnerability_score'), false), icon: Zap },
              { label: 'Risk Intensity', value: formatStat(findMetric('disaster_risk_intensity_pct')), icon: Thermometer },
              { label: 'Affected Area', value: formatStat(findMetric('disaster_affected_area_pct')), icon: MapIcon },
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

        {/* Map Section */}
        <div className="border border-gray-100 rounded p-8 shadow-sm bg-white h-[600px] flex flex-col">
          <h3 className="text-[16px] font-extrabold mb-6">Hazard Zone Mapping</h3>
          <div className="flex-1 rounded overflow-hidden relative border border-gray-50 bg-gray-50">
             {disasterZones.loading ? (
                <div className="absolute inset-0 flex items-center justify-center animate-pulse">
                  <span className="text-gray-400 font-bold uppercase tracking-widest">Loading Risk Data...</span>
                </div>
             ) : (
                <MapPanel
                  geojson={disasterZones.data}
                  metricName="disaster"
                  palette="heat" 
                  showLegend={false}
                  showLabels={true}
                  heightClass="h-full w-full"
                />
             )}
          </div>
        </div>

      </div>
    </div>
  );
}

export default DisasterPage;
