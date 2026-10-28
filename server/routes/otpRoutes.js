const express = require('express');
const router = express.Router();
const otpController = require('../controllers/otpController');

router.post('/request-password-otp', otpController.sendOtp);
router.post('/verify-password-otp', otpController.verifyOtp);
router.post('/send-otp', otpController.sendOtp);
router.post('/resend-otp', otpController.resendOtp);
router.post('/verify-otp', otpController.verifyOtp);
router.post('/update-password', otpController.resetPassword);
router.post('/reset-password', otpController.resetPassword);
router.post('/change-password', otpController.resetPassword);
router.post('/confirm-password-change', otpController.resetPassword);

module.exports = router;
