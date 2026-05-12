import { useRef } from "react";
import { toPng } from "html-to-image";
import { toast } from "react-hot-toast";

export function useImageDownload(filename = "district-map.png") {
  const targetRef = useRef(null);

  const downloadImage = async () => {
    if (!targetRef.current) return;

    const loadingToast = toast.loading("Preparing map download...");
    const className = "download-boundary-only";
    const style = document.createElement("style");
    style.innerHTML = `
      .${className} .leaflet-control-container,
      .${className} .leaflet-shadow-pane,
      .${className} .leaflet-popup-pane,
      .${className} .leaflet-tooltip,
      .${className} .leaflet-control-zoom,
      .${className} .leaflet-control-attribution {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
    targetRef.current.classList.add(className);

    try {
      const dataUrl = await toPng(targetRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });

      const link = document.createElement("a");
      link.download = filename;
      link.href = dataUrl;
      link.click();

      toast.success("Map successfully downloaded!", { id: loadingToast });
    } catch (error) {
      console.error("Map Download Error:", error);
      toast.error("Failed to download map", { id: loadingToast });
    } finally {
      targetRef.current.classList.remove(className);
      document.head.removeChild(style);
    }
  };

  return { targetRef, downloadImage };
}
