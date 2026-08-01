import { db } from './mockDatabase';

export const notificationService = {
  async getNotifications(userId) {
    const notifications = (await db.read('seatsync_notifications')) || [];
    return notifications.filter(n => n.userId === userId);
  },

  async addNotification({ userId, title, message }) {
    const notifications = (await db.read('seatsync_notifications')) || [];
    const newNotif = {
      id: `NOTIF-${Date.now()}`,
      userId,
      title,
      message,
      createdAt: new Date().toISOString(),
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
      if (n.userId === userId) {
        n.isRead = true;
        n.read = true;
      }
    });
    await db.write('seatsync_notifications', notifications);
  }
};
