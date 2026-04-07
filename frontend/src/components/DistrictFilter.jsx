function DistrictFilter({ value, onChange, options = [], disabled = false }) {
  return (
    <label className="min-w-[220px] text-sm text-slate/70">
      District
      <select
        className="mt-2 w-full rounded-2xl border border-fog bg-white/90 px-4 py-3 text-sm text-slate"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        <option value="">All districts</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default DistrictFilter;
