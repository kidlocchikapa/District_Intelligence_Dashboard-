function EmptyState({ title, description }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
      <div className="text-base font-semibold text-slate-900">{title}</div>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-700">{description}</p>
    </div>
  );
}

export default EmptyState;
