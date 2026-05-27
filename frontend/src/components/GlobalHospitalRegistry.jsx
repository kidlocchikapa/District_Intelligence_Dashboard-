import React, { useMemo, useState } from "react";
import {
  Search,
  AlertCircle,
  Building2,
  MapPin,
  BedSingle,
  Users2,
  X,
  Stethoscope,
} from "lucide-react";
import { classifyFacilityProperties } from "../lib/facilityClassification";

function normalizeKeyPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "");
}

function buildStableFacilityId(feature, index) {
  const properties = feature?.properties || {};
  const sourceId = feature?.id ?? properties.id ?? properties.facility_id;
  if (sourceId !== undefined && sourceId !== null && sourceId !== "") {
    return `facility-${sourceId}`;
  }

  const name = normalizeKeyPart(
    properties?.name || properties?.name_en || "unnamed-facility",
  );
  const district = normalizeKeyPart(
    properties?.district_name ||
      properties?.district ||
      properties?.admin_unit_name ||
      "unknown-district",
  );
  const ward = normalizeKeyPart(properties?.ward || properties?.ward_name || "no-ward");
  const coords = Array.isArray(feature?.geometry?.coordinates)
    ? feature.geometry.coordinates.join("_")
    : `idx-${index}`;

  return `facility-${name}-${district}-${ward}-${coords}`;
}

