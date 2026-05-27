const express = require('express');
const router = express.Router();
const { getUnreadNotifications, markNotificationRead } = require('../db/database');

router.get('/api/notifications', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  const notifs = getUnreadNotifications();
  res.json(notifs);
});

router.post('/api/notifications/:id/read', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  markNotificationRead(req.params.id);
  res.json({ success: true });
});

module.exports = router;
