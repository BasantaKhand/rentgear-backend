const express = require('express');
const router = express.Router();
const {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  deleteNotification,
} = require('../controllers/notificationController');
const auth = require('../middleware/auth');

router.use(auth);

router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.put('/read-all', markAllRead);
router.put('/:id/read', markRead);
router.delete('/:id', deleteNotification);

module.exports = router;
