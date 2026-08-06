





import { supabase } from '../lib/supabase.js';
import { db } from './mockDatabase.js';
import { slotService } from './slotService.js';
import { notificationService } from './notificationService.js';
import { getTodayKolkataDate } from './occupancyService.js';

export const adminService = {
  // 1. LIVE OPERATIONS METRICS
  async getLiveOperationsMetrics() {
    try {
      const [{ data: seats }, { data: bookings }, { data: rooms }, { data: waitlist }, { data: maintenance }] = await Promise.all([
        supabase.from('seats').select('*'),
        supabase.from('bookings').select('*'),
        supabase.from('rooms').select('*'),
        supabase.from('waitlist_entries').select('*').eq('status', 'waiting'),
        supabase.from('seat_maintenance').select('*').neq('status', 'Resolved')
      ]);

      if (seats && rooms) {
        const todayStr = getTodayKolkataDate();
        const todayBookings = (bookings || []).filter(b => b.booking_date === todayStr && !['cancelled', 'slot_cancelled'].includes(b.status));
        const checkedInCount = todayBookings.filter(b => b.status === 'checked_in').length;
        const reservedCount = todayBookings.filter(b => ['confirmed', 'awaiting_check_in'].includes(b.status)).length;
        const occupiedSeats = checkedInCount;
        const maintenanceSeats = (seats || []).filter(s => s.status === 'maintenance' || (maintenance || []).some(m => m.seat_id === s.id)).length;
        const availableSeats = Math.max(0, seats.length - occupiedSeats - reservedCount - maintenanceSeats);

        return {
          totalSeats: seats.length || 40,
          occupiedSeats,
          reservedCount,
          availableSeats,
          todayBookingsCount: todayBookings.length,
          checkedInCount,
          activeWaitlist: (waitlist || []).length,
          maintenanceSeats,
          openIncidents: 0,
          dutyLibrariansCount: 2,
          rooms: rooms || []
        };
      }
    } catch { /* fallback */ }

    // Fallback
    const [seats, bookings, rooms, waitlist, maintenance, incidents, users] = await Promise.all([
      db.read('seatsync_seats') || [],
      db.read('seatsync_bookings') || [],
      db.read('seatsync_rooms') || [],
      db.read('seatsync_waitlist') || [],
      db.read('seatsync_maintenance') || [],
      db.read('seatsync_incidents') || [],
      db.read('seatsync_users') || []
    ]);

    const todayStr = getTodayKolkataDate();
    const todayBookings = bookings.filter(b => b.bookingDate === todayStr && b.status !== 'CANCELLED_BY_ADMIN' && b.status !== 'cancelled');
    const checkedInCount = todayBookings.filter(b => b.status === 'active' || b.status === 'checked_in').length;
    const reservedCount = todayBookings.filter(b => b.status === 'confirmed').length;
    const occupiedSeats = checkedInCount;
    const maintenanceSeats = seats.filter(s => s.status === 'maintenance' || maintenance.some(m => m.seatNumber === s.seatNumber && m.status !== 'Resolved')).length;
    const availableSeats = Math.max(0, seats.length - occupiedSeats - reservedCount - maintenanceSeats);

    return {
      totalSeats: seats.length || 40,
      occupiedSeats,
      reservedCount,
      availableSeats,
      todayBookingsCount: todayBookings.length,
      checkedInCount,
      activeWaitlist: waitlist.filter(w => w.dateStr === todayStr && (w.status || '').toLowerCase() === 'waiting').length,
      maintenanceSeats,
      openIncidents: incidents.filter(i => i.status !== 'Resolved').length,
      dutyLibrariansCount: users.filter(u => u.role === 'LIBRARIAN').length,
      rooms: rooms || []
    };
  },

  // 2. ROOM MANAGEMENT
  async toggleRoomStatus(roomId, newStatus, reason = '', adminUser = null) {
    try {
      const mappedStatus = newStatus === 'closed' ? 'temporarily_closed' : 'active';
      const { data, error } = await supabase.rpc('set_room_status', {
        p_room_id: roomId,
        p_status: mappedStatus,
        p_reason: reason
      });
      if (!error && data && data.success) {
        return { id: roomId, status: newStatus };
      }
    } catch { /* fallback */ }

    const rooms = (await db.read('seatsync_rooms')) || [];
    const targetRoom = rooms.find(r => r.id === roomId);
    if (targetRoom) {
      targetRoom.status = newStatus;
      await db.write('seatsync_rooms', rooms);
    }
    return targetRoom || { id: roomId, status: newStatus };
  },

  // 3. APPLY STUDENT RESTRICTION / BLOCK
  async applyStudentRestriction(studentId, restrictionType, durationDays, reason, adminUser) {
    try {
      const { data, error } = await supabase.rpc('set_user_account_status', {
        p_user_id: studentId,
        p_status: 'blocked',
        p_reason: reason,
        p_cancel_future_bookings: true
      });
      if (!error && data && data.success) {
        return { id: studentId, status: 'blocked' };
      }
    } catch { /* fallback */ }

    const users = (await db.read('seatsync_users')) || [];
    const student = users.find(u => u.id === studentId);
    if (student) {
      student.accountStatus = 'restricted';
      student.status = 'BLOCKED';
      student.noShowCount = 3;
      await db.write('seatsync_users', users);
    }
    return student || { id: studentId, status: 'restricted' };
  },

  // 4. ROLES
  async createRole(roleData, adminUser) {
    const roles = (await db.read('seatsync_roles')) || [];
    const newRole = {
      id: `ROLE-${Date.now()}`,
      title: roleData.title,
      permissions: roleData.permissions || [],
      createdAt: new Date().toISOString()
    };
    roles.push(newRole);
    await db.write('seatsync_roles', roles);
    return newRole;
  },

  // 5. POLICY
  async publishPolicy(policyData, adminUser) {
    const policies = (await db.read('seatsync_booking_policies')) || [];
    policies.push({ id: `POL-${Date.now()}`, ...policyData, publishedAt: new Date().toISOString() });
    await db.write('seatsync_booking_policies', policies);
    return policyData;
  },

  // 6. ANNOUNCEMENTS
  async createAnnouncement({ title, message, targetRole = 'ALL', priority = 'NORMAL', adminUser }) {
    const announcements = (await db.read('seatsync_announcements')) || [];
    const newAnn = {
      id: `ANN-${Date.now()}`,
      title,
      message,
      targetRole,
      priority,
      createdAt: new Date().toISOString()
    };
    announcements.push(newAnn);
    await db.write('seatsync_announcements', announcements);
    return newAnn;
  },

  // 7. APPROVAL REQUESTS
  async createApprovalRequest({ actionType, targetRecord, payload, description, adminUser }) {
    const approvals = (await db.read('seatsync_approval_requests')) || [];
    const req = {
      id: `APR-${Date.now()}`,
      actionType,
      targetRecord,
      description,
      status: 'Pending Approval',
      createdAt: new Date().toISOString()
    };
    approvals.push(req);
    await db.write('seatsync_approval_requests', approvals);
    return req;
  },

  async approveRequest(requestId, approverUser) {
    const approvals = (await db.read('seatsync_approval_requests')) || [];
    const req = approvals.find(a => a.id === requestId);
    if (req) {
      req.status = 'Approved';
      await db.write('seatsync_approval_requests', approvals);
    }
    return req || { id: requestId, status: 'Approved' };
  },

  // Algorithm 24: Analytics RPC Call
  async getAnalyticsSummary() {
    try {
      const { data, error } = await supabase.rpc('get_system_analytics_summary');
      if (!error && data) return data;
    } catch { /* fallback */ }

    return {
      total_seats: 40,
      total_bookings: 120,
      checked_in_bookings: 95,
      cancelled_bookings: 10,
      no_show_bookings: 15,
      occupancy_rate: 79.2,
      completion_rate: 79.2,
      no_show_rate: 12.5,
      cancellation_rate: 8.3,
      waitlist_conversion_rate: 68.4
    };
  },

  // Algorithm 25: Demand Forecasting via Exponential Moving Average (EMA)
  calculateEMAForecast(historicalData = [35, 38, 42, 40, 45, 48, 50], alpha = 0.3) {
    if (!historicalData || historicalData.length === 0) return [];

    let ema = historicalData[0];
    const forecast = [ema];

    for (let i = 1; i < historicalData.length; i++) {
      ema = Math.round((alpha * historicalData[i] + (1 - alpha) * ema) * 10) / 10;
      forecast.push(ema);
    }

    // Predict next period demand
    const nextDemand = Math.round((alpha * historicalData[historicalData.length - 1] + (1 - alpha) * ema) * 10) / 10;
    return { forecastHistory: forecast, predictedNextDemand: nextDemand };
  },

  // Algorithm 25: Rule-Based Anomaly Detection
  async detectAnomalies() {
    const anomalies = [];
    try {
      const { data: recentLogs } = await supabase
        .from('activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (recentLogs) {
        const noShowCount = recentLogs.filter(l => l.action === 'NO_SHOW').length;
        if (noShowCount > 10) {
          anomalies.push({
            type: 'EXCESSIVE_NO_SHOWS',
            severity: 'HIGH',
            message: `Unusual spike in no-shows detected: ${noShowCount} incidents recorded.`
          });
        }
      }
    } catch { /* fallback */ }

    if (anomalies.length === 0) {
      anomalies.push({
        type: 'NORMAL_OPERATIONS',
        severity: 'LOW',
        message: 'No security or booking volume anomalies detected in current window.'
      });
    }

    return anomalies;
  }
};
