function Panel({ title, subtitle, children, className = '', surface = 'glass' }) {
  const surfaceClasses =
    surface === 'solid'
      ? 'border-slate/10 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.06)]'
      : 'border-white/70 bg-white/90 shadow-panel';

  return (
    <section className={`rounded border p-4 sm:p-5 ${surfaceClasses} ${className}`}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm leading-6 text-slate-700">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default Panel;
