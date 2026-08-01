import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { authService } from '../services/authService';
import { useSync } from '../hooks/useSync';
import toast from 'react-hot-toast';

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

  // Rehydrate initial user & subscribe to Supabase Auth state
  useEffect(() => {
    const currentUser = authService.getCurrentUser();
    setUser(currentUser);
    setLoading(false);

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (profile) {
          const status = String(profile.status || profile.account_status || 'active').toLowerCase();
          if (status === 'blocked' || status === 'suspended') {
            await authService.logout();
            setUser(null);
            window.location.href = status === 'blocked' ? '/account-blocked' : '/account-suspended';
            return;
          }
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  // Realtime subscription to profiles table for live ejection on admin block/suspend
  useEffect(() => {
    if (!user?.id) return;

    const profileChannel = supabase
      .channel(`profile-eject-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        async (payload) => {
          const updated = payload.new;
          const status = String(updated.status || updated.account_status || 'active').toLowerCase();

          if (status === 'blocked' || status === 'suspended') {
            toast.error(`ALERT: Your account was ${status.toUpperCase()} by an administrator.`);
            await authService.logout();
            setUser(null);
            window.location.href = status === 'blocked' ? '/account-blocked' : '/account-suspended';
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
    };
  }, [user?.id]);

  const login = async (identifier, password, rememberMe = true) => {
    try {
      const loggedInUser = await authService.login(identifier, password, rememberMe);
      setUser(loggedInUser);
      broadcast({ type: 'login', user: loggedInUser });
      return loggedInUser;
    } catch (err) {
      if (err.code === 'ACCOUNT_BLOCKED') {
        window.location.href = '/account-blocked';
      } else if (err.code === 'ACCOUNT_SUSPENDED') {
        window.location.href = '/account-suspended';
      }
      throw err;
    }
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
