import { useRef } from 'react';
import { toJpeg } from 'html-to-image';
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

function drawTable(pdf, columns, rows, startX, startY, rowHeight) {
  let y = startY;
  const pageHeight = pdf.internal.pageSize.height;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);

  let x = startX;
  columns.forEach((column) => {
    pdf.text(String(column.label), x + 4, y + 14);
    pdf.rect(x, y, column.width, rowHeight);
    x += column.width;
  });

  y += rowHeight;
  pdf.setFont('helvetica', 'normal');

  rows.forEach((row) => {
    if (y + rowHeight > pageHeight - 40) {
      pdf.addPage();
      y = 40;
    }

    x = startX;
    columns.forEach((column) => {
      const text = String(row[column.key] ?? '');
      pdf.text(text, x + 4, y + 14, { maxWidth: column.width - 8 });
      pdf.rect(x, y, column.width, rowHeight);
      x += column.width;
    });

    y += rowHeight;
  });

  return y;
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

  const exportDataPdf = async ({ title, selectedArea, sections }) => {
    const loadingToast = toast.loading('Preparing easy-to-read report...');

    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 40;
      let y = 50;
      const pageHeight = pdf.internal.pageSize.height;

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(18);
      pdf.text(friendlyTitle(title), margin, y);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      pdf.text(`Selected area: ${selectedArea}`, margin, y + 24);
      pdf.text(`Exported on: ${new Date().toLocaleString()}`, margin, y + 40);

      pdf.setTextColor(90, 90, 90);
      pdf.text(
        'Plain-language summary for planning and community discussion.',
        margin,
        y + 56,
      );
      pdf.setTextColor(0, 0, 0);

      y += 86;

      sections.forEach((section) => {
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

      pdf.save(filename);
      toast.success('PDF successfully downloaded!', { id: loadingToast });
    } catch (error) {
      console.error('Data PDF Export Error:', error);
      toast.error('Failed to generate PDF', { id: loadingToast });
    }
  };

  return { contentRef, exportPdf, exportDataPdf };
}
