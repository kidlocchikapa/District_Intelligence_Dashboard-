function Panel({ title, subtitle, children, className = '' }) {
  return (
    <section className={`rounded border border-white/70 bg-white/90 p-5 shadow-panel ${className}`}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-slate">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm leading-6 text-slate/60">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default Panel;
