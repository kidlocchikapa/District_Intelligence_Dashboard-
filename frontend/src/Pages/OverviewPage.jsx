import { useState } from 'react';
import DistrictFilter from '../components/DistrictFilter';
import PageHeader from '../components/PageHeader';
import Panel from '../components/Panel';
import LoadingState from '../components/LoadingState';
import MapPanel from '../components/MapPanel';
import MetricBarChart from '../components/MetricBarChart';
import StatCard from '../components/StatCard';
import { useDashboardData } from '../hooks/useDashboardData';
import { useDistrictOptions } from '../hooks/useDistrictOptions';
import { pivotMetrics } from '../lib/format';
import { buildDashboardPath } from '../lib/query';

function OverviewPage() {
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const districts = useDistrictOptions();
  const summary = useDashboardData(buildDashboardPath('/dashboard/summary', { district: selectedDistrict }));
  const densityMap = useDashboardData(buildDashboardPath('/dashboard/admin-units', { type: 'District', district: selectedDistrict }));
  const disasterRisk = useDashboardData(buildDashboardPath('/dashboard/analysis', {
    analysis_type: 'disaster_vulnerability',
    metric_name: 'disaster_vulnerability_score',
    admin_type: 'District',
    district: selectedDistrict,
  }));
  const healthServed = useDashboardData(buildDashboardPath('/dashboard/health/served-population/geojson', {
    admin_type: 'District',
    district: selectedDistrict,
  }));
  const servedFeatures = healthServed.data?.features || [];
  const accessTotals = servedFeatures.reduce((accumulator, feature) => {
    const properties = feature?.properties || {};
    accumulator.population += Number(properties.population_total) || 0;
    accumulator.served += Number(properties.health_population_served_total) || 0;
    accumulator.unserved += Number(properties.health_population_unserved_total) || 0;
    return accumulator;
  }, { population: 0, served: 0, unserved: 0 });
  const servedPct = accessTotals.population ? (accessTotals.served * 100) / accessTotals.population : 0;
  const unservedPct = accessTotals.population ? (accessTotals.unserved * 100) / accessTotals.population : 0;

  const disasterChartData = pivotMetrics(disasterRisk.data || []).map((row) => ({
    name: row.admin_unit_name,
    disaster_vulnerability_score: row.disaster_vulnerability_score || 0,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="National overview"
        title="District intelligence at a glance"
        description="Track population density, service reach, disaster vulnerability, and district readiness through choropleths, charts, and high-level KPIs."
        actions={[
          <DistrictFilter
            key="district-filter"
            value={selectedDistrict}
            onChange={setSelectedDistrict}
            options={districts.options}
            disabled={districts.loading}
          />,
        ]}
      />

      {summary.loading ? (
        <LoadingState />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Total schools" value={summary.data?.total_schools || 0} />
          <StatCard label="Health facilities" value={summary.data?.total_health_facilities || 0} tone="moss" />
          <StatCard label="Estimated population" value={summary.data?.total_estimated_population || 0} tone="ember" />
        </div>
      )}

      {healthServed.loading ? null : (
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            label="Population with access"
            value={accessTotals.served}
            tone="moss"
            helper="Estimated people inside health facility service zones."
          />
          <StatCard
            label="Population with access"
            value={servedPct}
            digits={1}
            suffix="%"
            tone="pine"
            helper="Share of the national district population served by health facilities."
          />
          <StatCard
            label="Population without access"
            value={unservedPct}
            digits={1}
            suffix="%"
            tone="ember"
            helper="Share of people outside the current facility service reach."
          />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel title="Population density heatmap" subtitle="District-level choropleth from WorldPop + administrative boundaries.">
          {densityMap.loading ? (
            <LoadingState />
          ) : (
            <MapPanel
              geojson={densityMap.data}
              metricName="population_density"
              title="Population density"
              subtitle="Compare density by district before drilling into access and vulnerability."
              palette="heat"
              showLegend
              showLabels
              legendTitle="Population density (people / km²)"
            />
          )}
        </Panel>

        <Panel title="Disaster vulnerability" subtitle="District score blended from hazard overlap, exposure, and risk intensity.">
          {disasterRisk.loading ? (
            <LoadingState />
          ) : (
            <MetricBarChart
              data={disasterChartData}
              xKey="name"
              yKey="disaster_vulnerability_score"
              title="Disaster vulnerability score"
              subtitle="Useful for surfacing highest-risk districts."
              color="#c56a3d"
            />
          )}
        </Panel>
      </div>

      <Panel title="Population served by health facilities" subtitle="True served population derived from WorldPop raster clipped to facility service areas.">
        {healthServed.loading ? (
          <LoadingState />
        ) : (
          <MapPanel
            geojson={healthServed.data}
            metricName="health_population_served_pct"
            title="Health served population"
            subtitle="Shows the share of district population inside health facility service zones."
            palette="heat"
            showLegend
            legendTitle="Population served by health facilities (%)"
            popupFields={[
              { key: 'population_total', label: 'Total population' },
              { key: 'health_population_served_total', label: 'Population with access' },
              { key: 'health_population_served_pct', label: 'Population with access (%)' },
              { key: 'health_population_unserved_total', label: 'Population without access' },
              { key: 'health_population_unserved_pct', label: 'Population without access (%)' },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}

export default OverviewPage;
