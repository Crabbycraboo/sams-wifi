require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { supabase } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Core Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Trust Vercel's reverse proxy to accurately grab client hardware/IP data
app.set('trust proxy', 1);

// Configure Secure Session State Manager
app.use(session({
  secret: process.env.SESSION_SECRET || 'taytay-sams-wifi-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 4 * 60 * 60 * 1000 // 4 hours active browsing window
  }
}));

// ─── SERVER HEALTHCHECK CHECKPOINT ────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ─── REGISTER SYSTEM APPLICATION ROUTERS ──────────────────────────────
app.use('/', require('./routes/customer'));
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));

// 404 - Page Not Found Handler
app.use((req, res) => {
  res.status(404).render('error', { 
    title: 'Page Not Found', 
    message: 'Paumanhin, hindi nahanap ang pahinang iyong hinahanap.' 
  });
});

// 500 - Global Server Error Fallback
app.use((err, req, res, next) => {
  console.error('🔥 Severe App Error:', err.message);
  res.status(500).render('error', { 
    title: 'Server Error', 
    message: 'Nagkaroon ng problema ang server. Mangyaring subukan muli mamaya.' 
  });
});

// ─── STARTUP EXECUTION ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n📶 Sam's WiFi v3.0 booting up successfully!`);
  console.log(`🚀 Portal Core running live on port: ${PORT}`);
  console.log(`🔐 Admin Module: /admin | Database Provider: Supabase Cloud\n`);
});
