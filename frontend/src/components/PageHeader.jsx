function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="mb-6 rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-panel backdrop-blur">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-[0.26em] text-moss">{eyebrow}</div>
          <h2 className="text-3xl font-semibold text-slate">{title}</h2>
          <p className="max-w-3xl text-sm leading-6 text-slate/70">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </div>
  );
}

export default PageHeader;
