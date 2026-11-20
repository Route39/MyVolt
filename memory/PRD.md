# Route39 Rent Audit — PRD

## Original problem statement
Build a simple, fast, professional web application called **Route39 Rent Audit** for internal staff and the accounts team to manage, enter, verify and approve driver rent payments. Calendar-based payment entry workflow is the priority (not an accounting ERP). Full spec: staff workflow (search driver → calendar → click date → ADD RENT PAYMENT modal with amount, UTR, method, screenshot, remarks → orange pending), accounts workflow (pending list → detail with screenshot zoom/fullscreen/download → approve with confirmation → green, or reject with mandatory remarks → red, staff notified, correct & resubmit). Roles staff/accounts/admin; staff cannot approve own entries. Driver search, rent calendar with colour legend (white/grey, orange, green, red, blue partial), payment entry rules (duplicate prevention, split payments), accounts dashboard (counts, tabs, filters), driver payment history, audit log, reports A–F with Excel export, rent calculation (joining, handover, rent start, rent-free days, adjustments; expected vs submitted vs verified vs pending vs outstanding), light design with Route39 green, nav limited to 6 items, seeded sample data.

## User choices
- Login: skipped → top-bar user switcher (X-User-Id header, roles enforced in backend). NOT secure, demo only.
- Defaults: future dates blocked (admin toggle), BLUE when verified total < daily rent, delayed = submitted > 1 day after payment date.

## Architecture
- FastAPI (`server.py`, `seed.py`, `storage.py`) + MongoDB; screenshots in Local Object Storage, served via `/api/files/{id}`.
- React + shadcn; pages: Calendar, Verification, TransactionDetail, History, Reports (+Audit Log tab for admin), Drivers (+rent rules), Staff.

## Implemented (2026-11-20)
- All core flows, role permissions, self-approval block (also blocks approving a payment you corrected/resubmitted), atomic approve/reject, audit log, notifications, 6 reports + Excel, driver/staff management, adjustments, rent-free days, rent rules, seed data (6 users, 8 drivers, 41 txns).
- Testing: iteration_1 — backend 25/27 (both failures fixed), frontend all flows pass.

## Iteration 2 (2026-11-20) — Driver ID & Vehicle ID system
- User request: permanent city-based Driver IDs (BLR-D-001…) and Vehicle IDs (BLR-001…), driver↔vehicle assignment with history, vehicle selected per payment stored as snapshot, Vehicle Management (admin), search by Driver/Vehicle ID, reports with Driver ID + transaction Vehicle ID, safe migration ("Vehicle ID not recorded" for old txns).
- Implemented: driver_code (internal key R39-DRV-xxxx kept for URLs), vehicles collection, vehicle_assignments, atomic counters (never reused), migrate_ids() at startup (idempotent), Vehicle Management page, Change vehicle dialog, assignment history, payment vehicle select, snapshot fields, reports updated. Driver edits no longer rewrite past transactions. Unique indexes on driver_code / current_vehicle_id; cannot mark an assigned vehicle Inactive.
- Hyderabad uses prefix HYD (not in user's list). Backups: drivers_backup_pre_vehicle_ids, transactions_backup_pre_vehicle_ids.
- Sample spare vehicles added: BLR-005, BLR-006, CHN-003.
- Testing iteration_2: backend 23/23, frontend all flows pass.

## Iteration 3 (2026-11-20) — Premium UI/UX redesign
- Brand "ROUTE39 — Fleet Finance & Operations"; palette #101820/#151F27/#22C55E/#15803D/#F4F6F8; Inter + Manrope.
- New: collapsible dark sidebar (Overview, All Drivers, Rent Calendar, Accounts Verification, Payment Ledger, Reports & Analytics, Driver/Vehicle/Staff Mgmt, Settings, Help, profile), header with global driver search + role badge.
- New pages: Overview (MTD KPIs + 14-day trend), All Drivers daily board (/api/board: date stepper, 8 KPIs, server-side filter/sort/paging, Excel), Settings (profile + rent rules moved here), Help.
- Ledger: server-side paging/sort/date range/export (/api/transactions?page=..&format=xlsx). Verification paged + sortable. Reports: KPIs, chart, city filter. Management pages: filters + pagination.
- Testing iteration_3: backend 22/22, frontend all flows pass.

## Backlog
- P1: Real login (email/password) before going live
- P2: Friendlier "Screenshot replaced" audit display (thumbnails instead of file IDs); shadcn date pickers instead of native date inputs; payment history table column fit on desktop; sequential transaction ID counter; hide inactive staff from performance report
