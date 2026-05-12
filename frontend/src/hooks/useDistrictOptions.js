import { useMemo } from 'react';
import { useDashboardData } from './useDashboardData';

export function useDistrictOptions() {
  const districts = useDashboardData('/dashboard/districts');

  const options = useMemo(
    () =>
      [...new Set(districts.data || [])].map((name) => ({
        label: name,
        value: name,
      })),
    [districts.data],
  );

  return {
    ...districts,
    options,
  };
}
