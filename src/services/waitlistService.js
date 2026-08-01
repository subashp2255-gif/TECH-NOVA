import { db } from './mockDatabase';
import { notificationService } from './notificationService';
import { slotService } from './slotService';

export const waitlistService = {
  async getStudentWaitlistEntries(studentId) {
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
    const disabledState = await slotService.getDisabledState(slot.id, dateStr);
    const slotStatus = String(slot.occurrenceStatus ?? slot.status ?? (disabledState ? "DISABLED" : "ACTIVE")).toUpperCase();
    if (disabledState || ["DISABLED", "CANCELLED"].includes(slotStatus) || slot.isDisabledByAdmin) {
      throw new Error(
        "This slot was cancelled by the library and its waiting list is closed."
      );
    }

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
      studentCollegeId: student.collegeId || student.identifier,
      dateStr,
      slotId: slot.id,
      notificationPreference,
      status: 'WAITING',
      joinedAt: new Date().toISOString()
    };

    list.push(newEntry);
    await db.write('seatsync_waitlist', list);

    await notificationService.addNotification({
      userId: student.id,
      title: 'Joined Waiting List',
      message: `You are queued for ${slot.label} on ${dateStr}. We'll notify you when a seat opens.`
    });

    return newEntry;
  },

  async leaveWaitlist(entryId, studentId) {
    const list = (await db.read('seatsync_waitlist')) || [];
    const idx = list.findIndex(w => w.id === entryId && w.studentId === studentId);
    if (idx !== -1) {
      list[idx].status = 'CANCELLED_BY_STUDENT';
      await db.write('seatsync_waitlist', list);
    }
  },

  async notifyNextStudent(dateStr, slotId) {
    const disabledState = await slotService.getDisabledState(slotId, dateStr);
    if (disabledState) return null;

    const list = (await db.read('seatsync_waitlist')) || [];
    const waiting = list
      .filter(w => w.dateStr === dateStr && w.slotId === slotId && (w.status || '').toLowerCase() === 'waiting')
      .sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));

    if (waiting.length > 0) {
      const nextStudent = waiting[0];
      nextStudent.status = 'NOTIFIED';
      nextStudent.notifiedAt = new Date().toISOString();
      await db.write('seatsync_waitlist', list);

      await notificationService.addNotification({
        userId: nextStudent.studentId,
        title: 'Seat Allocation Available!',
        message: `A seat has opened up for your waitlisted slot on ${dateStr}. Book your seat now!`
      });

      return nextStudent;
    }
    return null;
  }
};
