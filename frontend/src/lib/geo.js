export const CHOROPLETH_PALETTES = {
  default: ['#d5e3df', '#acc8be', '#78aa97', '#4c8976', '#1f5f4f', '#143e35'],
  heat: ['#fff1a8', '#f4d35e', '#e6b24b', '#cf8b3e', '#b46734', '#964229', '#b91c1c', '#7f1d1d'],
};

export function getMetricRange(features = [], metricName) {
  const values = features
    .map((feature) => Number(feature?.properties?.[metricName]))
    .filter((value) => Number.isFinite(value));

  if (!values.length) {
    return { min: 0, max: 0 };
  }

  return { min: Math.min(...values), max: Math.max(...values) };
}

export function getChoroplethColor(value, min, max, palette = CHOROPLETH_PALETTES.default) {
  if (!Number.isFinite(value)) {
    return '#b7c5c0';
  }

  if (max <= min) {
    return palette[palette.length - 1];
  }

  const ratio = (value - min) / (max - min);
  const index = Math.min(palette.length - 1, Math.floor(ratio * palette.length));
  return palette[index];
}

export function getLegendStops(min, max, palette = CHOROPLETH_PALETTES.default) {
  if (!palette.length) {
    return [];
  }

  if (max <= min) {
    return [
      {
        color: palette[palette.length - 1],
        from: min,
        to: max,
      },
    ];
  }

  const step = (max - min) / palette.length;
  return palette.map((color, index) => {
    const from = min + step * index;
    const to = index === palette.length - 1 ? max : min + step * (index + 1);
    return { color, from, to };
  });
}

export function featureCenter(feature) {
  const coordinates = feature?.geometry?.coordinates;
  if (!coordinates) {
    return [-13.5, 34.3];
  }

  if (feature.geometry.type === 'Point') {
    return [coordinates[1], coordinates[0]];
  }

  const first = feature.geometry.type === 'Polygon'
    ? coordinates[0]?.[0]
    : coordinates[0]?.[0]?.[0];

  if (!first) {
    return [-13.5, 34.3];
  }

  return [first[1], first[0]];
}

function collectGeometryCoordinates(geometry, bucket) {
  if (!geometry?.coordinates) {
    return;
  }

  if (geometry.type === 'Point') {
    bucket.push(geometry.coordinates);
    return;
  }

  const walk = (value) => {
    if (!Array.isArray(value)) {
      return;
    }

    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      bucket.push(value);
      return;
    }

    value.forEach(walk);
  };

  walk(geometry.coordinates);
}

export function getGeoBounds(features = []) {
  const coordinates = [];
  features.forEach((feature) => collectGeometryCoordinates(feature?.geometry, coordinates));

  if (!coordinates.length) {
    return {
      minLon: 32,
      maxLon: 36,
      minLat: -18,
      maxLat: -9,
    };
  }

  const longitudes = coordinates.map(([lon]) => lon);
  const latitudes = coordinates.map(([, lat]) => lat);

  return {
    minLon: Math.min(...longitudes),
    maxLon: Math.max(...longitudes),
    minLat: Math.min(...latitudes),
    maxLat: Math.max(...latitudes),
  };
}

export function createSvgProjector(bounds, width, height, padding = 16) {
  const usableWidth = Math.max(width - padding * 2, 1);
  const usableHeight = Math.max(height - padding * 2, 1);
  const lonSpan = Math.max(bounds.maxLon - bounds.minLon, 0.0001);
  const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.0001);
  const scale = Math.min(usableWidth / lonSpan, usableHeight / latSpan);
  const xOffset = (width - lonSpan * scale) / 2;
  const yOffset = (height - latSpan * scale) / 2;

  return ([lon, lat]) => {
    const x = xOffset + (lon - bounds.minLon) * scale;
    const y = height - (yOffset + (lat - bounds.minLat) * scale);
    return [x, y];
  };
}

function ringToPath(ring, project) {
  return ring
    .map((coord, index) => {
      const [x, y] = project(coord);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function geometryToSvgPath(geometry, project) {
  if (!geometry?.coordinates || !project) {
    return '';
  }

  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map((ring) => `${ringToPath(ring, project)} Z`).join(' ');
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .flatMap((polygon) => polygon.map((ring) => `${ringToPath(ring, project)} Z`))
      .join(' ');
  }

  return '';
}

export function getFeatureLabelPosition(feature, project) {
  const coordinates = [];
  collectGeometryCoordinates(feature?.geometry, coordinates);

  if (!coordinates.length) {
    return null;
  }

  const longitudes = coordinates.map(([lon]) => lon);
  const latitudes = coordinates.map(([, lat]) => lat);
  const center = [
    (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
  ];

  const [x, y] = project(center);
  return { x, y };
}

export function getFeatureLabelBox(feature, project) {
  const coordinates = [];
  collectGeometryCoordinates(feature?.geometry, coordinates);

  if (!coordinates.length) {
    return null;
  }

  const projected = coordinates.map((coord) => project(coord));
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    width: maxX - minX,
    height: maxY - minY,
  };
}
