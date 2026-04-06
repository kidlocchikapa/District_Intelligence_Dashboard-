function LoadingState({ label = 'Loading data...' }) {
  return (
    <div className="flex min-h-[180px] items-center justify-center rounded-[1.5rem] border border-dashed border-fog bg-sand/50 text-sm text-slate/55">
      {label}
    </div>
  );
}

export default LoadingState;
