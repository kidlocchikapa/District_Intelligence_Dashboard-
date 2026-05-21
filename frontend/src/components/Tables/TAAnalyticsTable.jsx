import React, { useMemo, useState, useEffect } from "react";

const TAAnalyticsTable = ({
  data: providedData,
  loading: providedLoading,
  selectedTa = "",
  onSelectTa,
  maxBodyHeightClass = "max-h-[420px]",
}) => {
  const [fetchedData, setFetchedData] = useState([]);
  const [fetchLoading, setFetchLoading] = useState(true);
  const hasProvidedData = Array.isArray(providedData);
  const data = hasProvidedData ? providedData : fetchedData;
  const loading =
    typeof providedLoading === "boolean" ? providedLoading : fetchLoading;

  useEffect(() => {
    if (hasProvidedData) {
      setFetchLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        const response = await fetch("/api/v1/dashboard/health/analytics/ta");
        const json = await response.json();
        if (json.status === "success") {
          setFetchedData(json.data);
        }
      } catch (error) {
        console.error("Error fetching TA analytics:", error);
      } finally {
        setFetchLoading(false);
      }
    };
    fetchData();
  }, [hasProvidedData]);

  const visibleData = useMemo(() => {
    if (!selectedTa) {
      return data;
    }

    return data.filter(
      (row) =>
        String(row.admin_unit_name || "").toLowerCase() ===
        selectedTa.toLowerCase(),
    );
  }, [data, selectedTa]);

  if (loading) {
    return (
      <div className="h-[420px] flex items-center justify-center text-gray-500">
        Loading TA Analytics...
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden rounded-lg border border-gray-200">
      <div className="overflow-x-auto">
        <div className={`overflow-y-auto ${maxBodyHeightClass}`}>
          <table className="w-full min-w-[760px] text-sm text-left text-gray-500">
            <thead className="sticky top-0 z-10 text-xs text-gray-700 uppercase bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-4 font-bold text-gray-900">Traditional Authority</th>
                <th scope="col" className="px-6 py-4 font-bold text-gray-900">Vulnerability Score</th>
                <th scope="col" className="px-6 py-4 font-bold text-gray-900">Welfare Beneficiaries</th>
                <th scope="col" className="px-6 py-4 font-bold text-gray-900">Flood Isolation Risk</th>
                <th scope="col" className="px-6 py-4 font-bold text-gray-900">Students far from Clinics</th>
              </tr>
            </thead>
            <tbody>
              {visibleData.map((row, index) => {
                const isSelected =
                  selectedTa &&
                  String(row.admin_unit_name || "").toLowerCase() ===
                    selectedTa.toLowerCase();

                return (
                <tr
                  key={row.admin_unit_name || index}
                  onClick={() => onSelectTa?.(row.admin_unit_name || "")}
                  className={`border-b transition-colors ${
                    onSelectTa ? "cursor-pointer" : ""
                  } ${
                    isSelected
                      ? "bg-purple-50 hover:bg-purple-50"
                      : "bg-white hover:bg-gray-50"
                  }`}
                >
                  <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">
                    {row.admin_unit_name}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                      Number(row.vulnerability_score) > 60 ? "bg-red-100 text-red-800" : 
                      Number(row.vulnerability_score) > 30 ? "bg-yellow-100 text-yellow-800" : 
                      "bg-green-100 text-green-800"
                    }`}>
                      {Number(row.vulnerability_score || 0).toFixed(1)} / 100
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {Number(row.beneficiary_count || 0).toLocaleString()}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-full bg-gray-200 rounded-full h-2.5 max-w-[80px]">
                        <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${Math.min(100, Number(row.flood_isolation_risk || 0))}%` }}></div>
                      </div>
                      <span>{Number(row.flood_isolation_risk || 0).toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-green-700 font-medium">
                    {Number(row.student_enrolment_affected || 0).toLocaleString()}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {!loading && !visibleData.length ? (
        <div className="px-6 py-8 text-center text-sm font-semibold text-gray-500">
          No TA analytics are available for {selectedTa || "this view"}.
        </div>
      ) : (
        <div className="border-t border-gray-100 bg-gray-50/70 px-4 py-2 text-[11px] font-semibold text-gray-500">
          Showing {visibleData.length} TA rows. Scroll inside this table to view more.
        </div>
      )}
    </div>
  );
};

export default TAAnalyticsTable;
