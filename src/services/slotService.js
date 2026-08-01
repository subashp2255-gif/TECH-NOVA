import { db } from './mockDatabase';
import { notificationService } from './notificationService';

export const slotService = {
  async getDisabledOccurrences() {
    const disabled = (await db.read('seatsync_disabled_slots')) || [];
    return disabled;
  },

  async getDisabledState(slotId, dateStr) {
    const disabledList = (await db.read('seatsync_disabled_slots')) || [];
    return disabledList.find(d => 
      d.slotId === slotId && 
      (d.scope === 'ALL_FUTURE' || d.date === dateStr || (d.startDate <= dateStr && d.endDate >= dateStr))
    );
  },

  async getSlotImpactAnalysis({ slotId, dateStr, scope = 'SELECTED_DATE', startDate, endDate }) {
    const bookings = (await db.read('seatsync_bookings')) || [];
    const waitlist = (await db.read('seatsync_waitlist')) || [];

    const isMatch = (bDate) => {
      if (scope === 'SELECTED_DATE') return bDate === dateStr;
      if (scope === 'DATE_RANGE') return bDate >= startDate && bDate <= endDate;
      if (scope === 'ALL_FUTURE') return bDate >= dateStr;
      return bDate === dateStr;
    };

    const affectedBookings = bookings.filter(b => 
      b.slotId === slotId && 
      isMatch(b.bookingDate) && 
      b.status !== 'cancelled' && 
      b.status !== 'CANCELLED_BY_STUDENT' && 
      b.status !== 'CANCELLED_BY_ADMIN'
    );

    const affectedWaitlist = waitlist.filter(w => 
      w.slotId === slotId && 
      isMatch(w.dateStr) && 
      (w.status || '').toLowerCase() === 'waiting'
    );

    const activeSessions = affectedBookings.filter(b => b.status === 'active' || b.status === 'checked_in');

    return {
      affectedBookingsCount: affectedBookings.length,
      affectedWaitlistCount: affectedWaitlist.length,
      activeSessionsCount: activeSessions.length,
      affectedBookings,
      affectedWaitlist,
      activeSessions
    };
  },

  async disableSlotOccurrence({
    slotId,
    slotName,
    dateStr,
    scope = 'SELECTED_DATE',
    startDate,
    endDate,
    reason,
    customMessage,
    adminUser,
    isEmergency = false
  }) {
    const disabledList = (await db.read('seatsync_disabled_slots')) || [];
    const bookings = (await db.read('seatsync_bookings')) || [];
    const waitlist = (await db.read('seatsync_waitlist')) || [];
    const logs = (await db.read('seatsync_activity_logs')) || [];

    const isMatch = (bDate) => {
      if (scope === 'SELECTED_DATE') return bDate === dateStr;
      if (scope === 'DATE_RANGE') return bDate >= startDate && bDate <= endDate;
      if (scope === 'ALL_FUTURE') return bDate >= dateStr;
      return bDate === dateStr;
    };

    const effectiveReason = reason === 'Other' ? customMessage : reason;
    const nowIso = new Date().toISOString();

    // Idempotency check
    const existingIndex = disabledList.findIndex(d => 
      d.slotId === slotId && 
      (scope === 'ALL_FUTURE' ? d.scope === 'ALL_FUTURE' : d.date === dateStr)
    );

    const newDisabledRecord = {
      id: `DIS-${Date.now()}`,
      slotId,
      slotName,
      date: dateStr,
      scope,
      startDate: startDate || dateStr,
      endDate: endDate || dateStr,
      reason: effectiveReason,
      customMessage: customMessage || '',
      disabledAt: nowIso,
      disabledBy: adminUser?.name || 'Administrator',
      disabledById: adminUser?.id || 'ADM-001',
      status: 'DISABLED'
    };

    if (existingIndex !== -1) {
      disabledList[existingIndex] = newDisabledRecord;
    } else {
      disabledList.push(newDisabledRecord);
    }
    await db.write('seatsync_disabled_slots', disabledList);

    // Cancel affected confirmed bookings
    let cancelledBookingCount = 0;
    const notifiedUserIds = new Set();

    bookings.forEach(b => {
      if (b.slotId === slotId && isMatch(b.bookingDate)) {
        if (b.status === 'confirmed' || b.status === 'pending') {
          b.status = 'CANCELLED_BY_ADMIN';
          b.cancelledAt = nowIso;
          b.cancelledBy = 'ADMIN';
          b.cancellationReason = effectiveReason;
          cancelledBookingCount++;

          if (b.studentId && !notifiedUserIds.has(b.studentId)) {
            notifiedUserIds.add(b.studentId);
            notificationService.addNotification({
              userId: b.studentId,
              title: 'Library Slot Cancelled',
              message: `${b.slotTime || slotName} on ${b.bookingDate} has been cancelled by the library due to: ${effectiveReason}. This will not affect your booking standing.`
            });
          }
        } else if (b.status === 'active' && isEmergency) {
          b.status = 'ENDED_BY_ADMIN';
          b.endedAt = nowIso;
          b.endedReason = effectiveReason;
          cancelledBookingCount++;

          if (b.studentId && !notifiedUserIds.has(b.studentId)) {
            notifiedUserIds.add(b.studentId);
            notificationService.addNotification({
              userId: b.studentId,
              title: 'Emergency Session Ended',
              message: `Your active session for ${b.slotTime || slotName} was ended due to: ${effectiveReason}. Please coordinate with staff.`
            });
          }
        }
      }
    });
    await db.write('seatsync_bookings', bookings);

    // Close waitlist entries
    let cancelledWaitlistCount = 0;
    waitlist.forEach(w => {
      if (w.slotId === slotId && isMatch(w.dateStr) && (w.status || '').toLowerCase() === 'waiting') {
        w.status = 'CANCELLED_BY_ADMIN';
        w.closedAt = nowIso;
        w.closeReason = effectiveReason;
        cancelledWaitlistCount++;

        if (w.studentId && !notifiedUserIds.has(w.studentId)) {
          notifiedUserIds.add(w.studentId);
          notificationService.addNotification({
            userId: w.studentId,
            title: 'Waiting List Closed',
            message: `The waiting list for ${slotName} on ${w.dateStr} was closed because the library disabled this slot (${effectiveReason}).`
          });
        }
      }
    });
    await db.write('seatsync_waitlist', waitlist);

    // Record audit log
    logs.unshift({
      id: `LOG-${Date.now()}`,
      action: 'SLOT_DISABLED',
      actorId: adminUser?.id || 'ADM-001',
      actorName: adminUser?.name || 'Administrator',
      actorRole: 'ADMIN',
      slotId,
      slotName,
      scope,
      affectedDate: dateStr,
      reason: effectiveReason,
      cancelledBookingCount,
      cancelledWaitlistCount,
      timestamp: nowIso
    });
    await db.write('seatsync_activity_logs', logs);

    return {
      success: true,
      cancelledBookingCount,
      cancelledWaitlistCount,
      notifiedStudentsCount: notifiedUserIds.size
    };
  },

  async enableSlotOccurrence({ slotId, slotName, dateStr, adminUser }) {
    const disabledList = (await db.read('seatsync_disabled_slots')) || [];
    const logs = (await db.read('seatsync_activity_logs')) || [];

    const updatedList = disabledList.filter(d => 
      !(d.slotId === slotId && (d.date === dateStr || d.scope === 'ALL_FUTURE'))
    );
    await db.write('seatsync_disabled_slots', updatedList);

    const nowIso = new Date().toISOString();
    logs.unshift({
      id: `LOG-${Date.now()}`,
      action: 'SLOT_ENABLED',
      actorId: adminUser?.id || 'ADM-001',
      actorName: adminUser?.name || 'Administrator',
      actorRole: 'ADMIN',
      slotId,
      slotName,
      affectedDate: dateStr,
      timestamp: nowIso
    });
    await db.write('seatsync_activity_logs', logs);

    return {
      success: true,
      message: `${slotName || 'Slot'} enabled successfully. New bookings are now available.`
    };
  }
};
