import { useDistrict } from "../context/DistrictContext";
import { useDistrictOptions } from "../hooks/useDistrictOptions";

function SharedDistrictSelector() {
  const { selectedDistrict, setSelectedDistrict } = useDistrict();
  const districts = useDistrictOptions();

  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gray-400">
        District Filter
      </span>
      <div className="relative">
        <select
          className="min-w-[220px] cursor-pointer appearance-none rounded bg-black px-6 py-2 text-[14px] font-bold text-white"
          value={selectedDistrict}
          onChange={(event) => setSelectedDistrict(event.target.value)}
        >
          <option value="">All Districts</option>
          {districts.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default SharedDistrictSelector;
