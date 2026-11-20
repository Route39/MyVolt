import { useEffect, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { fetchImage } from "@/lib/api";

export const useAuthImage = (fileId) => {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (fileId) {
      fetchImage(fileId)
        .then((u) => alive && setUrl(u))
        .catch(() => alive && setUrl("error"));
    }
    return () => {
      alive = false;
    };
  }, [fileId]);
  return url;
};

export const AuthImage = ({ fileId, className = "", alt = "Payment screenshot", testId }) => {
  const url = useAuthImage(fileId);
  if (!fileId) return <div className={`grid place-items-center bg-muted text-muted-foreground text-[10px] ${className}`}>No file</div>;
  if (!url) return <div className={`grid place-items-center bg-muted ${className}`}><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (url === "error") return <div className={`grid place-items-center bg-muted ${className}`}><ImageOff className="h-4 w-4 text-muted-foreground" /></div>;
  return <img data-testid={testId} src={url} alt={alt} className={`object-cover ${className}`} />;
};
