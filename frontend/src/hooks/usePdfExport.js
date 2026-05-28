import { useRef } from 'react';
import { toJpeg, toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { toast } from 'react-hot-toast';

const FRIENDLY_METRIC_LABELS = {
  estimated_population: 'People living in the area',
  total_estimated_population: 'People living in the area',
  population_total: 'People living in the area',
  total_population: 'People living in the area',
  population_density: 'How crowded the area is',
  total_population_density: 'How crowded the area is',
  flood_exposed_population: 'People in flood-prone places',
  exposed_population: 'People in flood-prone places',
  not_exposed_population: 'People outside flood-prone places',
  school_count: 'Schools',
  total_schools: 'Schools',
  student_enrollment_total: 'Learners enrolled in school',
  teacher_count_total: 'Teachers',
  school_age_population_total: 'Children of school age',
  school_age_population_unenrolled: 'Children not enrolled in school',
  not_in_school_total: 'Children not enrolled in school',
  health_facility_count: 'Health facilities',
  total_health_facilities: 'Health facilities',
  health_population_served_total: 'People near a health facility',
  health_population_unserved_total: 'People far from a health facility',
  health_population_served_pct: 'Share of people near health care',
  beneficiary_count: 'People receiving welfare support',
  total_beneficiaries: 'People receiving welfare support',
  estimated_household_population: 'People reached through supported households',
  health_access_count: 'Beneficiaries near health care',
  school_access_count: 'Beneficiaries near a school',
  flood_affected_count: 'Beneficiaries in flood-prone places',
  flood_affected_pct: 'Share of beneficiaries in flood-prone places',
  exposed_area_sq_km: 'Land area exposed to flood risk',
  schools_exposed: 'Schools in flood-prone places',
  health_facilities_exposed: 'Health facilities in flood-prone places',
  beneficiaries_affected: 'Welfare beneficiaries in flood-prone places',
};

function normalizeMetricKey(value) {
  return String(value || '')
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function toTitleCase(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function friendlyMetricLabel(value) {
  const raw = String(value || '').trim();
  const key = normalizeMetricKey(raw);

  if (FRIENDLY_METRIC_LABELS[key]) {
    return FRIENDLY_METRIC_LABELS[key];
  }

  return toTitleCase(raw)
    .replace(/\bPct\b/g, '%')
    .replace(/\bSq Km\b/g, 'sq km')
    .replace(/\bTa\b/g, 'TA');
}

function friendlyTitle(value) {
  return String(value || '')
    .replace(/\bAnalysis\b/g, 'Summary')
    .replace(/\bArea Summary\b/g, 'Area Summary');
}

function cleanAreaName(value) {
  return String(value || '')
    .replace(/^\s*(selected\s+area\s*:\s*)?/i, '')
    .replace(/^\s*(TA|District)\s*:\s*/i, '')
    .trim();
}

function wrapText(pdf, text, maxWidth) {
  const safeText = String(text ?? '');
  return pdf.splitTextToSize(safeText, Math.max(maxWidth, 20));
}

function fitColumnsToPage(pdf, columns, startX, rightMargin) {
  const availableWidth = pdf.internal.pageSize.width - startX - rightMargin;
  const totalWidth = columns.reduce((sum, column) => sum + Number(column.width || 0), 0);

  if (!totalWidth || totalWidth <= availableWidth) {
    return columns;
  }

  const scale = availableWidth / totalWidth;
  return columns.map((column) => ({
    ...column,
    width: Math.max(46, Number(column.width || 0) * scale),
  }));
}

function drawTable(pdf, columns, rows, startX, startY, rowHeight, rightMargin = 40) {
  let y = startY;
  const pageHeight = pdf.internal.pageSize.height;
  const bottomMargin = 58;
  const fittedColumns = fitColumnsToPage(pdf, columns, startX, rightMargin);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(226, 232, 240);
  pdf.setTextColor(15, 23, 42);

  let x = startX;
  fittedColumns.forEach((column) => {
    pdf.setFillColor(248, 250, 252);
    pdf.rect(x, y, column.width, rowHeight, 'FD');
    pdf.text(String(column.label), x + 6, y + 15, {
      maxWidth: column.width - 12,
    });
    x += column.width;
  });

  y += rowHeight;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.setTextColor(51, 65, 85);

  rows.forEach((row, rowIndex) => {
    const lineGroups = fittedColumns.map((column) =>
      wrapText(pdf, row[column.key] ?? '', column.width - 12),
    );
    const rowLines = Math.max(...lineGroups.map((lines) => lines.length), 1);
    const actualRowHeight = Math.max(rowHeight, rowLines * 12 + 14);

    if (y + actualRowHeight > pageHeight - bottomMargin) {
      pdf.addPage();
      y = 40;
    }

    x = startX;
    fittedColumns.forEach((column, index) => {
      if (rowIndex % 2 === 1) {
        pdf.setFillColor(250, 250, 250);
        pdf.rect(x, y, column.width, actualRowHeight, 'F');
      }
      pdf.setDrawColor(226, 232, 240);
      pdf.rect(x, y, column.width, actualRowHeight);
      pdf.text(lineGroups[index], x + 6, y + 14, {
        maxWidth: column.width - 12,
        lineHeightFactor: 1.15,
      });
      x += column.width;
    });

    y += actualRowHeight;
  });

  pdf.setTextColor(0, 0, 0);

  return y;
}

function makeSectionReadable(section) {
  const usesMetricValue =
    section.columns?.some((column) => column.key === 'metric') &&
    section.columns?.some((column) => column.key === 'value');

  if (!usesMetricValue) {
    return section;
  }

  const rows = (section.rows || []).map((row) => {
    const metric = friendlyMetricLabel(row.metric);
    const value = row.value ?? '';
    return {
      ...row,
      metric,
      value,
    };
  });

  return {
    ...section,
    title: friendlyTitle(section.title),
    columns: [
      { key: 'metric', label: 'Indicator', width: 300 },
      { key: 'value', label: 'Value', width: 215 },
    ],
    rows,
  };
}

const DEFAULT_MAP_LEGEND = [
  { label: 'Population intensity', color: '#56ab91' },
  { label: 'TA boundary', color: '#5f6d5b', type: 'line' },
  { label: 'Selected area', color: '#111827' },
  { label: 'Planning indicator', color: '#f59e0b' },
];

function drawMapLegend(pdf, legendItems, startX, startY, maxWidth) {
  const items = legendItems?.length ? legendItems : DEFAULT_MAP_LEGEND;
  let x = startX;
  let y = startY;
  const itemGap = 18;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(15, 23, 42);
  pdf.text('Map legend', startX, y);
  y += 18;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);

  items.forEach((item) => {
    const label = String(item.label || '');
    const labelWidth = pdf.getTextWidth(label);
    const itemWidth = Math.min(labelWidth + 32, maxWidth);

    if (x + itemWidth > startX + maxWidth) {
      x = startX;
      y += 18;
    }

    pdf.setDrawColor(203, 213, 225);
    pdf.setFillColor(255, 255, 255);

    if (item.type === 'line') {
      pdf.setDrawColor(item.color || '#5f6d5b');
      pdf.setLineWidth(2);
      pdf.line(x, y - 3, x + 15, y - 3);
      pdf.setLineWidth(0.2);
    } else {
      pdf.setFillColor(item.color || '#94a3b8');
      pdf.roundedRect(x, y - 10, 14, 10, 2, 2, 'F');
    }

    pdf.setTextColor(51, 65, 85);
    pdf.text(label, x + 21, y - 1, {
      maxWidth: Math.max(30, itemWidth - 24),
    });
    x += itemWidth + itemGap;
  });

  pdf.setTextColor(0, 0, 0);
  return y + 12;
}

function parseMapLegend(node, fallbackLegend) {
  if (fallbackLegend?.length) {
    return fallbackLegend;
  }

  try {
    const parsed = JSON.parse(node?.dataset?.mapLegend || '[]');
    return Array.isArray(parsed) ? parsed : DEFAULT_MAP_LEGEND;
  } catch {
    return DEFAULT_MAP_LEGEND;
  }
}

function normalizeMapBlocks({ mapNode, mapNodes, mapLegend, rootNode }) {
  if (Array.isArray(mapNodes) && mapNodes.length) {
    return mapNodes
      .map((entry) => (entry?.node ? entry : { node: entry }))
      .filter((entry) => entry.node);
  }

  const scopedNodes = rootNode
    ? Array.from(rootNode.querySelectorAll('[data-map-export]'))
    : [];

  const nodes = scopedNodes.length ? scopedNodes : mapNode ? [mapNode] : [];

  return nodes.map((node, index) => ({
    node,
    title: node?.dataset?.mapTitle || (nodes.length > 1 ? `Map ${index + 1}` : 'Map'),
    subtitle: node?.dataset?.mapSubtitle || '',
    legend: parseMapLegend(node, index === 0 ? mapLegend : null),
  }));
}

export function usePdfExport(filename = 'district-report.pdf') {
  const contentRef = useRef(null);

  const exportPdf = async () => {
    if (!contentRef.current) return;
    const loadingToast = toast.loading('Preparing PDF and embedding watermark...');

    try {
      const node = contentRef.current;
      const imgData = await toJpeg(node, {
        quality: 1.0,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      });

      const width = node.offsetWidth;
      const height = node.offsetHeight;

      const pdf = new jsPDF({
        orientation: width > height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [width, height],
      });

      pdf.addImage(imgData, 'JPEG', 0, 0, width, height);

      pdf.setGState(new pdf.GState({ opacity: 0.15 }));
      pdf.setTextColor(100, 100, 100);

      const centerX = width / 2;
      const centerY = height / 2;
      const fontSize = Math.max(80, Math.floor(width / 15));
      pdf.setFontSize(fontSize);
      pdf.setFont('helvetica', 'bold');
      pdf.text('DISTRICT INTEL', centerX, centerY, {
        angle: 45,
        align: 'center',
      });

      pdf.save(filename);
      toast.success('PDF successfully downloaded!', { id: loadingToast });
    } catch (error) {
      console.error('PDF Export Error:', error);
      toast.error('Failed to generate PDF', { id: loadingToast });
    }
  };

  const exportDataPdf = async ({
    title,
    selectedArea,
    sections,
    mapNode,
    mapNodes,
    mapLegend,
    showHeader = true,
    showMapCaptions = true,
    showFooterDivider = true,
  }) => {
    const loadingToast = toast.loading('Preparing easy-to-read report...');

    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 40;
      let y = 50;
      const pageHeight = pdf.internal.pageSize.height;
      const readableSections = (sections || []).map(makeSectionReadable);
      const exportedAt = new Date().toLocaleString();
      const mapBlocks = normalizeMapBlocks({
        mapNode,
        mapNodes,
        mapLegend,
        rootNode: contentRef.current,
      });

      async function loadImageSize(dataUrl) {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = reject;
          img.src = dataUrl;
        });
      }

      if (showHeader) {
        const areaName = cleanAreaName(selectedArea) || friendlyTitle(title);
        const isGenericSelectedAreaTitle = /selected\s+area/i.test(title || '');
        const reportSubtitle =
          !isGenericSelectedAreaTitle && areaName && friendlyTitle(title) !== areaName
            ? friendlyTitle(title)
            : '';

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(20);
        pdf.text(areaName, margin, y);
        y += 24;

        if (reportSubtitle) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(11);
          pdf.setTextColor(90, 90, 90);
          pdf.text(reportSubtitle, margin, y);
          pdf.setTextColor(0, 0, 0);
          y += 22;
        }
      }

      for (const mapBlock of mapBlocks) {
        const currentMapNode = mapBlock.node;

        if (!currentMapNode) {
          continue;
        }

        try {
          if (y + 320 > pageHeight - 58) {
            pdf.addPage();
            y = margin;
          }

          if (showMapCaptions && mapBlock.title) {
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(12);
            pdf.setTextColor(15, 23, 42);
            pdf.text(mapBlock.title, margin, y);
            y += 16;
          }

          if (showMapCaptions && mapBlock.subtitle) {
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(9);
            pdf.setTextColor(71, 85, 105);
            pdf.text(wrapText(pdf, mapBlock.subtitle, pdf.internal.pageSize.width - margin * 2), margin, y, {
              lineHeightFactor: 1.15,
            });
            y += 16;
          }

          const mapImgData = await toPng(currentMapNode, {
            cacheBust: true,
            pixelRatio: 2,
            backgroundColor: 'transparent',
            filter: (node) => !node?.dataset?.mapExportSkip,
            style: {
              border: 'none',
              borderRadius: '0',
              boxShadow: 'none',
              outline: 'none',
            },
          });
          const imgSize = await loadImageSize(mapImgData);
          const pageWidth = pdf.internal.pageSize.width;
          const availableWidth = pageWidth - margin * 2;
          const maxMapHeight = Math.max(360, pageHeight - y - 110);
          const scale = Math.min(
            availableWidth / imgSize.width,
            maxMapHeight / imgSize.height,
          );
          const drawWidth = imgSize.width * scale;
          const drawHeight = imgSize.height * scale;
          const drawX = margin + (availableWidth - drawWidth) / 2;

          // Add image on current page and advance Y position.
          pdf.addImage(mapImgData, 'PNG', drawX, y, drawWidth, drawHeight);
          y += drawHeight + 18;
          y = drawMapLegend(pdf, mapBlock.legend, margin, y, availableWidth) + 18;
        } catch (err) {
          // If map capture fails, continue without it.
          console.warn('Failed to capture map for PDF export', err);
        }
      }

      readableSections.forEach((section) => {
        if (y + 80 > pageHeight) {
          pdf.addPage();
          y = margin;
        }

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(14);
        pdf.text(section.title, margin, y);
        y += 22;

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(11);

        if (!section.rows || section.rows.length === 0) {
          pdf.text('No data available for this section.', margin, y);
          y += 20;
          return;
        }

        y = drawTable(pdf, section.columns, section.rows, margin, y, 24);
        y += 18;
      });

      const pageWidth = pdf.internal.pageSize.width;
      const pageCount = pdf.internal.getNumberOfPages();
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(90, 90, 90);
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        pdf.setPage(pageNumber);
        if (showFooterDivider) {
          pdf.setDrawColor(226, 232, 240);
          pdf.line(margin, pageHeight - 40, pageWidth - margin, pageHeight - 40);
        }
        pdf.text(`Exported on: ${exportedAt}`, pageWidth - margin, pageHeight - 24, {
          align: 'right',
        });
        pdf.text(`Page ${pageNumber} of ${pageCount}`, margin, pageHeight - 24);
      }
      pdf.setTextColor(0, 0, 0);

      pdf.save(filename);
      toast.success('PDF successfully downloaded!', { id: loadingToast });
    } catch (error) {
      console.error('Data PDF Export Error:', error);
      toast.error('Failed to generate PDF', { id: loadingToast });
    }
  };

  return { contentRef, exportPdf, exportDataPdf };
}
