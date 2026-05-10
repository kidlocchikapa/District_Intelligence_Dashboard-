import React, { useState, useEffect } from "react";

const TAAnalyticsTable = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch("/api/v1/dashboard/health/analytics/ta");
        const json = await response.json();
        if (json.status === "success") {
          setData(json.data);
        }
      } catch (error) {
        console.error("Error fetching TA analytics:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return <div className="h-64 flex items-center justify-center text-gray-500">Loading TA Analytics...</div>;
  }

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm text-left text-gray-500">
        <thead className="text-xs text-gray-700 uppercase bg-gray-50">
          <tr>
            <th scope="col" className="px-6 py-4 font-bold text-gray-900">Traditional Authority</th>
            <th scope="col" className="px-6 py-4 font-bold text-gray-900">Vulnerability Score</th>
            <th scope="col" className="px-6 py-4 font-bold text-gray-900">Welfare Beneficiaries</th>
            <th scope="col" className="px-6 py-4 font-bold text-gray-900">Flood Isolation Risk</th>
            <th scope="col" className="px-6 py-4 font-bold text-gray-900">Students far from Clinics</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr key={index} className="bg-white border-b hover:bg-gray-50">
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
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default TAAnalyticsTable;
