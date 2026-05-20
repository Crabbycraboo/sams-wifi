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

// Trust Railway's proxy so req.ip gives real client IP
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

// Health check for Railway — must be before other routes
app.get('/health', (req, res) => res.send('OK'));

app.use('/', require('./routes/customer'));
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'Page Not Found', message: 'This page does not exist.' });
});

app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).render('error', { title: 'Server Error', message: 'Something went wrong. Please try again.' });
});

initDb().then(() => {
  // Check for expired vouchers every 30s
  setInterval(() => {
    const count = checkExpiredVouchers();
    if (count > 0) console.log(`[Timer] Expired ${count} voucher(s)`);
  }, 30 * 1000);

  // Prune old rate limit records every hour
  setInterval(() => {
    pruneRateLimits();
    console.log('[Cleanup] Rate limit records pruned');
  }, 60 * 60 * 1000);

  // Single app.listen — only here, after DB is ready
  app.listen(PORT, () => {
    console.log(`\n📶 Sam's WiFi running at http://localhost:${PORT}`);
    console.log(`🔐 Admin panel: http://localhost:${PORT}/admin`);
    console.log(`🛡️  Hardened mode: rate limiting + device fingerprinting ON`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  });
}).catch(err => {
  console.error('[FATAL] DB init failed:', err);
  process.exit(1);
});
