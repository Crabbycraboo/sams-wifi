# 📶 Sam's WiFi — Piso WiFi Voucher System

A professional voucher-based WiFi management system for Sam's WiFi hotspot in Taytay, Rizal.

## Features
- 🎫 SAM-XXXX format voucher codes (₱5/30min, ₱10/1hr, ₱20/3hrs)
- ⏱️ Live countdown timer with warning at 60 seconds
- 👥 One device per voucher enforcement
- 📊 Admin dashboard with sales tracker
- 📶 Smart load recommendation system
- 🖨️ Print-ready 20-per-sheet voucher layout
- 🌐 English + Filipino bilingual UI
- 🔐 Separate admin panel at `/admin`

---

## 🚀 Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file
cp .env.example .env

# 3. Edit .env and set your admin password and session secret
nano .env

# 4. Start the server
npm start

# App runs at http://localhost:3000
# Admin panel at http://localhost:3000/admin
```

Default admin login: `admin` / `sams2024`
⚠️ **Change this immediately after first login!**

---

## ☁️ Deploy to Railway

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit - Sam's WiFi"
git remote add origin https://github.com/YOUR_USERNAME/sams-wifi.git
git push -u origin main
```

### Step 2: Deploy on Railway
1. Go to [railway.app](https://railway.app) and sign up (free)
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `sams-wifi` repository
4. Click **Add Variables** and set:
   - `ADMIN_PASSWORD` = your chosen admin password
   - `SESSION_SECRET` = any long random string (e.g. `my-wifi-secret-taytay-2024`)
   - `NODE_ENV` = `production`
5. Railway auto-deploys! Your URL will be like `sams-wifi-production.up.railway.app`

### Step 3: Persistent Database
Railway's free tier may reset the filesystem. For persistent data:
1. In Railway, add a **Volume** to your service
2. Mount it at `/data`
3. Add env var: `DB_PATH=/data/sams_wifi.db`

---

## 📱 QR Code Poster Setup

After deployment:
1. Get your Railway URL (e.g. `https://sams-wifi-production.up.railway.app`)
2. Go to [qr-code-generator.com](https://www.qr-code-generator.com)
3. Generate a QR code pointing to your Railway URL
4. Print and laminate it — post it where customers can scan it

---

## 🖨️ Printing Vouchers

1. Log in to admin panel (`/admin`)
2. Go to **Vouchers** page
3. Select plan and quantity (20 = 1 sheet)
4. Click **Generate & Preview**
5. Click **Print Voucher Sheet**
6. Cut along dashed lines and hand to customers

---

## 📶 Load Recommendation

| Active Users | Recommended Load |
|---|---|
| 0–5 users | ₱50 / 1 day |
| 5–15 users | ₱85 / 2 days |
| 15+ users | ₱200 / 5 days |

---

## 🔑 Default Credentials

- **Admin URL:** `/admin`
- **Username:** `admin`
- **Password:** `sams2024` (change in Admin → Change Password)

---

## 📁 Project Structure

```
sams-wifi/
├── server.js           # Main entry point
├── db/
│   └── database.js     # SQLite DB + all data helpers
├── routes/
│   ├── customer.js     # Customer portal routes
│   ├── admin.js        # Admin panel routes
│   └── api.js          # JSON API for timer polling
├── views/
│   ├── login.ejs       # Customer login (prices + code entry)
│   ├── portal.ejs      # Active session + countdown timer
│   ├── expired.ejs     # Session expired page
│   ├── error.ejs       # Error page
│   └── admin/
│       ├── login.ejs   # Admin login
│       ├── dashboard.ejs  # Main admin dashboard
│       └── vouchers.ejs   # Voucher manager + print
├── public/
│   └── css/
│       ├── style.css   # Customer-facing styles
│       └── admin.css   # Admin panel styles
├── railway.json        # Railway deployment config
└── .env.example        # Environment variables template
```

---

## 🛡️ Security Notes

- Admin panel is at a separate `/admin` URL
- Sessions use secure HTTP-only cookies in production
- Passwords are bcrypt-hashed
- Voucher codes can only be used by one device at a time
- Auto-expiry runs every 30 seconds server-side
