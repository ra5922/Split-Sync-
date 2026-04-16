# 💸 SplitWise — Group Expense Splitter

A full-stack expense splitting app built with Node.js + Express + EJS + PostgreSQL.

## Features
- 🔐 Login / Signup with bcrypt password hashing
- 👥 Multiple groups with categories (food, travel, etc.)
- 💳 Add expenses — equal split OR custom amount per person
- 🏷️ Discount support — applied proportionally across splits
- 📝 Notes on each expense
- ⚖️ Smart balance calculator (who owes whom — simplified)
- ✅ Settle Up — record payments between members
- 📊 Charts — spending by person & by category (Chart.js)
- 🕒 Settlement history log
- ⬇️ Export to PDF and CSV
- 🌙 Dark mode toggle (persists via localStorage)

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Set up PostgreSQL database
```bash
psql -U postgres
CREATE DATABASE splitter;
\q
psql -U postgres -d splitter -f schema.sql
```

### 3. Configure database connection
Edit `db.js` OR copy `.env.example` to `.env` and fill in your values:
```
DB_HOST=localhost
DB_NAME=splitter
DB_USER=postgres
DB_PASS=your_password
```

### 4. Run the app
```bash
node app.js
# or for development with auto-reload:
npx nodemon app.js
```

### 5. Open in browser
```
http://localhost:3000
```

## Project Structure
```
expense-splitter/
├── app.js                  # Express entry point
├── db.js                   # PostgreSQL pool
├── schema.sql              # Database schema
├── middleware/
│   └── auth.js             # requireAuth middleware
├── routes/
│   ├── auth.js             # Login / Signup / Logout
│   ├── groups.js           # Groups CRUD + Settle Up + Balances
│   ├── expenses.js         # Expense add/view/delete
│   └── export.js           # PDF and CSV export
├── views/
│   ├── partials/           # header.ejs, footer.ejs
│   ├── auth/               # login.ejs, signup.ejs
│   ├── groups/             # index.ejs, new.ejs, show.ejs
│   └── expenses/           # new.ejs, show.ejs
└── public/
    ├── css/style.css       # Full dark/light mode styles
    └── js/
        ├── app.js          # Tabs, theme toggle
        └── charts.js       # Chart.js rendering
```

## How Splitting Works

### Equal Split
Total amount minus discount, divided equally among selected members.

Example: ₹600 total, ₹60 discount → ₹540 ÷ 3 = ₹180 per person

### Custom Split
Enter each person's share of the raw amount. Discount is applied proportionally.

Example: A ate ₹300, B ate ₹200, C ate ₹100. ₹60 discount.
- A pays: ₹300 - (60 × 300/600) = ₹270
- B pays: ₹200 - (60 × 200/600) = ₹180
- C pays: ₹100 - (60 × 100/600) = ₹90

## Settle Up
Records a payment from you to another member and marks their outstanding splits as settled.
