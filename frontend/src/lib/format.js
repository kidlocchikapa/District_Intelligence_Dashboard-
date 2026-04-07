export function formatNumber(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '0';
  }

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(number);
}

export function formatPercent(value, digits = 1) {
  return `${formatNumber(value, digits)}%`;
}

export function titleizeMetric(metric) {
  return String(metric || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function pivotMetrics(records = [], key = 'admin_unit_name') {
  const map = new Map();

  records.forEach((record) => {
    const itemKey = record[key] ?? record.admin_unit_name ?? record.name;
    if (!map.has(itemKey)) {
      map.set(itemKey, {
        [key]: itemKey,
        admin_unit_id: record.admin_unit_id,
        admin_unit_code: record.admin_unit_code,
        admin_unit_name: record.admin_unit_name,
        admin_unit_type: record.admin_unit_type,
      });
    }

    map.get(itemKey)[record.metric_name] = record.metric_value;
  });

  return Array.from(map.values());
}
