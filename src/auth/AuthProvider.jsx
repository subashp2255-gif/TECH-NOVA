import React, { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '../services/authService';
import { useSync } from '../hooks/useSync';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const { broadcast } = useSync((event) => {
    if (event?.type === 'storage_change' && event.key === 'seatsync_session') {
      setUser(authService.getCurrentUser());
    } else if (event?.type === 'logout') {
      setUser(null);
    }
  });

  useEffect(() => {
    const currentUser = authService.getCurrentUser();
    setUser(currentUser);
    setLoading(false);
  }, []);

  const login = async (identifier, password) => {
    const loggedInUser = await authService.login(identifier, password);
    setUser(loggedInUser);
    broadcast({ type: 'login', user: loggedInUser });
    return loggedInUser;
  };

  const logout = async () => {
    await authService.logout();
    setUser(null);
    broadcast({ type: 'logout' });
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, setUser }}>
      {children}
    </AuthContext.Provider>
  );
};
