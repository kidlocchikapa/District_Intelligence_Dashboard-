import { useRef } from 'react';
import { toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { toast } from 'react-hot-toast';

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
        backgroundColor: '#ffffff'
      });
      
      const width = node.offsetWidth;
      const height = node.offsetHeight;

      const pdf = new jsPDF({
        orientation: width > height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [width, height]
      });
      
      pdf.addImage(imgData, 'JPEG', 0, 0, width, height);
      
      // Advanced Graphics State for Watermark Overlay
      pdf.setGState(new pdf.GState({ opacity: 0.15 }));
      pdf.setTextColor(100, 100, 100);
      
      const centerX = width / 2;
      const centerY = height / 2;
      
      const fontSize = Math.max(80, Math.floor(width / 15));
      pdf.setFontSize(fontSize);
      pdf.setFont("helvetica", "bold");
      
      pdf.text('DISTRICT INTEL', centerX, centerY, { 
        angle: 45, 
        align: 'center' 
      });

      pdf.save(filename);
      
      toast.success('PDF successfully downloaded!', { id: loadingToast });
    } catch (error) {
      console.error('PDF Export Error:', error);
      toast.error('Failed to generate PDF', { id: loadingToast });
    }
  };

  return { contentRef, exportPdf };
}
