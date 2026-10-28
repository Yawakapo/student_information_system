const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { requireAuth } = require('../middleware/auth');

// Declared before the '/:id' route below, otherwise Express would treat the
// word "summary" as a user id.
router.get('/summary', requireAuth, profileController.getProfileSummary);
router.get('/summary/:id', requireAuth, profileController.getProfileSummary);
router.get('/', requireAuth, profileController.getProfile);
router.get('/:id', requireAuth, profileController.getProfile);
router.patch('/', requireAuth, profileController.updateAccount);
router.patch('/account', requireAuth, profileController.updateAccount);
router.put('/account', requireAuth, profileController.updateAccount);
router.post('/email-change/request', requireAuth, profileController.requestEmailChange);
router.post('/email-change/confirm', requireAuth, profileController.confirmEmailChange);
router.post('/update-profile', requireAuth, profileController.updateProfile);
router.put('/update-profile', requireAuth, profileController.updateProfile);

module.exports = router;
