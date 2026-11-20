import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, USER_KEY } from "@/lib/api";

const Ctx = createContext(null);

export const UserProvider = ({ children }) => {
  const [users, setUsers] = useState([]);
  const [user, setUser] = useState(null);

  const load = useCallback(async () => {
    const { data } = await api.get("/users/switcher");
    setUsers(data);
    let id = localStorage.getItem(USER_KEY);
    if (!data.find((u) => u.id === id)) {
      id = (data.find((u) => u.role === "staff") || data[0])?.id;
      if (id) localStorage.setItem(USER_KEY, id);
    }
    const me = await api.get("/me");
    setUser(me.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const switchUser = async (id) => {
    localStorage.setItem(USER_KEY, id);
    const me = await api.get("/me");
    setUser(me.data);
  };

  const hasRole = (...roles) => !!user && roles.includes(user.role);

  return <Ctx.Provider value={{ users, user, switchUser, hasRole, reloadUsers: load }}>{children}</Ctx.Provider>;
};

export const useUser = () => useContext(Ctx);
