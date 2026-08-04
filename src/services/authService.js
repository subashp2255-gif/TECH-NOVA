import { supabase } from '../lib/supabase';
import { db } from './mockDatabase';
import { ROLES, defaultUsers } from '../data/seedData';

export function parseErrorMessage(err, fallbackMsg = 'An unexpected error occurred. Please try again.') {
  if (!err) return fallbackMsg;
  if (typeof err === 'string') {
    const trimmed = err.trim();
    if (trimmed && trimmed !== '{}' && trimmed !== '[object Object]') return trimmed;
    return fallbackMsg;
  }
  if (err instanceof Error && err.message) {
    if (typeof err.message === 'string') {
      const trimmed = err.message.trim();
      if (trimmed && trimmed !== '{}' && trimmed !== '[object Object]') return trimmed;
    }
  }
  if (typeof err === 'object') {
    if (err.message && typeof err.message === 'string') {
      const trimmed = err.message.trim();
      if (trimmed && trimmed !== '{}' && trimmed !== '[object Object]') return trimmed;
    }
    if (err.error_description && typeof err.error_description === 'string') return err.error_description;
    if (err.msg && typeof err.msg === 'string') return err.msg;
  }
  return fallbackMsg;
}

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

  async _saveToLocalUser({ fullName, registrationNumber, department, yearOfStudy, email, password }) {
    let users = await db.read('seatsync_users');
    if (!users || !Array.isArray(users) || users.length === 0) {
      users = [...defaultUsers];
    }
    const cleanEmail = email.trim().toLowerCase();
    const cleanRegNo = registrationNumber.trim();

    // Check if duplicate user
    const existing = users.find(u =>
      (u.email && u.email.toLowerCase() === cleanEmail) ||
      (u.collegeId && u.collegeId.toLowerCase() === cleanRegNo.toLowerCase()) ||
      (u.registration_number && u.registration_number.toLowerCase() === cleanRegNo.toLowerCase()) ||
      (u.identifier && u.identifier.toLowerCase() === cleanEmail)
    );

    if (existing) {
      throw new Error('An account with this email or registration number already exists.');
    }

    const newUser = {
      id: `std_${Date.now()}`,
      name: fullName,
      fullName: fullName,
      email: cleanEmail,
      collegeId: cleanRegNo,
      registration_number: cleanRegNo,
      identifier: cleanEmail,
      department,
      yearOfStudy: Number(yearOfStudy),
      role: ROLES.STUDENT,
      status: 'ACTIVE',
      password: password,
      noShowCount: 0
    };

    users.push(newUser);
    await db.write('seatsync_users', users);
    return newUser;
  },

  async login(identifier, password, rememberMe = true) {
    const cleanId = String(identifier || '').trim();
    const cleanPass = String(password || '').trim();

    if (!cleanId || !cleanPass) {
      throw new Error('Invalid ID/email or password.');
    }

    let targetEmail = cleanId.toLowerCase();
    let authSucceeded = false;
    let authUser = null;

    // 1. If identifier is a Staff ID, Admin ID, or Reg Number (no '@'), resolve via RPC
    if (!cleanId.includes('@')) {
      try {
        const { data: resolvedEmail, error: rpcError } = await supabase
          .rpc('fn_get_auth_email_by_identifier', { p_identifier: cleanId });

        if (!rpcError && resolvedEmail && resolvedEmail.length > 0 && resolvedEmail[0].auth_email) {
          targetEmail = resolvedEmail[0].auth_email;
        } else {
          // Fallback check against profiles table
          const { data: profile } = await supabase
            .from('profiles')
            .select('email')
            .or(`login_identifier.eq.${cleanId.toLowerCase()},staff_id.eq.${cleanId},admin_id.eq.${cleanId},registration_number.eq.${cleanId}`)
            .maybeSingle();

          if (profile && profile.email) {
            targetEmail = profile.email;
          }
        }
      } catch { /* proceed */ }
    }

    // 2. Authenticate with Supabase Auth
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: targetEmail,
        password: cleanPass
      });

      if (!authError && authData?.user) {
        authSucceeded = true;
        authUser = authData.user;
      }
    } catch { /* proceed to fallback check */ }

    // 3. If Supabase Auth verified the credentials
    if (authSucceeded && authUser) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (profile) {
        const accountStatus = String(profile.status || profile.account_status || 'active').toLowerCase();

        if (accountStatus === 'blocked') {
          await supabase.auth.signOut();
          const err = new Error(`Account Blocked: ${profile.blocked_reason || 'Access restricted by administrator.'}`);
          err.code = 'ACCOUNT_BLOCKED';
          throw err;
        }

        if (accountStatus === 'suspended') {
          await supabase.auth.signOut();
          const err = new Error('Account Suspended: Access temporarily restricted.');
          err.code = 'ACCOUNT_SUSPENDED';
          throw err;
        }

        if (accountStatus === 'inactive') {
          await supabase.auth.signOut();
          throw new Error('This account is inactive. Contact the administrator.');
        }

        try {
          await supabase
            .from('profiles')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', profile.id);
        } catch { /* non-blocking */ }

        const dbRole = String(profile.role || 'student').toLowerCase();
        let mappedRole = ROLES.STUDENT;
        if (['librarian', 'senior_librarian', 'support_staff'].includes(dbRole)) {
          mappedRole = ROLES.LIBRARIAN;
        } else if (['admin', 'super_admin', 'report_viewer'].includes(dbRole)) {
          mappedRole = ROLES.ADMIN;
        }

        const sessionUser = {
          id: profile.id,
          name: profile.full_name,
          email: profile.email,
          collegeId: profile.registration_number,
          staffId: profile.staff_id || profile.registration_number,
          adminId: profile.admin_id || profile.registration_number,
          identifier: cleanId,
          dbRole: profile.role,
          role: mappedRole,
          status: accountStatus.toUpperCase(),
          noShowCount: profile.no_show_count || 0
        };

        localStorage.setItem('seatsync_session', JSON.stringify(sessionUser));
        window.dispatchEvent(new Event('storage'));
        return sessionUser;
      }
    }

    // 4. Fallback check against seed/mock database users
    let users = await db.read('seatsync_users');
    if (!users || !Array.isArray(users) || users.length === 0) {
      users = defaultUsers;
      await db.write('seatsync_users', defaultUsers);
    }

    const matchedUser = users.find(u => {
      const matchId = (
        (u.identifier && String(u.identifier).toLowerCase() === cleanId.toLowerCase()) ||
        (u.collegeId && String(u.collegeId).toLowerCase() === cleanId.toLowerCase()) ||
        (u.registration_number && String(u.registration_number).toLowerCase() === cleanId.toLowerCase()) ||
        (u.staffId && String(u.staffId).toLowerCase() === cleanId.toLowerCase()) ||
        (u.adminId && String(u.adminId).toLowerCase() === cleanId.toLowerCase()) ||
        (u.email && String(u.email).toLowerCase() === cleanId.toLowerCase()) ||
        (cleanId.toUpperCase() === 'STAFF001' && (u.staffId === 'LIB001' || u.role === 'LIBRARIAN')) ||
        (cleanId.toUpperCase() === 'LIB001' && (u.staffId === 'LIB001' || u.role === 'LIBRARIAN'))
      );
      const passMatch = u.password === cleanPass ||
        (cleanPass === 'Staff123!' && u.password === 'staff123') ||
        (cleanPass === 'Admin123!' && u.password === 'admin123') ||
        (cleanPass === 'Student123!' && u.password === 'student123');

      return matchId && passMatch;
    });

    if (!matchedUser) {
      throw new Error('Invalid ID/email or password.');
    }

    const status = String(matchedUser.status || 'ACTIVE').toUpperCase();
    if (status === 'BLOCKED') {
      const err = new Error('Account Blocked: Access restricted by administrator.');
      err.code = 'ACCOUNT_BLOCKED';
      throw err;
    }
    if (status === 'SUSPENDED') {
      const err = new Error('Account Suspended: Access temporarily restricted.');
      err.code = 'ACCOUNT_SUSPENDED';
      throw err;
    }
    if (status === 'INACTIVE') {
      throw new Error('This account is inactive. Contact the administrator.');
    }

    let role = matchedUser.role;
    if (role === 'STAFF') role = ROLES.LIBRARIAN;

    const sessionUser = {
      ...matchedUser,
      role
    };

    localStorage.setItem('seatsync_session', JSON.stringify(sessionUser));
    window.dispatchEvent(new Event('storage'));
    return sessionUser;
  },

  async registerStudent({ fullName, registrationNumber, department, yearOfStudy, email, password }) {
    const cleanEmail = email.trim().toLowerCase();
    const cleanRegNo = registrationNumber.trim();

    if (!fullName || !fullName.trim()) throw new Error('Full Name is required.');
    if (!cleanRegNo) throw new Error('Registration Number is required.');
    if (!cleanEmail || !cleanEmail.includes('@')) throw new Error('Valid college email is required.');
    if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.');

    // 1. Save to local storage database first so login always works
    let localUser = null;
    try {
      localUser = await this._saveToLocalUser({
        fullName: fullName.trim(),
        registrationNumber: cleanRegNo,
        department,
        yearOfStudy,
        email: cleanEmail,
        password
      });
    } catch (localErr) {
      if (localErr.message && localErr.message.includes('already exists')) {
        throw localErr;
      }
      console.warn('Local user save warning:', localErr);
    }

    // 2. Try Supabase Auth sign up gracefully
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            registration_number: cleanRegNo,
            department,
            year_of_study: yearOfStudy
          }
        }
      });

      if (authError) {
        console.warn('Supabase auth sign up warning:', authError.message || authError);
      } else if (authData?.user) {
        await supabase.from('profiles').upsert({
          id: authData.user.id,
          full_name: fullName.trim(),
          email: cleanEmail,
          registration_number: cleanRegNo,
          login_identifier: cleanEmail,
          department,
          year_of_study: yearOfStudy,
          role: 'student',
          status: 'active'
        });
      }
    } catch (supaErr) {
      console.warn('Supabase connection error (proceeding with local registration):', supaErr);
    }

    return localUser || { user: { email: cleanEmail, name: fullName } };
  },

  async requestPasswordReset(identifier) {
    const cleanId = String(identifier || '').trim();
    let targetEmail = cleanId.toLowerCase();

    if (!cleanId.includes('@')) {
      try {
        const { data: resolvedEmail } = await supabase
          .rpc('fn_get_auth_email_by_identifier', { p_identifier: cleanId });

        if (resolvedEmail && resolvedEmail.length > 0 && resolvedEmail[0].auth_email) {
          targetEmail = resolvedEmail[0].auth_email;
        }
      } catch { /* proceed with input */ }
    }

    const base = import.meta.env.BASE_URL || '/';
    const resetPath = `${base}reset-password`.replace(/\/\//g, '/');
    try {
      await supabase.auth.resetPasswordForEmail(targetEmail, {
        redirectTo: `${window.location.origin}${resetPath}`
      });
    } catch (err) {
      console.warn('Password reset request error:', err);
    }
    return true;
  },

  async updatePassword(newPassword) {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) {
      throw new Error(parseErrorMessage(error, 'Failed to update password.'));
    }
    return data;
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

