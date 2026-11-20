import { useRef, useState } from "react";
import { Download, Maximize2, ZoomIn, ZoomOut, Shrink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthImage } from "@/components/AuthImage";

export const ScreenshotViewer = ({ fileId, filename }) => {
  const url = useAuthImage(fileId);
  const [scale, setScale] = useState(1);
  const box = useRef();

  const download = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  };

  return (
    <div className="r-card flex h-full flex-col overflow-hidden" data-testid="screenshot-viewer">
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <span className="mr-auto text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Payment screenshot</span>
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!fileId} onClick={() => setScale((s) => Math.max(0.5, s - 0.25))} data-testid="screenshot-zoom-out"><ZoomOut className="h-4 w-4" /></Button>
        <span className="w-12 text-center text-xs tabular-nums" data-testid="screenshot-zoom-level">{Math.round(scale * 100)}%</span>
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!fileId} onClick={() => setScale((s) => Math.min(4, s + 0.25))} data-testid="screenshot-zoom-in"><ZoomIn className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!fileId} title="Fit to screen" onClick={() => setScale(1)} data-testid="screenshot-zoom-reset"><Shrink className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!url} onClick={() => box.current?.requestFullscreen?.()} data-testid="screenshot-fullscreen"><Maximize2 className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!url || url === "error"} onClick={download} data-testid="screenshot-download"><Download className="h-4 w-4" /></Button>
      </div>
      <div ref={box} className="relative min-h-[420px] flex-1 overflow-auto bg-[#101820] p-4 lg:min-h-[560px]">
        {!fileId && <div className="grid h-full min-h-[380px] place-items-center text-sm text-muted-foreground">No screenshot attached (cash payment)</div>}
        {fileId && !url && <div className="grid h-full min-h-[380px] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
        {url === "error" && <div className="grid h-full min-h-[380px] place-items-center text-sm text-muted-foreground">Screenshot could not be loaded</div>}
        {url && url !== "error" && (
          <img
            src={url}
            alt="Payment screenshot"
            data-testid="screenshot-image"
            onDoubleClick={() => setScale((s) => (s === 1 ? 2 : 1))}
            style={scale === 1 ? { maxWidth: "100%", maxHeight: "72vh", width: "auto" } : { width: `${scale * 420}px`, maxWidth: "none" }}
            className="mx-auto block rounded shadow-sm transition-[width] duration-150"
          />
        )}
      </div>
    </div>
  );
};
