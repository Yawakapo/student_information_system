const express = require('express');
const router = express.Router();
const teacherController = require('../controllers/teacherController');
const { requireRole } = require('../middleware/auth');

router.get('/', requireRole('admin'), teacherController.listTeachers);
router.post('/', requireRole('admin'), teacherController.createTeacher);
router.delete('/:id', requireRole('admin'), teacherController.removeTeacher);

module.exports = router;
