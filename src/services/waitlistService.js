import { supabase } from '../lib/supabase';
import { db } from './mockDatabase';
import { notificationService } from './notificationService';
import { slotService } from './slotService';

export const waitlistService = {
  async getStudentWaitlistEntries(studentId) {
    try {
      const { data, error } = await supabase
        .from('waitlist_entries')
        .select(`
          id,
          booking_date,
          status,
          queue_position,
          created_at,
          slots (id, name, start_time, end_time)
        `)
        .eq('student_id', studentId)
        .eq('status', 'waiting')
        .order('created_at', { ascending: true });

      if (!error && data) {
        return data.map(w => ({
          id: w.id,
          dateStr: w.booking_date,
          status: w.status,
          queuePosition: w.queue_position,
          slot: w.slots ? {
            id: w.slots.id,
            name: w.slots.name,
            label: w.slots.name
          } : null
        }));
      }
    } catch { /* fallback */ }

    const list = (await db.read('seatsync_waitlist')) || [];
    const slots = (await db.read('seatsync_slots')) || [];

    return list
      .filter(w => w.studentId === studentId && (w.status || '').toLowerCase() === 'waiting')
      .map(entry => {
        const slot = slots.find(s => s.id === entry.slotId);
        return {
          ...entry,
          slot
        };
      });
  },

  async getWaitlistSummaryForSlot(dateStr, slotId, studentId = null) {
    const disabledState = await slotService.getDisabledState(slotId, dateStr);
    if (disabledState) {
      return {
        waitlistCount: 0,
        isStudentWaiting: false,
        studentPosition: 0,
        studentEntry: null,
        isDisabled: true,
        disabledReason: disabledState.reason
      };
    }

    try {
      const { data, error } = await supabase
        .from('waitlist_entries')
        .select('id, student_id, queue_position, created_at')
        .eq('slot_id', slotId)
        .eq('booking_date', dateStr)
        .eq('status', 'waiting')
        .order('created_at', { ascending: true });

      if (!error && data) {
        const waitlistCount = data.length;
        let isStudentWaiting = false;
        let studentPosition = 0;
        let studentEntry = null;

        if (studentId) {
          const idx = data.findIndex(w => w.student_id === studentId);
          if (idx !== -1) {
            isStudentWaiting = true;
            studentPosition = idx + 1;
            studentEntry = data[idx];
          }
        }

        return {
          waitlistCount,
          isStudentWaiting,
          studentPosition,
          studentEntry,
          isDisabled: false
        };
      }
    } catch { /* fallback */ }

    const list = (await db.read('seatsync_waitlist')) || [];
    const slotEntries = list.filter(w => 
      w.dateStr === dateStr &&
      w.slotId === slotId &&
      (w.status || '').toLowerCase() === 'waiting'
    );

    slotEntries.sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));

    const waitlistCount = slotEntries.length;
    let isStudentWaiting = false;
    let studentPosition = 0;
    let studentEntry = null;

    if (studentId) {
      const idx = slotEntries.findIndex(w => w.studentId === studentId);
      if (idx !== -1) {
        isStudentWaiting = true;
        studentPosition = idx + 1;
        studentEntry = slotEntries[idx];
      }
    }

    return {
      waitlistCount,
      isStudentWaiting,
      studentPosition,
      studentEntry,
      isDisabled: false
    };
  },

  async joinWaitlist({ student, dateStr, slot, notificationPreference = 'In-App & System Notifications' }) {
    try {
      const { data: libraryData } = await supabase.from('libraries').select('id').limit(1).single();
      const { data: roomData } = await supabase.from('rooms').select('id').limit(1).single();

      if (libraryData && roomData) {
        const { data, error } = await supabase.rpc('join_waitlist', {
          p_library_id: libraryData.id,
          p_room_id: roomData.id,
          p_slot_id: slot.id,
          p_booking_date: dateStr
        });

        if (error) throw new Error(error.message);

        if (data && data.success) {
          const newEntry = {
            id: data.waitlist_id || `WL-${Date.now()}`,
            studentId: student.id,
            studentName: student.name,
            dateStr,
            slotId: slot.id,
            status: 'WAITING',
            joinedAt: new Date().toISOString()
          };

          const list = (await db.read('seatsync_waitlist')) || [];
          list.push(newEntry);
          await db.write('seatsync_waitlist', list);

          return newEntry;
        }
      }
    } catch (err) {
      if (err.message && !err.message.includes('fetch')) throw err;
    }

    // Fallback
    const list = (await db.read('seatsync_waitlist')) || [];

    const existing = list.find(w =>
      w.studentId === student.id &&
      w.dateStr === dateStr &&
      w.slotId === slot.id &&
      (w.status || '').toLowerCase() === 'waiting'
    );

    if (existing) {
      throw new Error('You are already on the waiting list for this slot.');
    }

    const newEntry = {
      id: `WL-${Date.now()}`,
      studentId: student.id,
      studentName: student.name,
      dateStr,
      slotId: slot.id,
      notificationPreference,
      status: 'WAITING',
      joinedAt: new Date().toISOString()
    };

    list.push(newEntry);
    await db.write('seatsync_waitlist', list);
    return newEntry;
  },

  async leaveWaitlist(entryId, studentId) {
    try {
      await supabase
        .from('waitlist_entries')
        .update({ status: 'cancelled' })
        .eq('id', entryId);
    } catch { /* fallback */ }

    const list = (await db.read('seatsync_waitlist')) || [];
    const idx = list.findIndex(w => w.id === entryId && w.studentId === studentId);
    if (idx !== -1) {
      list[idx].status = 'CANCELLED_BY_STUDENT';
      await db.write('seatsync_waitlist', list);
    }
  },

  async notifyNextStudent(dateStr, slotId) {
    try {
      const { data: roomData } = await supabase.from('rooms').select('id').limit(1).single();
      if (roomData) {
        await supabase.rpc('allocate_next_waitlisted_student', {
          p_room_id: roomData.id,
          p_slot_id: slotId,
          p_booking_date: dateStr
        });
      }
    } catch { /* fallback */ }
  }
};
