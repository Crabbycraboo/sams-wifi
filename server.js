require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDb, checkExpiredVouchers, pruneRateLimits } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Trust Railway's proxy
app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET || 'sams-wifi-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 4 * 60 * 60 * 1000
  }
}));

// ─── HEALTHCHECK ENDPOINT ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/', require('./routes/customer'));
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));
app.use('/', require('./routes/notifications'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'Page Not Found', message: 'This page does not exist.' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).render('error', { title: 'Server Error', message: 'Something went wrong. Please try again.' });
});

// ─── INITIALIZE & START ───────────────────────────────────────────────
initDb().then(() => {
  // Check for expired vouchers every 30s
  setInterval(() => {
    try {
      const count = checkExpiredVouchers();
      if (count > 0) console.log(`[Timer] Expired ${count} voucher(s)`);
    } catch(e) {
      console.error('[Timer Error]', e.message);
    }
  }, 30 * 1000);

  // Prune rate limits every hour
  setInterval(() => {
    try {
      pruneRateLimits();
      console.log('[Cleanup] Rate limits pruned');
    } catch(e) {
      console.error('[Cleanup Error]', e.message);
    }
  }, 60 * 60 * 1000);

  const server = app.listen(PORT, () => {
    console.log(`\n📶 Sam's WiFi running on port ${PORT}`);
    console.log(`🔐 Admin: /admin | Customer: / | API: /api`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[SIGTERM] Shutting down gracefully...');
    server.close(() => {
      console.log('[SHUTDOWN] Server closed');
      process.exit(0);
    });
  });

}).catch(err => {
  console.error('[FATAL] Database init failed:', err.message);
  process.exit(1);
});
