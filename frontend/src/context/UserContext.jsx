import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, clearImageCache, TOKEN_KEY, USER_KEY } from "@/lib/api";

const Ctx = createContext(null);

export const UserProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      localStorage.removeItem(USER_KEY);
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.get("/me");
      setUser(me.data);
      localStorage.setItem(USER_KEY, me.data.id);
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      clearImageCache();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("r39:unauthorized", onUnauthorized);
    return () => window.removeEventListener("r39:unauthorized", onUnauthorized);
  }, []);

  const login = async (mobile, password) => {
    const { data } = await api.post("/auth/login", { mobile, password });
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, data.user.id);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Ignore logout audit errors if session is already expired
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    clearImageCache();
    setUser(null);
  };

  const hasRole = (...roles) => !!user && roles.includes(user.role);

  return (
    <Ctx.Provider value={{ user, loading, login, logout, hasRole, reloadUser: load }}>
      {children}
    </Ctx.Provider>
  );
};

export const useUser = () => useContext(Ctx);
