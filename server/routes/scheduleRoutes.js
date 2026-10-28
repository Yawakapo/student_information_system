const express = require('express');
const router = express.Router();
const scheduleController = require('../controllers/scheduleController');
const { requireRole } = require('../middleware/auth');

router.get('/', requireRole('admin', 'teacher'), scheduleController.getSchedules);
router.post('/', requireRole('admin'), scheduleController.createSchedule);
router.put('/:id', requireRole('admin'), scheduleController.updateSchedule);
router.delete('/:id', requireRole('admin'), scheduleController.deleteSchedule);
router.get('/student/schedule/:id', requireRole('admin', 'teacher', 'student'), scheduleController.getStudentSchedule);

module.exports = router;
