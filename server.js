require('dotenv').config();
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
  resave: false,
  saveUninitialized: false
}));

// Route Registration
app.use('/', require('./routes/customer'));
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

module.exports = app; // CRITICAL: This allows Vercel to run your app
