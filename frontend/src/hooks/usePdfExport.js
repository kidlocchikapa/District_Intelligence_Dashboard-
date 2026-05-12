import { useRef } from 'react';
import { toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { toast } from 'react-hot-toast';

function drawTable(pdf, columns, rows, startX, startY, rowHeight, marginRight) {
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

  const exportDataPdf = async ({ title, selectedArea, summaryMetrics, tableColumns, tableRows }) => {
    const loadingToast = toast.loading('Preparing data PDF...');

    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 40;
      let y = 50;

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(18);
      pdf.text(title, margin, y);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      pdf.text(`Selected area: ${selectedArea}`, margin, y + 24);
      pdf.text(`Exported on: ${new Date().toLocaleString()}`, margin, y + 40);

      y += 70;
      pdf.setFont('helvetica', 'bold');
      pdf.text('Key Metrics', margin, y);
      pdf.setFont('helvetica', 'normal');
      y += 18;

      summaryMetrics.forEach((metric) => {
        pdf.text(`${metric.label}:`, margin, y);
        pdf.text(String(metric.value), margin + 260, y);
        y += 18;
      });

      y += 12;
      pdf.setFont('helvetica', 'bold');
      pdf.text('Selected Area Breakdown', margin, y);
      y += 20;

      drawTable(pdf, tableColumns, tableRows, margin, y, 24);
      pdf.save(filename);
      toast.success('PDF successfully downloaded!', { id: loadingToast });
    } catch (error) {
      console.error('Data PDF Export Error:', error);
      toast.error('Failed to generate PDF', { id: loadingToast });
    }
  };

  return { contentRef, exportPdf, exportDataPdf };
}
