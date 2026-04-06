import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatNumber } from '../lib/format';
import EmptyState from './EmptyState';

function MetricBarChart({ data, xKey, yKey, title, subtitle, color = '#2f6f5d' }) {
  if (!data?.length) {
    return <EmptyState title={title} description="There is no chartable data for this section yet." />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-lg font-semibold text-slate">{title}</h4>
        {subtitle ? <p className="mt-1 text-sm leading-6 text-slate/60">{subtitle}</p> : null}
      </div>
      <div className="h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#d8e1de" />
            <XAxis dataKey={xKey} tick={{ fill: '#22313f', fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={70} />
            <YAxis tick={{ fill: '#22313f', fontSize: 12 }} />
            <Tooltip formatter={(value) => formatNumber(value, 1)} />
            <Bar dataKey={yKey} fill={color} radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default MetricBarChart;
