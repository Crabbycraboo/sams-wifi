const express = require('express');
const session = require('express-session');
const path = require('path');
const { supabase } = require('./db/database');

const Store = require('express-session').Store;
class SupabaseStore extends Store {
  async get(sid, cb) {
    try {
      const { data } = await supabase.from('user_sessions').select('sess').eq('sid', sid).single();
      cb(null, data ? data.sess : null);
    } catch (e) { cb(null, null); }
  }
  async set(sid, sess, cb) {
    try {
      await supabase.from('user_sessions').upsert({ sid, sess, expire: new Date(Date.now() + 86400000).toISOString() });
      cb(null);
    } catch (e) { cb(null); }
  }
  async destroy(sid, cb) {
    try {
      await supabase.from('user_sessions').delete().eq('sid', sid);
      cb(null);
    } catch (e) { cb(null); }
  }
}

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET || '39ers-cainta-2024',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: new SupabaseStore(),
  cookie: {
    secure: true,
    sameSite: 'none',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use('/', require('./routes/customer'));
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));

app.use((err, req, res, next) => {
  console.error("CRITICAL ERROR:", err.message, err.stack);
  res.status(500).send(`<h1>Error:</h1><pre>${err.stack}</pre>`);
});

module.exports = app;
