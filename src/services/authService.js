import { supabase } from '../lib/supabase';
import { db } from './mockDatabase';
import { ROLES, defaultUsers } from '../data/seedData';

export const authService = {
  getCurrentUser() {
    try {
      const stored = localStorage.getItem('seatsync_session');
      if (!stored) return null;
      return JSON.parse(stored);
    } catch {
      return null;
    }
  },

  async login(identifier, password) {
    const cleanId = String(identifier || '').trim().toLowerCase();
    const cleanPass = String(password || '').trim();

    // 1. Attempt Supabase Auth login if email provided
    if (cleanId.includes('@')) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanId,
        password: cleanPass
      });

      if (!error && data.user) {
        // Fetch profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();

        if (profile) {
          if (profile.status === 'blocked' || profile.status === 'suspended') {
            await supabase.auth.signOut();
            throw new Error(`Your account has been ${profile.status}. Reason: ${profile.blocked_reason || 'Policy violation'}`);
          }

          let mappedRole = profile.role.toUpperCase();
          if (mappedRole === 'SUPER_ADMIN') mappedRole = 'ADMIN';
          if (mappedRole === 'SENIOR_LIBRARIAN') mappedRole = 'LIBRARIAN';

          const sessionUser = {
            id: profile.id,
            name: profile.full_name,
            email: profile.email,
            collegeId: profile.registration_number,
            staffId: profile.registration_number,
            identifier: profile.registration_number || cleanId,
            role: mappedRole,
            status: profile.status.toUpperCase(),
            noShowCount: profile.no_show_count || 0
          };

          localStorage.setItem('seatsync_session', JSON.stringify(sessionUser));
          window.dispatchEvent(new Event('storage'));
          return sessionUser;
        }
      }
    }

    // 2. Fallback to database profile or mock database lookup
    let users = await db.read('seatsync_users');
    if (!users || users.length === 0) {
      users = defaultUsers;
      await db.write('seatsync_users', defaultUsers);
    }

    const user = users.find(u => {
      const matchId = (
        (u.identifier && String(u.identifier).toLowerCase() === cleanId) ||
        (u.collegeId && String(u.collegeId).toLowerCase() === cleanId) ||
        (u.staffId && String(u.staffId).toLowerCase() === cleanId) ||
        (u.adminId && String(u.adminId).toLowerCase() === cleanId) ||
        (u.email && String(u.email).toLowerCase() === cleanId)
      );
      return matchId && u.password === cleanPass;
    });

    if (!user) {
      throw new Error('Invalid college/staff ID or password');
    }

    if (user.status !== 'ACTIVE' && user.status !== 'active') {
      throw new Error('Your account is inactive or restricted. Please contact library administration.');
    }

    let role = user.role;
    if (role === 'STAFF') role = ROLES.LIBRARIAN;

    const sessionUser = {
      ...user,
      role
    };

    localStorage.setItem('seatsync_session', JSON.stringify(sessionUser));
    window.dispatchEvent(new Event('storage'));
    return sessionUser;
  },

  async logout() {
    try {
      await supabase.auth.signOut();
    } catch { /* ignore */ }
    localStorage.removeItem('seatsync_session');
    window.dispatchEvent(new Event('storage'));
  },

  getDashboardRoute(role) {
    switch (role) {
      case ROLES.STUDENT:
        return '/student/dashboard';
      case ROLES.LIBRARIAN:
        return '/librarian/dashboard';
      case ROLES.ADMIN:
        return '/admin/dashboard';
      default:
        return '/unauthorized';
    }
  }
};
