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

  // Listen to Supabase Auth State and Profile Block Status
  useEffect(() => {
    const currentUser = authService.getCurrentUser();
    setUser(currentUser);
    setLoading(false);

    // Subscribe to Auth changes
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (profile) {
          if (profile.status === 'blocked' || profile.status === 'suspended') {
            toast.error(`Account ${profile.status.toUpperCase()}: ${profile.blocked_reason || 'Access revoked'}`);
            await authService.logout();
            setUser(null);
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

  // Realtime listener for active user status updates (e.g. Admin blocks user live)
  useEffect(() => {
    if (!user?.id) return;

    const profileChannel = supabase
      .channel(`profile-status-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        async (payload) => {
          const updatedProfile = payload.new;
          if (updatedProfile.status === 'blocked' || updatedProfile.status === 'suspended') {
            toast.error(`ALERT: Your account was ${updatedProfile.status.toUpperCase()} by an administrator. Reason: ${updatedProfile.blocked_reason || 'Policy Violation'}`);
            await authService.logout();
            setUser(null);
            window.location.href = '/login';
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
    };
  }, [user?.id]);

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
