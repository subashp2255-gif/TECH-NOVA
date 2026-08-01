import { db } from './mockDatabase';

export const notificationService = {
  async getNotifications(userId) {
    const raw = (await db.read('seatsync_notifications')) || [];
    return raw
      .filter(n => n && (n.userId === userId || n.studentId === userId))
      .map(n => {
        const dateVal = n.createdAt || n.timestamp || n.createdAtTime || new Date().toISOString();
        return {
          ...n,
          createdAt: dateVal,
          timestamp: dateVal,
          isRead: Boolean(n.isRead || n.read)
        };
      });
  },

  async addNotification({ userId, title, message }) {
    const notifications = (await db.read('seatsync_notifications')) || [];
    const nowIso = new Date().toISOString();
    const newNotif = {
      id: `NOTIF-${Date.now()}`,
      userId,
      title,
      message,
      createdAt: nowIso,
      timestamp: nowIso,
      isRead: false,
      read: false
    };
    notifications.unshift(newNotif);
    await db.write('seatsync_notifications', notifications);
    return newNotif;
  },

  async markAsRead(notificationId) {
    const notifications = (await db.read('seatsync_notifications')) || [];
    const target = notifications.find(n => n.id === notificationId);
    if (target) {
      target.isRead = true;
      target.read = true;
      await db.write('seatsync_notifications', notifications);
    }
  },

  async markAllAsRead(userId) {
    const notifications = (await db.read('seatsync_notifications')) || [];
    notifications.forEach(n => {
      if (n.userId === userId || n.studentId === userId) {
        n.isRead = true;
        n.read = true;
      }
    });
    await db.write('seatsync_notifications', notifications);
  }
};
