import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const USER_KEY = "r39_user";
export const TOKEN_KEY = "r39_token";

export const api = axios.create({ baseURL: API });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) cfg.headers["Authorization"] = `Bearer ${token}`;
  return cfg;
});

export const errMsg = (e) => {
  const d = e?.response?.data?.detail;
  if (Array.isArray(d)) return d.map((x) => `${x.loc?.slice(-1)[0]}: ${x.msg}`).join(", ");
  return d || e?.message || "Something went wrong";
};

export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const imageCache = new Map();
export const fetchImage = (fileId) => {
  if (!imageCache.has(fileId)) {
    const p = api.get(`/files/${fileId}`, { responseType: "blob" }).then((r) => URL.createObjectURL(r.data));
    p.catch(() => imageCache.delete(fileId));
    imageCache.set(fileId, p);
  }
  return imageCache.get(fileId);
};
