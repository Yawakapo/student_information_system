const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const accountController = require('../controllers/accountController');
const { requireAuth, requireRole } = require('../middleware/auth');

// --- Signing in and out ---
router.get('/check-session', requireAuth, authController.checkSession);
router.post('/logout', requireAuth, authController.logout);
router.post('/login', authController.login);
router.post('/verify-account', authController.verifyAccount);

// --- Admin account management ---
router.get('/admin/users', requireRole('admin'), accountController.listManagedUsers);
router.get('/admin/students/account-options', requireRole('admin'), accountController.getEligibleStudentAccounts);
router.get('/admin/students/eligibility/:accountNumber', requireRole('admin'), accountController.checkStudentAccountEligibility);
router.post('/admin/create-account', requireRole('admin'), accountController.createManagedAccount);
router.put('/admin/users/:id', requireRole('admin'), accountController.updateManagedUser);
router.put('/admin/users/:id/status', requireRole('admin'), accountController.updateManagedUserStatus);
router.delete('/admin/users/:id', requireRole('admin'), accountController.deleteManagedUser);
router.delete('/admin/users/:id/record', requireRole('admin'), accountController.deleteManagedStudentRecord);

module.exports = router;
