# SeatSync Unified — Complete Supabase Integration & Setup Guide

This document contains step-by-step instructions for deploying, configuring, and verifying the **Supabase Backend** for the **SeatSync Unified** Smart Library Seat Reservation System.

---

## 1. Supabase Project Credentials

- **Supabase URL**: `https://hftpwhuzfoawujspkmpf.supabase.co`
- **Publishable API Key**: `sb_publishable__QIBzlwOumqkB42mfDFXtw_kj8jKBie`

> [!IMPORTANT]
> The browser uses **only** the publishable key. Security, authorization, and data isolation are strictly enforced through PostgreSQL **Row Level Security (RLS)** and **Security Definer RPC Functions**.

---

## 2. Environment Configuration (`.env`)

Create a `.env` file in the project root (`SeatSync-Unified/`):

```env
VITE_SUPABASE_URL=https://hftpwhuzfoawujspkmpf.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable__QIBzlwOumqkB42mfDFXtw_kj8jKBie
```

---

## 3. SQL Migrations Execution Order

Navigate to your **Supabase Dashboard** -> **SQL Editor** and run the migration scripts located in `supabase/migrations/` in the exact sequence below:

1. `01_extensions_and_enums.sql`: Enables `uuid-ossp`, `pgcrypto`, and creates domain enums (`user_role`, `account_status`, `room_status`, `seat_status`, `slot_status`, `booking_status`, `waitlist_status`).
2. `02_tables_and_relationships.sql`: Creates all 15 normalized tables (`profiles`, `libraries`, `floors`, `rooms`, `seats`, `slots`, `bookings`, `waitlist_entries`, `notifications`, `check_in_logs`, `seat_maintenance`, `staff_assignments`, `booking_policies`, `activity_logs`, `no_show_records`).
3. `03_constraints_and_indexes.sql`: Creates partial unique indexes preventing overlapping seat/date/slot bookings and duplicate active waitlists.
4. `04_auth_profile_trigger.sql`: Binds `handle_new_user_signup()` trigger to `auth.users` for automatic profile creation.
5. `05_updated_at_triggers.sql`: Auto-updates `updated_at` timestamps across all tables.
6. `06_helper_rls_functions.sql`: Adds `is_admin()`, `is_librarian_or_admin()`, `is_active_user()`, `can_manage_library(id)`.
7. `07_row_level_security.sql`: Enables RLS on all 15 tables with role-based read/write access policies.
8. `08_transactional_booking_rpcs.sql`: Defines `create_booking` and `cancel_booking` transactional RPCs.
9. `09_waitlist_rpcs.sql`: Defines `join_waitlist` and `allocate_next_waitlisted_student` FIFO RPCs.
10. `10_checkin_checkout_rpcs.sql`: Defines `check_in_booking` and `check_out_booking` desk verification RPCs.
11. `11_admin_ops_rpcs.sql`: Defines `set_user_account_status`, `disable_slot`, `set_room_status`, `set_seat_maintenance` admin RPCs.
12. `12_seed_data.sql`: Seeds Central University Library, 2 floors, 40 seats (A-101 to A-140), time slots, and default booking policies.

---

## 4. Enabling Realtime Tables

In the **Supabase Dashboard**:
1. Go to **Database** -> **Publications**.
2. Select `supabase_realtime`.
3. Enable replication for tables:
   - `profiles`
   - `bookings`
   - `seats`
   - `rooms`
   - `slots`
   - `waitlist_entries`
   - `notifications`
   - `seat_maintenance`

---

## 5. Storage Bucket Configuration (`floor-maps`)

1. Go to **Storage** -> **Create Bucket**.
2. Name the bucket: `floor-maps`.
3. Set Public to **Public**.
4. RLS Policies:
   - **SELECT**: Authenticated users can view permitted floor map images.
   - **INSERT / UPDATE**: Authorized Librarians and Admins.
   - **DELETE**: Admins only.

---

## 6. How to Create Demo Accounts & Assign Roles

### Option A: Create Users via App UI (Signup)
Students sign up on `/signup`. Their profile is created automatically in `public.profiles` with `role = 'student'`.

### Option B: Promote User to Librarian or Admin via SQL
To promote a user to `admin` or `librarian`, run the following in SQL Editor:

```sql
-- Promote to Admin
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'admin@college.edu';

-- Promote to Librarian
UPDATE public.profiles
SET role = 'librarian'
WHERE email = 'librarian@college.edu';
```

---

## 7. Realtime Cross-Dashboard Verification Workflows

1. **Student Seat Booking**:
   - Student books Seat A-105 on Student Portal.
   - Immediately appears on Librarian Desk and Admin Live Operations without refreshing.

2. **Librarian Check-In**:
   - Staff verifies student QR code.
   - Live occupancy metrics increase instantly across all dashboards.

3. **Admin Account Blocking & Ejection**:
   - Admin blocks a student's account on Admin Control Panel.
   - The student's browser immediately receives the Realtime signal, clears cached state, and redirects to `/login` with an "Account Blocked" notification. RLS blocks further data operations.
