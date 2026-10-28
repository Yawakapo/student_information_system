const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
const { requireRole } = require('../middleware/auth');

router.get('/', requireRole('admin', 'teacher'), studentController.getStudents);
router.get('/view', requireRole('admin', 'teacher'), studentController.viewStudent);
router.get('/dashboard-counts', requireRole('admin'), studentController.getDashboardCounts);
router.get('/count', requireRole('admin'), studentController.getDashboardCounts);
router.get('/pending', requireRole('admin', 'teacher'), studentController.getPendingStudents);
router.get('/unassigned', requireRole('admin', 'teacher'), studentController.getUnassignedStudents);
router.get('/check/:userId', studentController.checkStudentRegistrationStatus);

router.post('/', requireRole('admin'), studentController.addStudent);
router.post('/import', requireRole('admin'), studentController.importStudents);
router.post('/add', requireRole('admin', 'student'), studentController.addStudent);
router.post('/approve', requireRole('admin'), studentController.updateApprovalStatus);

router.put('/:id/status', requireRole('admin'), studentController.updateStudentStatus);
router.delete('/:id', requireRole('admin'), studentController.deleteStudent);

module.exports = router;
