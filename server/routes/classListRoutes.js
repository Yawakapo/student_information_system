const express = require('express');
const router = express.Router();
const classListController = require('../controllers/classListController');
const classListStudents = require('../controllers/classListStudents');
const { requireRole } = require('../middleware/auth');

// --- Class-list schedules ---
router.get('/', requireRole('admin', 'teacher', 'student'), classListController.getAll);
router.post('/', requireRole('admin'), classListController.create);

// Registered before "/:id" so the literal path is not captured as an id.
// Reading is open to students too: the label is display text for a
// department/course group and contains no student records. Writing is admin-only.
router.get('/group-labels', requireRole('admin', 'teacher', 'student'), classListController.getGroupLabels);
router.put('/group-labels', requireRole('admin'), classListController.updateGroupLabel);

router.put('/:id', requireRole('admin'), classListController.update);
router.get('/:id/students', requireRole('admin', 'teacher'), classListController.getStudents);
router.delete('/:id', requireRole('admin'), classListController.remove);

// --- Student assignment to class lists ---
router.get('/students/:studentNo/assignments', requireRole('admin', 'teacher'), classListStudents.getStudentAssignments);
router.post('/students/:studentNo/assign', requireRole('admin', 'teacher'), classListStudents.assignStudent);
router.delete('/students/:studentNo/assignments/:classListId', requireRole('admin', 'teacher'), classListStudents.unassignStudent);
router.put('/students/:studentNo', requireRole('admin', 'teacher'), classListStudents.moveStudent);

module.exports = router;