function GlobalHospitalRegistry({ data, loading }) {
  const [registryScope, setRegistryScope] = useState("providers");
  const [searchTerm, setSearchTerm] = useState("");
  const [districtFilter, setDistrictFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [wardFilter, setWardFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all, underserved, high_demand

  function handleScopeChange(nextScope) {
    setRegistryScope(nextScope);
    setTypeFilter("");
    setWardFilter("");
  }

  const facilities = useMemo(() => {
    if (!data?.features) return [];

    return data.features.map((feature, index) => {
      const properties = feature?.properties || {};
      const classification = classifyFacilityProperties(properties);
      const rawName = properties?.name || properties?.name_en || "Unnamed Facility";

      return {
        id: buildStableFacilityId(feature, index),
        name: rawName,
        district:
          properties?.district_name ||
          properties?.district ||
          properties?.admin_unit_name ||
          "Unknown District",
        ward: properties?.ward || properties?.ward_name || "N/A",
        type: classification.rawType,
        normalizedType: classification.label,
        typeCategory: classification.category,
        isHospital: classification.isHospital,
        beds: Number(properties?.beds_count || 0),
        visits: Number(properties?.patient_visits_total || 0),
      };
    });
  }, [data]);

  const hospitalCount = useMemo(
    () => facilities.filter((facility) => facility.isHospital).length,
    [facilities],
  );

  const districtCount = useMemo(
    () => new Set(facilities.map((facility) => facility.district)).size,
    [facilities],
  );

  const scopedFacilities = useMemo(() => {
    if (registryScope === "hospitals") {
      return facilities.filter((facility) => facility.isHospital);
    }
    return facilities;
  }, [facilities, registryScope]);

  const districtOptions = useMemo(
    () => [...new Set(scopedFacilities.map((facility) => facility.district))].sort(),
    [scopedFacilities],
  );

  const typeOptions = useMemo(
    () => [...new Set(scopedFacilities.map((facility) => facility.type))].sort(),
    [scopedFacilities],
  );

  const wardOptions = useMemo(
    () =>
      [...new Set(scopedFacilities.map((facility) => facility.ward))]
        .filter((ward) => ward && ward !== "N/A")
        .sort(),
    [scopedFacilities],
  );

  const filteredFacilities = useMemo(() => {
    return scopedFacilities.filter((facility) => {
      const matchesSearch = facility.name
        .toLowerCase()
        .includes(searchTerm.toLowerCase());
      const matchesDistrict = !districtFilter || facility.district === districtFilter;
      const matchesType = !typeFilter || facility.type === typeFilter;
      const matchesWard = !wardFilter || facility.ward === wardFilter;

      let matchesStatus = true;
      if (statusFilter === "underserved") {
        matchesStatus = facility.beds < 20;
      } else if (statusFilter === "high_demand") {
        matchesStatus = facility.visits > 20000;
      }

      return (
        matchesSearch &&
        matchesDistrict &&
        matchesType &&
        matchesWard &&
        matchesStatus
      );
    });
  }, [
    scopedFacilities,
    searchTerm,
    districtFilter,
    typeFilter,
    wardFilter,
    statusFilter,
  ]);

  if (loading) {
    return (
      <div className="mt-10 rounded border border-gray-100 bg-white p-4 shadow-sm animate-pulse sm:p-6 lg:p-8">
        <div className="h-8 w-64 bg-gray-200 rounded mb-8" />
        <div className="mb-10 flex flex-col gap-4 sm:flex-row">
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
    <div className="group mt-10 rounded border border-gray-100 bg-white p-4 shadow-sm transition-all duration-300 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center md:gap-6">
        <div>
          <h3 className="text-[18px] font-extrabold tracking-tight text-black flex items-center gap-3">
            <Building2 className="h-5 w-5" />
            Global Health Registry
          </h3>
          <p className="text-[14px] font-semibold text-gray-500 mt-1">
            Hospitals are a subset of providers. Track service points across{" "}
            {districtCount} districts.
          </p>
        </div>
        <div className="text-left md:text-right">
          <p className="text-[11px] font-black uppercase tracking-wider text-gray-400">
            {filteredFacilities.length} Result
            {filteredFacilities.length !== 1 ? "s" : ""}
          </p>
          <p className="text-[11px] font-semibold text-gray-500 mt-1">
            {hospitalCount.toLocaleString()} hospitals of{" "}
            {facilities.length.toLocaleString()} total providers
          </p>
        </div>
      </div>

      <div className="mb-5 flex w-full overflow-x-auto rounded border border-gray-100 sm:inline-flex sm:w-auto">
        {[
          { id: "providers", label: "All Providers", icon: Stethoscope },
          { id: "hospitals", label: "Hospitals Only", icon: Building2 },
        ].map((scope) => {
          const isActive = registryScope === scope.id;
          const Icon = scope.icon;
          return (
            <button
              key={scope.id}
              type="button"
              onClick={() => handleScopeChange(scope.id)}
              className={`flex shrink-0 items-center gap-2 border-r border-gray-100 px-4 py-2 text-[11px] font-black uppercase tracking-wider transition-all last:border-r-0 ${
                isActive
                  ? "bg-black text-white"
                  : "bg-white text-gray-500 hover:bg-gray-50"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {scope.label}
            </button>
          );
        })}
      </div>

      <div className="mb-8 flex flex-col gap-4 xl:flex-row">
        <div className="relative flex-1 group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder={
              registryScope === "hospitals"
                ? "Search hospital name..."
                : "Search provider name..."
            }
            className="w-full pl-11 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded text-sm font-semibold text-black placeholder:text-gray-400 focus:bg-white focus:border-black transition-all outline-none"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-black"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-center">
          <div className="relative">
            <select
              className="w-full cursor-pointer appearance-none rounded bg-black px-5 py-2 text-[13px] font-bold text-white sm:min-w-[140px]"
              value={districtFilter}
              onChange={(event) => setDistrictFilter(event.target.value)}
            >
              <option value="">District</option>
              {districtOptions.map((district) => (
                <option key={district} value={district}>
                  {district}
                </option>
              ))}
            </select>
          </div>

          <div className="relative">
            <select
              className="w-full cursor-pointer appearance-none rounded bg-black px-5 py-2 text-[13px] font-bold text-white sm:min-w-[140px]"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
            >
              <option value="">Type</option>
              {typeOptions.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div className="relative">
            <select
              className="w-full cursor-pointer appearance-none rounded bg-black px-5 py-2 text-[13px] font-bold text-white sm:min-w-[140px]"
              value={wardFilter}
              onChange={(event) => setWardFilter(event.target.value)}
            >
              <option value="">Ward</option>
              {wardOptions.map((ward) => (
                <option key={ward} value={ward}>
                  {ward}
                </option>
              ))}
            </select>
          </div>

          <div className="flex overflow-x-auto rounded border border-gray-100 sm:col-span-2 xl:col-span-1">
            {[
              { id: "all", label: "All" },
              { id: "underserved", label: "Underserved" },
              { id: "high_demand", label: "High Demand" },
            ].map((status) => (
              <button
                key={status.id}
                onClick={() => setStatusFilter(status.id)}
                className={`shrink-0 border-r border-gray-100 px-4 py-2.5 text-[11px] font-black uppercase tracking-wider transition-all last:border-r-0 ${
                  statusFilter === status.id
                    ? "bg-black text-white"
                    : "bg-white text-gray-500 hover:bg-gray-50"
                }`}
              >
                {status.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex max-h-[520px] flex-col overflow-hidden rounded border border-gray-100 bg-white sm:max-h-[600px]">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="min-w-[780px] w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-6 py-4 text-[12px] font-bold text-gray-500 text-left">
                  {registryScope === "hospitals" ? "Hospital Name" : "Facility Name"}
                </th>
                <th className="px-6 py-4 text-[12px] font-bold text-gray-500 text-left">
                  District
                </th>
                <th className="px-6 py-4 text-[12px] font-bold text-gray-500 text-left">
                  Type
                </th>
                <th className="px-6 py-4 text-[12px] font-bold text-gray-500 text-left">
                  Capacity
                </th>
                <th className="px-6 py-4 text-[12px] font-bold text-gray-500 text-left">
                  Demand
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredFacilities.length > 0 ? (
                filteredFacilities.map((facility) => (
                  <tr key={facility.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-5">
                      <p className="text-sm font-bold text-black">{facility.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 text-gray-400">
                        <MapPin className="h-3 w-3" />
                        <span className="text-[10px] font-semibold uppercase tracking-wide">
                          Ward: {facility.ward}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-[12px] font-semibold text-gray-600">
                      {facility.district}
                    </td>
                    <td className="px-6 py-5">
                      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
                        {facility.type}
                      </p>
                      {facility.normalizedType !== facility.type ? (
                        <p className="text-[10px] font-semibold text-gray-500 mt-1">
                          Classified as {facility.normalizedType}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2">
                        <BedSingle
                          className={`h-4 w-4 ${
                            facility.beds < 20 ? "text-red-500" : "text-gray-300"
                          }`}
                        />
                        <div>
                          <p className="text-sm font-bold text-black leading-none">
                            {facility.beds}
                          </p>
                          <p className="text-[9px] font-bold text-gray-400 uppercase mt-0.5">
                            Beds
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2">
                        <Users2
                          className={`h-4 w-4 ${
                            facility.visits > 20000 ? "text-black" : "text-gray-300"
                          }`}
                        />
                        <div>
                          <p className="text-sm font-bold text-black leading-none">
                            {facility.visits.toLocaleString()}
                          </p>
                          <p className="text-[9px] font-bold text-gray-400 uppercase mt-0.5">
                            Visits
                          </p>
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
                      <p className="text-sm font-bold text-gray-300 uppercase tracking-widest">
                        No results matched
                      </p>
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
