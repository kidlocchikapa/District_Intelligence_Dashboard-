import { ChevronDown } from "lucide-react";
import { useDistrict } from "../context/DistrictContext";

const DISTRICT_OPTIONS = [{ label: "Zomba", value: "Zomba" }];

function SharedDistrictSelector() {
  const { selectedDistrict, setSelectedDistrict, selectedTa, setSelectedTa } =
    useDistrict();

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
      <div className="relative">
        <label htmlFor="shared-district-selector" className="sr-only">
          Select district
        </label>
        <select
          id="shared-district-selector"
          aria-label="Select district"
          className="w-full cursor-pointer appearance-none rounded border border-black bg-black py-2 pl-4 pr-10 text-[14px] font-bold text-white shadow-sm transition-all hover:bg-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/30 sm:min-w-[220px]"
          value={selectedDistrict}
          onChange={(event) => setSelectedDistrict(event.target.value)}
        >
          <option value="" disabled>
            Select district
          </option>
          {DISTRICT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/90"
          aria-hidden="true"
        />
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
