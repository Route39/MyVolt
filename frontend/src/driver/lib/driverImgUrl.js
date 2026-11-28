// Image/file URLs for the driver app: always served by MyVolt (REACT_APP_DRIVER_BACKEND_URL).
const BACKEND = process.env.REACT_APP_DRIVER_BACKEND_URL || "";

export function driverImgUrl(path) {
  if (!path) return null;
  if (path.startsWith("http") || path.startsWith("data:") || path.startsWith("blob:")) return path;
  return `${BACKEND}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default driverImgUrl;
