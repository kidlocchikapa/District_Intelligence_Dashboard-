function EmptyState({ title, description }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-fog bg-sand/50 px-6 text-center">
      <div className="text-base font-semibold text-slate">{title}</div>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate/60">{description}</p>
    </div>
  );
}

export default EmptyState;
