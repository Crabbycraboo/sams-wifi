const pgSession = require('connect-pg-simple')(session);
const express = require('express');
const session = require('express-session');
const path = require('path');
const { supabase } = require('./db/database');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET || 'taytay-sams-wifi-2026',
  resave: true,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: true,
    sameSite: 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Route Registration
app.use('/', require('./routes/customer'));
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));

// Replace your error handler with this
app.use((err, req, res, next) => {
  console.error("CRITICAL ERROR:", err.message, err.stack);
  res.status(500).send(`<h1>Error:</h1><pre>${err.stack}</pre>`);
});

module.exports = app; // CRITICAL: This allows Vercel to run your app
