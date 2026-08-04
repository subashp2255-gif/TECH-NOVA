import { supabase, isUUID } from '../lib/supabase';
import { db } from './mockDatabase';
import { notificationService } from './notificationService';

export const slotService = {
  async getSlotByCode(slotCode) {
    if (!slotCode) return null;
    try {
      if (isUUID(slotCode)) {
        return this.getSlotById(slotCode);
      }
      const { data, error } = await supabase
        .from('slots')
        .select('*')
        .eq('slot_code', slotCode)
        .maybeSingle();

      if (!error && data) return data;
    } catch { /* fallback */ }

    // Local fallback
    const localSlots = (await db.read('seatsync_slots')) || [];
    return localSlots.find(s => s.id === slotCode || s.slot_code === slotCode || s.code === slotCode) || null;
  },

  async getSlotById(slotId) {
    if (!slotId) return null;
    try {
      if (isUUID(slotId)) {
        const { data, error } = await supabase
          .from('slots')
          .select('*')
          .eq('id', slotId)
          .maybeSingle();
        if (!error && data) return data;
      } else {
        return this.getSlotByCode(slotId);
      }
    } catch { /* fallback */ }

    const localSlots = (await db.read('seatsync_slots')) || [];
    return localSlots.find(s => s.id === slotId || s.slot_code === slotId) || null;
  },

  async getDisabledOccurrences() {
    try {
      const { data, error } = await supabase.from('slots').select('*').eq('status', 'disabled');
      if (!error && data) {
        return data.map(s => ({
          slotId: s.id,
          slotName: s.name,
          scope: 'ALL_FUTURE',
          reason: s.cancellation_reason || 'Disabled by admin'
        }));
      }
    } catch { /* fallback */ }
    const disabled = (await db.read('seatsync_disabled_slots')) || [];
    return disabled;
  },

  async getDisabledState(slotId, dateStr) {
    let resolvedSlotId = slotId;
    if (slotId && !isUUID(slotId)) {
      const slotRow = await this.getSlotByCode(slotId);
      if (slotRow?.id) resolvedSlotId = slotRow.id;
    }

    if (isUUID(resolvedSlotId)) {
      try {
        const { data, error } = await supabase.from('slots').select('*').eq('id', resolvedSlotId).maybeSingle();
        if (!error && data && (data.status === 'disabled' || data.status === 'cancelled')) {
          return {
            slotId: data.id,
            reason: data.cancellation_reason || 'Slot disabled by library'
          };
        }
      } catch { /* fallback */ }
    }

    const disabledList = (await db.read('seatsync_disabled_slots')) || [];
    return disabledList.find(d => 
      (d.slotId === slotId || d.slotId === resolvedSlotId) && 
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
      !['cancelled', 'CANCELLED_BY_STUDENT', 'CANCELLED_BY_ADMIN', 'slot_cancelled'].includes(b.status)
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
    const effectiveReason = reason === 'Other' ? customMessage : reason;

    try {
      const { data, error } = await supabase.rpc('disable_slot', {
        p_slot_id: slotId,
        p_reason: effectiveReason || 'Disabled by library administrator'
      });
      if (!error && data && data.success) {
        return {
          success: true,
          cancelledBookingCount: data.affected_bookings || 0,
          cancelledWaitlistCount: 0,
          notifiedStudentsCount: data.affected_bookings || 0
        };
      }
    } catch { /* fallback */ }

    // Fallback
    const disabledList = (await db.read('seatsync_disabled_slots')) || [];
    const bookings = (await db.read('seatsync_bookings')) || [];
    const waitlist = (await db.read('seatsync_waitlist')) || [];
    const nowIso = new Date().toISOString();

    const isMatch = (bDate) => {
      if (scope === 'SELECTED_DATE') return bDate === dateStr;
      if (scope === 'DATE_RANGE') return bDate >= startDate && bDate <= endDate;
      if (scope === 'ALL_FUTURE') return bDate >= dateStr;
      return bDate === dateStr;
    };

    disabledList.push({
      id: `DIS-${Date.now()}`,
      slotId,
      slotName,
      date: dateStr,
      scope,
      reason: effectiveReason,
      disabledAt: nowIso
    });
    await db.write('seatsync_disabled_slots', disabledList);

    let cancelledBookingCount = 0;
    bookings.forEach(b => {
      if (b.slotId === slotId && isMatch(b.bookingDate)) {
        if (b.status === 'confirmed' || b.status === 'active') {
          b.status = 'CANCELLED_BY_ADMIN';
          cancelledBookingCount++;
        }
      }
    });
    await db.write('seatsync_bookings', bookings);

    return {
      success: true,
      cancelledBookingCount,
      cancelledWaitlistCount: 0,
      notifiedStudentsCount: cancelledBookingCount
    };
  },

  async enableSlotOccurrence({ slotId, slotName, dateStr, adminUser }) {
    try {
      await supabase.from('slots').update({ status: 'active', cancellation_reason: null }).eq('id', slotId);
    } catch { /* fallback */ }

    const disabledList = (await db.read('seatsync_disabled_slots')) || [];
    const updatedList = disabledList.filter(d => 
      !(d.slotId === slotId && (d.date === dateStr || d.scope === 'ALL_FUTURE'))
    );
    await db.write('seatsync_disabled_slots', updatedList);

    return {
      success: true,
      message: `${slotName || 'Slot'} enabled successfully.`
    };
  }
};
