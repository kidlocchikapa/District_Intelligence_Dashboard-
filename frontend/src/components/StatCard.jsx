import { formatNumber } from '../lib/format';

const toneClasses = {
  pine: 'text-pine',
  moss: 'text-moss',
  ember: 'text-ember',
  slate: 'text-slate',
};

function StatCard({ label, value, tone = 'pine', suffix, helper, digits = 0 }) {
  return (
    <div className="rounded border border-white/70 bg-white/90 p-5 shadow-panel">
      <div className="text-xs uppercase tracking-[0.24em] text-slate/45">{label}</div>
      <div className={`mt-3 text-3xl font-semibold ${toneClasses[tone] || toneClasses.pine}`}>
        {formatNumber(value, digits)}
        {suffix ? <span className="ml-1 text-base font-medium">{suffix}</span> : null}
      </div>
      {helper ? <p className="mt-3 text-sm leading-6 text-slate/65">{helper}</p> : null}
    </div>
  );
}

export default StatCard;
