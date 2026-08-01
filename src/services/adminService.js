import { db } from './mockDatabase';
import { slotService } from './slotService';
import { notificationService } from './notificationService';

export const adminService = {
  // 1. LIVE OPERATIONS METRICS
  async getLiveOperationsMetrics() {
    const [seats, bookings, rooms, waitlist, maintenance, incidents, users] = await Promise.all([
      db.read('seatsync_seats') || [],
      db.read('seatsync_bookings') || [],
      db.read('seatsync_rooms') || [],
      db.read('seatsync_waitlist') || [],
      db.read('seatsync_maintenance') || [],
      db.read('seatsync_incidents') || [],
      db.read('seatsync_users') || []
    ]);

    const todayStr = new Date().toISOString().split('T')[0];
    const todayBookings = bookings.filter(b => b.bookingDate === todayStr && b.status !== 'CANCELLED_BY_ADMIN' && b.status !== 'cancelled');
    const checkedInCount = todayBookings.filter(b => b.status === 'active' || b.status === 'checked_in').length;
    const occupiedSeats = checkedInCount;
    const maintenanceSeats = seats.filter(s => s.status === 'maintenance' || maintenance.some(m => m.seatNumber === s.seatNumber && m.status !== 'Resolved')).length;
    const availableSeats = Math.max(0, seats.length - occupiedSeats - maintenanceSeats);
    const activeWaitlist = waitlist.filter(w => w.dateStr === todayStr && (w.status || '').toLowerCase() === 'waiting').length;
    const openIncidents = incidents.filter(i => i.status !== 'Resolved').length;
    const dutyLibrarians = users.filter(u => u.role === 'LIBRARIAN');

    return {
      totalSeats: seats.length || 40,
      occupiedSeats,
      availableSeats,
      todayBookingsCount: todayBookings.length,
      checkedInCount,
      activeWaitlist,
      maintenanceSeats,
      openIncidents,
      dutyLibrariansCount: dutyLibrarians.length,
      rooms: rooms || []
    };
  },

  // 2. ROOM MANAGEMENT & EMERGENCY CLOSURE
  async toggleRoomStatus(roomId, newStatus, reason = '', adminUser = null) {
    const rooms = (await db.read('seatsync_rooms')) || [];
    const targetRoom = rooms.find(r => r.id === roomId);
    if (!targetRoom) throw new Error('Room record not found.');

    targetRoom.status = newStatus;
    if (reason) targetRoom.closureReason = reason;
    await db.write('seatsync_rooms', rooms);

    // If closing room, update seats
    const seats = (await db.read('seatsync_seats')) || [];
    seats.forEach(s => {
      if (s.roomId === roomId || s.floorName === targetRoom.floor) {
        s.status = newStatus === 'closed' ? 'maintenance' : 'available';
      }
    });
    await db.write('seatsync_seats', seats);

    await this.logAudit({
      userName: adminUser?.name || 'Administrator',
      action: newStatus === 'closed' ? 'ROOM_CLOSED' : 'ROOM_REOPENED',
      affectedRecord: `Room ${targetRoom.name} (${targetRoom.id})`,
      result: 'SUCCESS',
      notes: reason ? `Reason: ${reason}` : 'Room status toggled'
    });

    return targetRoom;
  },

  // 3. ROLES & PERMISSIONS
  async createRole(roleData, adminUser) {
    const roles = (await db.read('seatsync_roles')) || [];
    const newRole = {
      id: `ROLE-${Date.now()}`,
      title: roleData.title,
      isSystem: false,
      permissions: roleData.permissions || [],
      createdBy: adminUser?.name || 'Admin',
      createdAt: new Date().toISOString()
    };
    roles.push(newRole);
    await db.write('seatsync_roles', roles);

    await this.logAudit({
      userName: adminUser?.name || 'Administrator',
      action: 'ROLE_CREATED',
      affectedRecord: `Role ${newRole.title}`,
      result: 'SUCCESS',
      notes: `Created custom role with ${newRole.permissions.length} permissions`
    });

    return newRole;
  },

  // 4. BOOKING RULES & POLICIES
  async publishPolicy(policyData, adminUser) {
    const policies = (await db.read('seatsync_booking_policies')) || [];
    // Mark previous unpublished
    policies.forEach(p => p.isPublished = false);

    const newPolicy = {
      id: `POL-${Date.now()}`,
      ...policyData,
      isPublished: true,
      publishedBy: adminUser?.name || 'Administrator',
      publishedAt: new Date().toISOString()
    };

    policies.push(newPolicy);
    await db.write('seatsync_booking_policies', policies);

    await this.logAudit({
      userName: adminUser?.name || 'Administrator',
      action: 'POLICY_PUBLISHED',
      affectedRecord: `Policy ${newPolicy.title}`,
      result: 'SUCCESS',
      notes: `Max active: ${newPolicy.maxActiveBookings}, Grace: ${newPolicy.gracePeriodMins} mins`
    });

    return newPolicy;
  },

  // 5. ANNOUNCEMENTS
  async createAnnouncement({ title, message, targetRole = 'ALL', priority = 'NORMAL', adminUser }) {
    const announcements = (await db.read('seatsync_announcements')) || [];
    const newAnn = {
      id: `ANN-${Date.now()}`,
      title,
      message,
      targetRole,
      priority,
      createdBy: adminUser?.name || 'Administrator',
      createdAt: new Date().toISOString()
    };

    announcements.push(newAnn);
    await db.write('seatsync_announcements', announcements);

    // Also dispatch notification to all target users
    const users = (await db.read('seatsync_users')) || [];
    const targetUsers = targetRole === 'ALL' ? users : users.filter(u => u.role === targetRole);

    for (const u of targetUsers) {
      await notificationService.addNotification({
        userId: u.id,
        type: 'SYSTEM_ANNOUNCEMENT',
        title: `[ANNOUNCEMENT] ${title}`,
        message,
        priority
      });
    }

    await this.logAudit({
      userName: adminUser?.name || 'Administrator',
      action: 'ANNOUNCEMENT_BROADCAST',
      affectedRecord: `Announcement ${newAnn.id}`,
      result: 'SUCCESS',
      notes: `Broadcasted to ${targetUsers.length} users`
    });

    return newAnn;
  },

  // 6. PENALTIES & RESTRICTIONS
  async applyStudentRestriction(studentId, restrictionType, durationDays, reason, adminUser) {
    const users = (await db.read('seatsync_users')) || [];
    const student = users.find(u => u.id === studentId);
    if (!student) throw new Error('Student account not found.');

    student.accountStatus = 'restricted';
    student.restrictionReason = reason;
    student.restrictedUntil = new Date(Date.now() + (durationDays * 24 * 60 * 60 * 1000)).toISOString();
    await db.write('seatsync_users', users);

    const penalties = (await db.read('seatsync_penalties')) || [];
    penalties.push({
      id: `PEN-${Date.now()}`,
      studentId: student.id,
      studentName: student.name,
      restrictionType,
      durationDays,
      reason,
      appliedBy: adminUser?.name || 'Administrator',
      appliedAt: new Date().toISOString()
    });
    await db.write('seatsync_penalties', penalties);

    await notificationService.addNotification({
      userId: student.id,
      type: 'ACCOUNT_RESTRICTED',
      title: 'Account Booking Restriction Applied',
      message: `Your booking privileges have been restricted for ${durationDays} days due to: ${reason}`,
      priority: 'URGENT'
    });

    await this.logAudit({
      userName: adminUser?.name || 'Administrator',
      action: 'STUDENT_RESTRICTED',
      affectedRecord: `Student ${student.name} (${student.id})`,
      result: 'SUCCESS',
      notes: `Restricted for ${durationDays} days: ${reason}`
    });

    return student;
  },

  // 7. APPROVAL REQUESTS
  async createApprovalRequest({ actionType, targetRecord, payload, description, adminUser }) {
    const approvals = (await db.read('seatsync_approval_requests')) || [];
    const req = {
      id: `APR-${Date.now()}`,
      actionType,
      targetRecord,
      payload,
      description,
      requesterName: adminUser?.name || 'Administrator',
      createdAt: new Date().toISOString(),
      status: 'Pending Approval'
    };

    approvals.push(req);
    await db.write('seatsync_approval_requests', approvals);
    return req;
  },

  async approveRequest(requestId, approverUser) {
    const approvals = (await db.read('seatsync_approval_requests')) || [];
    const req = approvals.find(a => a.id === requestId);
    if (!req) throw new Error('Approval request not found.');

    if (req.requesterName === approverUser?.name) {
      throw new Error('Four-eye principle violation: Requester cannot approve their own high-risk action.');
    }

    req.status = 'Approved';
    req.approverName = approverUser?.name || 'Senior Admin';
    req.approvedAt = new Date().toISOString();
    await db.write('seatsync_approval_requests', approvals);

    await this.logAudit({
      userName: approverUser?.name || 'Administrator',
      action: 'ACTION_APPROVED',
      affectedRecord: `Approval ${requestId} (${req.actionType})`,
      result: 'SUCCESS',
      notes: `Approved high-impact action: ${req.description}`
    });

    return req;
  },

  // 8. LOG AUDIT HELPER
  async logAudit({ userName, action, affectedRecord, result = 'SUCCESS', notes = '' }) {
    try {
      const logs = (await db.read('seatsync_activity_logs')) || [];
      logs.push({
        id: `LOG-${Date.now()}`,
        userName: userName || 'Admin',
        userRole: 'ADMIN',
        action,
        affectedRecord,
        result,
        timestamp: new Date().toISOString(),
        notes
      });
      await db.write('seatsync_activity_logs', logs);
    } catch (err) {
      console.warn('Failed to log admin audit entry:', err);
    }
  }
};
