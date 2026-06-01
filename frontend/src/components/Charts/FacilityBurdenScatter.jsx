import React, { useState, useEffect } from "react";
import { fetchJson } from "../../lib/api";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ZAxis,
  Cell,
} from "recharts";

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white p-3 border border-gray-200 shadow-md rounded text-sm">
        <p className="font-bold text-gray-800 mb-1">{data.facility_name}</p>
        <p className="text-gray-600">
          Catchment (8km):{" "}
          <span className="font-semibold text-blue-600">
            {Number(data.catchment_population).toLocaleString()}
          </span>
        </p>
        <p className="text-gray-600">
          Staff Count: <span className="font-semibold">{data.staff_count}</span>
        </p>
        <p className="text-gray-600">
          Beds: <span className="font-semibold">{data.beds_count}</span>
        </p>
      </div>
    );
  }
  return null;
};

const FacilityBurdenScatter = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const rows = await fetchJson("/dashboard/health/analytics/facility");
        if (Array.isArray(rows)) {
          // Filter out facilities with no catchment data or zero staff to avoid skewing too much
          const validData = rows.filter(
            (d) => Number(d.catchment_population) > 0,
          );
          setData(validData);
        }
      } catch (error) {
        console.error("Error fetching facility analytics:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex h-[320px] items-center justify-center text-gray-500 sm:h-[400px]">
        Loading Facility Analytics...
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="flex h-[320px] items-center justify-center text-gray-500 sm:h-[400px]">
        No facility burden data available yet.
      </div>
    );
  }

  return (
    <div className="h-[320px] w-full sm:h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="#e5e7eb"
          />
          <XAxis
            type="number"
            dataKey="catchment_population"
            name="Catchment Pop"
            tickFormatter={(val) => `${val / 1000}k`}
            label={{
              value: "Catchment Population (8km)",
              position: "insideBottom",
              offset: -10,
              className: "text-xs fill-gray-500",
            }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="number"
            dataKey="staff_count"
            name="Staff Count"
            label={{
              value: "Total Staff (Docs + Nurses)",
              angle: -90,
              position: "insideLeft",
              className: "text-xs fill-gray-500",
            }}
            axisLine={false}
            tickLine={false}
          />
          <ZAxis
            type="number"
            dataKey="beds_count"
            range={[50, 400]}
            name="Beds"
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={<CustomTooltip />}
          />
          <Scatter name="Facilities" data={data}>
            {data.map((entry, index) => {
              // Highlight high burden: Pop > 20000 and Staff < 5
              const isHighBurden =
                Number(entry.catchment_population) > 20000 &&
                Number(entry.staff_count) < 5;
              return (
                <Cell
                  key={`cell-${index}`}
                  fill={isHighBurden ? "#ef4444" : "#3b82f6"}
                  opacity={0.7}
                />
              );
            })}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
};

export default FacilityBurdenScatter;
