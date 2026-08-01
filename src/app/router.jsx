import React from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import ProtectedRoute from '../auth/ProtectedRoute';
import RoleRoute from '../auth/RoleRoute';
import { ROLES } from '../data/seedData';

// Shared Pages
import LoginPage from '../pages/LoginPage';
import UnauthorizedPage from '../pages/UnauthorizedPage';
import NotFoundPage from '../pages/NotFoundPage';

// Layouts
import StudentLayout from '../layouts/StudentLayout';
import LibrarianLayout from '../layouts/LibrarianLayout';
import AdminLayout from '../layouts/AdminLayout';

// Student Features
import Dashboard from '../features/student/Dashboard';
import FindSeat from '../features/student/FindSeat';
import MyReservations from '../features/student/MyReservations';
import WaitingList from '../features/student/WaitingList';
import Notifications from '../features/student/Notifications';
import Profile from '../features/student/Profile';

// Librarian Features
import LibrarianDashboard from '../features/librarian/LibrarianDashboard';
import QRScannerPage from '../features/librarian/QRScannerPage';
import StaffReservationsPage from '../features/librarian/StaffReservationsPage';
import StaffWaitlistPage from '../features/librarian/StaffWaitlistPage';
import NoShowsMonitorPage from '../features/librarian/NoShowsMonitorPage';
import PolicySettingsPage from '../features/librarian/PolicySettingsPage';
import LibrarianProfilePage from '../features/librarian/LibrarianProfilePage';

// Admin Features
import AdminDashboard from '../features/admin/AdminDashboard';
import StudentManagementPage from '../features/admin/StudentManagementPage';
import StaffManagementPage from '../features/admin/StaffManagementPage';
import SeatManagementPage from '../features/admin/SeatManagementPage';
import SlotConfigPage from '../features/admin/SlotConfigPage';
import AdminBookingsPage from '../features/admin/AdminBookingsPage';
import AdminWaitlistPage from '../features/admin/AdminWaitlistPage';
import ReportsAnalyticsPage from '../features/admin/ReportsAnalyticsPage';
import AdminSettingsPage from '../features/admin/AdminSettingsPage';
import AuditLogsPage from '../features/admin/AuditLogsPage';
import AdminProfilePage from '../features/admin/AdminProfilePage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/login" replace />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/unauthorized',
    element: <UnauthorizedPage />,
  },

  // STUDENT DASHBOARD ROUTES
  {
    path: '/student',
    element: (
      <ProtectedRoute>
        <RoleRoute allowedRoles={[ROLES.STUDENT]}>
          <StudentLayout />
        </RoleRoute>
      </ProtectedRoute>
    ),
    children: [
      { path: '', element: <Navigate to="/student/dashboard" replace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'find-seat', element: <FindSeat /> },
      { path: 'reservations', element: <MyReservations /> },
      { path: 'waitlist', element: <WaitingList /> },
      { path: 'notifications', element: <Notifications /> },
      { path: 'profile', element: <Profile /> },
    ],
  },

  // LIBRARIAN DASHBOARD ROUTES
  {
    path: '/librarian',
    element: (
      <ProtectedRoute>
        <RoleRoute allowedRoles={[ROLES.LIBRARIAN]}>
          <LibrarianLayout />
        </RoleRoute>
      </ProtectedRoute>
    ),
    children: [
      { path: '', element: <Navigate to="/librarian/dashboard" replace /> },
      { path: 'dashboard', element: <LibrarianDashboard /> },
      { path: 'scan-entry', element: <QRScannerPage /> },
      { path: 'bookings', element: <StaffReservationsPage /> },
      { path: 'waitlist', element: <StaffWaitlistPage /> },
      { path: 'students', element: <NoShowsMonitorPage /> },
      { path: 'settings', element: <PolicySettingsPage /> },
      { path: 'profile', element: <LibrarianProfilePage /> },
    ],
  },

  // ADMIN DASHBOARD ROUTES
  {
    path: '/admin',
    element: (
      <ProtectedRoute>
        <RoleRoute allowedRoles={[ROLES.ADMIN]}>
          <AdminLayout />
        </RoleRoute>
      </ProtectedRoute>
    ),
    children: [
      { path: '', element: <Navigate to="/admin/dashboard" replace /> },
      { path: 'dashboard', element: <AdminDashboard /> },
      { path: 'students', element: <StudentManagementPage /> },
      { path: 'staff', element: <StaffManagementPage /> },
      { path: 'seats', element: <SeatManagementPage /> },
      { path: 'slots', element: <SlotConfigPage /> },
      { path: 'bookings', element: <AdminBookingsPage /> },
      { path: 'waitlist', element: <AdminWaitlistPage /> },
      { path: 'reports', element: <ReportsAnalyticsPage /> },
      { path: 'settings', element: <AdminSettingsPage /> },
      { path: 'audit-logs', element: <AuditLogsPage /> },
      { path: 'profile', element: <AdminProfilePage /> },
    ],
  },

  {
    path: '*',
    element: <NotFoundPage />,
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
