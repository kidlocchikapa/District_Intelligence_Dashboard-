import { useDistrict } from "../context/DistrictContext";
import { useDistrictOptions } from "../hooks/useDistrictOptions";

function SharedDistrictSelector() {
  const { selectedDistrict, setSelectedDistrict, selectedTa, setSelectedTa } =
    useDistrict();
  const districts = useDistrictOptions();

  return (
    <div className="flex items-center gap-3">
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
      {selectedTa ? (
        <button
          type="button"
          onClick={() => setSelectedTa("")}
          className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] font-bold text-gray-700 transition-all hover:bg-white"
        >
          Clear: {selectedTa}
        </button>
      ) : null}
    </div>
  );
}

export default SharedDistrictSelector;
