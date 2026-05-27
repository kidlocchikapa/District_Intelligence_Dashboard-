import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useDistrict } from "../context/DistrictContext";

const DISTRICT_OPTIONS = [{ label: "Zomba", value: "Zomba" }];

function SharedDistrictSelector() {
  const { selectedDistrict, setSelectedDistrict, selectedTa, setSelectedTa } =
    useDistrict();
  const [isOpen, setIsOpen] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);

  function handleSelectDistrict(value) {
    setSelectedDistrict(value);
    setIsOpen(false);
    setIsSelecting(true);
    window.setTimeout(() => setIsSelecting(false), 360);
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
      <div className="relative">
        <span id="shared-district-selector-label" className="sr-only">
          Select district
        </span>
        <button
          id="shared-district-selector"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-labelledby="shared-district-selector-label shared-district-selector-value"
          onClick={() => setIsOpen((current) => !current)}
          className={`flex w-full cursor-pointer items-center justify-between rounded border border-black bg-black py-2 pl-4 pr-10 text-left text-[14px] font-bold text-white shadow-sm transition-all duration-300 hover:bg-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/30 sm:min-w-[220px] ${
            isSelecting ? "scale-[1.02] ring-4 ring-emerald-400/25" : ""
          }`}
        >
          <span id="shared-district-selector-value">
            {selectedDistrict || "Select district"}
          </span>
        </button>
        <ChevronDown
          className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/90 transition-transform duration-300 ${
            isOpen ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
        <div
          className={`absolute left-0 right-0 top-[calc(100%+0.45rem)] z-[70] origin-top overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl transition-all duration-200 ${
            isOpen
              ? "translate-y-0 scale-100 opacity-100"
              : "pointer-events-none -translate-y-2 scale-95 opacity-0"
          }`}
        >
          <div
            role="listbox"
            aria-labelledby="shared-district-selector-label"
            className="p-1"
          >
            <div className="px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
              Select district
            </div>
            {DISTRICT_OPTIONS.map((option) => {
              const isSelected = option.value === selectedDistrict;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelectDistrict(option.value)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold transition-all duration-200 ${
                    isSelected
                      ? "bg-black text-white"
                      : "text-gray-700 hover:bg-gray-100 hover:text-black"
                  }`}
                >
                  {option.label}
                  {isSelected ? <Check className="h-4 w-4" /> : null}
                </button>
              );
            })}
          </div>
        </div>
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
