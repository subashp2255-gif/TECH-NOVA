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
    let users = await db.read('seatsync_users');
    if (!users || users.length === 0) {
      users = defaultUsers;
      await db.write('seatsync_users', defaultUsers);
    }

    const cleanId = String(identifier || '').trim().toLowerCase();
    const cleanPass = String(password || '').trim();

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

    if (user.status !== 'ACTIVE') {
      throw new Error('Your account is inactive or restricted. Please contact library administration.');
    }

    // Normalize role (STAFF -> LIBRARIAN)
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
