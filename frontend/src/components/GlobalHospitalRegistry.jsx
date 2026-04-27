import React, { useMemo, useState } from 'react';
import { Search, Filter, AlertCircle, Building2, MapPin, BedSingle, Users2, X } from 'lucide-react';

/**
 * GlobalHospitalRegistry - A comprehensive, filterable list of all hospitals.
 * Only shown when in "All Districts" mode.
 */
function GlobalHospitalRegistry({ data, loading }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [districtFilter, setDistrictFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [wardFilter, setWardFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, underserved, high_demand

  // 1. Extract and normalize hospital features
  const hospitals = useMemo(() => {
    if (!data?.features) return [];
    return data.features
      .filter(f => {
        const type = (f.properties?.type || '').toLowerCase();
        return type.includes('hospital');
      })
      .map(f => ({
        id: f.id || Math.random().toString(36).substr(2, 9),
        name: f.properties?.name || f.properties?.name_en || 'Unnamed Hospital',
        district: f.properties?.district_name || f.properties?.district || f.properties?.admin_unit_name || 'Unknown District',
        ward: f.properties?.ward || f.properties?.ward_name || 'N/A',
        type: f.properties?.type || 'Hospital',
        beds: Number(f.properties?.beds_count || 0),
        visits: Number(f.properties?.patient_visits_total || 0),
      }));
  }, [data]);

  // 2. Get unique filter options
  const districtOptions = useMemo(() => 
    [...new Set(hospitals.map(h => h.district))].sort(), 
    [hospitals]
  );
  
  const typeOptions = useMemo(() => 
    [...new Set(hospitals.map(h => h.type))].sort(), 
    [hospitals]
  );

  const wardOptions = useMemo(() => 
    [...new Set(hospitals.map(h => h.ward))].filter(w => w && w !== 'N/A').sort(), 
    [hospitals]
  );

  // 3. Apply search and filters
  const filteredHospitals = useMemo(() => {
    return hospitals.filter(h => {
      const matchesSearch = h.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesDistrict = !districtFilter || h.district === districtFilter;
      const matchesType = !typeFilter || h.type === typeFilter;
      const matchesWard = !wardFilter || h.ward === wardFilter;
      
      let matchesStatus = true;
      if (statusFilter === 'underserved') {
        matchesStatus = h.beds < 20;
      } else if (statusFilter === 'high_demand') {
        matchesStatus = h.visits > 20000;
      }

      return matchesSearch && matchesDistrict && matchesType && matchesWard && matchesStatus;
    });
  }, [hospitals, searchTerm, districtFilter, typeFilter, wardFilter, statusFilter]);

  if (loading) {
    return (
      <div className="mt-10 border border-gray-100 rounded p-8 shadow-sm bg-white animate-pulse">
        <div className="h-8 w-64 bg-gray-200 rounded mb-8" />
        <div className="flex gap-4 mb-10">
          <div className="h-10 w-full max-w-sm bg-gray-100 rounded" />
          <div className="h-10 w-40 bg-gray-100 rounded" />
          <div className="h-10 w-40 bg-gray-100 rounded" />
        </div>
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 w-full bg-gray-50 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-10 border border-gray-100 rounded p-8 shadow-sm bg-white group transition-all duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
          <h3 className="text-[18px] font-extrabold tracking-tight text-black flex items-center gap-3">
            <Building2 className="h-5 w-5" />
            Global Hospital Registry
          </h3>
          <p className="text-[14px] font-semibold text-gray-500 mt-1">
            Search and evaluate health infrastructure across {districtOptions.length} districts
          </p>
        </div>
        <div className="flex items-center gap-2">
            <span className="text-[11px] font-black uppercase tracking-wider text-gray-400">
               {filteredHospitals.length} Result{filteredHospitals.length !== 1 ? 's' : ''}
            </span>
        </div>
      </div>

      {/* Filters Row */}
      <div className="flex flex-col xl:flex-row gap-4 mb-8">
        {/* Search */}
        <div className="relative flex-1 group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input 
            type="text"
            placeholder="Search hospital name..."
            className="w-full pl-11 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded text-sm font-semibold text-black placeholder:text-gray-400 focus:bg-white focus:border-black transition-all outline-none"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button 
              onClick={() => setSearchTerm('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-black"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Dropdowns */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <select
              className="bg-black text-white rounded px-5 py-2 text-[13px] font-bold appearance-none cursor-pointer min-w-[140px]"
              value={districtFilter}
              onChange={(e) => setDistrictFilter(e.target.value)}
            >
              <option value="">District</option>
              {districtOptions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div className="relative">
             <select
              className="bg-black text-white rounded px-5 py-2 text-[13px] font-bold appearance-none cursor-pointer min-w-[140px]"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="">Type</option>
              {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="relative">
             <select
              className="bg-black text-white rounded px-5 py-2 text-[13px] font-bold appearance-none cursor-pointer min-w-[140px]"
              value={wardFilter}
              onChange={(e) => setWardFilter(e.target.value)}
            >
              <option value="">Ward</option>
              {wardOptions.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>

          {/* Status Rectangular Tabs */}
          <div className="flex border border-gray-100 rounded overflow-hidden">
             {[
               { id: 'all', label: 'All' },
               { id: 'underserved', label: 'Underserved' },
               { id: 'high_demand', label: 'High Demand' }
             ].map(s => (
               <button
                 key={s.id}
                 onClick={() => setStatusFilter(s.id)}
                 className={`px-4 py-2.5 text-[11px] font-black uppercase tracking-wider transition-all border-r border-gray-100 last:border-r-0 ${
                   statusFilter === s.id 
                    ? 'bg-black text-white' 
                    : 'bg-white text-gray-500 hover:bg-gray-50'
                 }`}
               >
                 {s.label}
               </button>
             ))}
          </div>
        </div>
      </div>

      {/* Results Table */}
      <div className="overflow-hidden border border-gray-100 rounded bg-white flex flex-col max-h-[600px]">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-6 py-4 text-[12px] font-bold text-gray-500 text-left">Hospital Name</th>
                <th className="px-6 py-4 text-[12px] font-bold text-gray-500 text-left">District</th>
                <th className="px-6 py-4 text-[12px] font-bold text-gray-500 text-left">Type</th>
                <th className="px-6 py-4 text-[12px] font-bold text-gray-500 text-left">Capacity</th>
                <th className="px-6 py-4 text-[12px] font-bold text-gray-500 text-left">Demand</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredHospitals.length > 0 ? (
                filteredHospitals.map(h => (
                  <tr key={h.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-5">
                      <p className="text-sm font-bold text-black">{h.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 text-gray-400">
                        <MapPin className="h-3 w-3" />
                        <span className="text-[10px] font-semibold uppercase tracking-wide">Ward: {h.ward}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-[12px] font-semibold text-gray-600">
                      {h.district}
                    </td>
                    <td className="px-6 py-5 text-[11px] font-bold text-gray-400 uppercase tracking-widest">
                      {h.type}
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2">
                         <BedSingle className={`h-4 w-4 ${h.beds < 20 ? 'text-red-500' : 'text-gray-300'}`} />
                         <div>
                            <p className="text-sm font-bold text-black leading-none">{h.beds}</p>
                            <p className="text-[9px] font-bold text-gray-400 uppercase mt-0.5">Beds</p>
                         </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2">
                         <Users2 className={`h-4 w-4 ${h.visits > 20000 ? 'text-black' : 'text-gray-300'}`} />
                         <div>
                            <p className="text-sm font-bold text-black leading-none">{h.visits.toLocaleString()}</p>
                            <p className="text-[9px] font-bold text-gray-400 uppercase mt-0.5">Visits</p>
                         </div>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                       <AlertCircle className="h-8 w-8 text-gray-200" />
                       <p className="text-sm font-bold text-gray-300 uppercase tracking-widest">No results matched</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default GlobalHospitalRegistry;
