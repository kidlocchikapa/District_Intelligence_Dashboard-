import { useDistrict } from "../context/DistrictContext";
import { useDistrictOptions } from "../hooks/useDistrictOptions";

function SharedDistrictSelector() {
  const { selectedDistrict, setSelectedDistrict, selectedTa, setSelectedTa } =
    useDistrict();
  const districts = useDistrictOptions();

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
      <div className="relative">
        <select
          className="w-full cursor-pointer appearance-none rounded bg-black px-6 py-2 text-[14px] font-bold text-white sm:min-w-[220px]"
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
          className="w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-left text-[12px] font-bold text-gray-700 transition-all hover:bg-white sm:w-auto sm:text-center"
        >
          Clear: {selectedTa}
        </button>
      ) : null}
    </div>
  );
}

export default SharedDistrictSelector;
