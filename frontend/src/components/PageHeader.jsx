function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className = '',
  surface = 'glass',
}) {
  const surfaceClasses =
    surface === 'solid'
      ? 'border-slate/10 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.06)]'
      : 'border-white/70 bg-white/80 shadow-panel backdrop-blur';

  return (
    <div className={`mb-6 rounded-[1.5rem] p-4 sm:rounded-[2rem] sm:p-6 ${surfaceClasses} ${className}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-[0.26em] text-slate-500">{eyebrow}</div>
          <h2 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{title}</h2>
          <p className="max-w-3xl text-sm leading-6 text-slate-700">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </div>
  );
}

export default PageHeader;
