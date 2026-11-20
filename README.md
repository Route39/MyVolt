# MyVolt — Route39 EV Fleet Finance & Rent Operations Platform

**MyVolt** is Route39's enterprise platform for electric vehicle (EV) fleet finance, driver rent tracking, payment ledger, accounts verification, and operations audit.

---

## ⚡ Key Capabilities

- **Overview & KPI Dashboard**: Real-time MTD collection metrics, expected vs verified vs pending rent, and 14-day collection trend visualization.
- **All Drivers Board**: Live daily driver tracking with status indicators, collection progress bar, search, pagination, and Excel export.
- **Rent Calendar**: Visual calendar interface mapping daily driver rent statuses (Paid, Pending, Overdue, Partial, Rent-Free).
- **Accounts Verification**: Segregation-of-duties review queue with built-in high-res screenshot viewer, zoom/fullscreen inspection, atomic approval and rejection flows.
- **Payment Ledger**: Audited transaction register with city, staff, driver, date range filters, and Excel download.
- **Reports & Analytics**: 6 comprehensive financial and operational reports with export functionality.
- **Operations Management**: Driver, Vehicle, and Staff management with unique Driver ID (`BLR-D-001...`) and Vehicle ID (`BLR-001...`) assignment history.
- **Audit Log**: Immutable audit trail of every payment, approval, rejection, and configuration change.

---

## 🚀 Architecture & Stack

- **Backend**: FastAPI (Python 3.10+ / 3.14), Motor (Async MongoDB), Pydantic, OpenPyXL, Pillow.
- **Database**: MongoDB Atlas / local MongoDB (`myvolt_db`).
- **Frontend**: React 18, Tailwind CSS, shadcn/ui, Radix UI, Recharts, Lucide Icons.

---

## 🛠️ Setup & Running

### 1. Backend

```bash
cd backend
python3 -m pip install -r requirements.txt
python3 -m uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

Backend API will be running at: `http://localhost:8001`
Interactive API Docs (Swagger): `http://localhost:8001/docs`

### 2. Frontend

```bash
cd frontend
yarn install  # or npm install
yarn start    # or npm start
```

Frontend application will open at: `http://localhost:3001`

---

## 👥 Seed Roles & Users

| User | Role | Email |
| :--- | :--- | :--- |
| Anita Rao | Admin | `anita.admin@route39.in` |
| Ravi Kumar | Staff | `ravi.staff@route39.in` |
| Suresh Patel | Staff | `suresh.staff@route39.in` |
| Meena Iyer | Staff | `meena.staff@route39.in` |
| Priya Sharma | Accounts | `priya.accounts@route39.in` |
| Farhan Ali | Accounts | `farhan.accounts@route39.in` |

---

© Route39 Mobility Pvt Ltd — MyVolt
