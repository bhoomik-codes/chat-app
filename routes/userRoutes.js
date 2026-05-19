// routes/userRoutes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { JWT_SECRET } = require('../config');

const router = express.Router();

const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
};

router.put('/profile', authenticate, [
    body('statusQuote').optional().isString().trim().isLength({ max: 100 }),
    body('bannerColor').optional().isString().trim().matches(/^#[0-9A-Fa-f]{6}$/),
    body('avatar').optional().isString().trim()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    try {
        const updates = {};
        if (req.body.statusQuote !== undefined) updates.statusQuote = req.body.statusQuote;
        if (req.body.bannerColor !== undefined) updates.bannerColor = req.body.bannerColor;
        if (req.body.avatar !== undefined) updates.avatar = req.body.avatar;

        const user = await User.findByIdAndUpdate(req.user.userId, { $set: updates }, { new: true }).select('-password');
        res.json({ success: true, user });
    } catch (err) {
        console.error('[User Profile] Error updating profile:', err);
        res.status(500).json({ success: false, message: 'Server error updating profile' });
    }
});

module.exports = router;
