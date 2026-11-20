import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, TOKEN_KEY, USER_KEY } from "@/lib/api";

const Ctx = createContext(null);

export const UserProvider = ({ children }) => {
  const [users, setUsers] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/users/switcher");
      setUsers(data);
    } catch {
      setUsers([]);
    }
    const token = localStorage.getItem(TOKEN_KEY);
    const savedId = localStorage.getItem(USER_KEY);
    if (!token && !savedId) {
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
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
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
    setUser(null);
  };

  const switchUser = async (id) => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.setItem(USER_KEY, id);
    const me = await api.get("/me");
    setUser(me.data);
  };

  const hasRole = (...roles) => !!user && roles.includes(user.role);

  return (
    <Ctx.Provider value={{ users, user, loading, login, logout, switchUser, hasRole, reloadUsers: load }}>
      {children}
    </Ctx.Provider>
  );
};

export const useUser = () => useContext(Ctx);
