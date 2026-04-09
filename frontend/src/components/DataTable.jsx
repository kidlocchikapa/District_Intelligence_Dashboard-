import { formatNumber, titleizeMetric } from '../lib/format';
import EmptyState from './EmptyState';

function DataTable({ rows, columns, title, subtitle }) {
  if (!rows?.length) {
    return <EmptyState title={title} description="No tabular records are available for this section yet." />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-lg font-semibold text-slate">{title}</h4>
        {subtitle ? <p className="mt-1 text-sm leading-6 text-slate/60">{subtitle}</p> : null}
      </div>
      <div className="overflow-hidden rounded border border-fog">
        <div className="max-h-[360px] overflow-auto">
          <table className="min-w-full divide-y divide-fog text-sm">
            <thead className="bg-sand/70">
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className="px-4 py-3 text-left font-medium uppercase tracking-[0.12em] text-slate/55">
                    {column.label || titleizeMetric(column.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-fog bg-white">
              {rows.map((row, index) => (
                <tr key={row.id || row.admin_unit_id || row.admin_unit_name || index}>
                  {columns.map((column) => (
                    <td key={column.key} className="px-4 py-3 text-slate/80">
                      {column.render
                        ? column.render(row[column.key], row)
                        : typeof row[column.key] === 'number'
                          ? formatNumber(row[column.key], column.digits ?? 1)
                          : row[column.key] ?? 'N/A'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default DataTable;
