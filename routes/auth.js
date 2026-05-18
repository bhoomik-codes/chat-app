// routes/auth.js
// Dedicated authentication router — separates Login from Registration.
// Fixes: Implicit account creation on login (CRITICAL), missing rate limiting (HIGH),
// and missing input validation (MEDIUM).

const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const { JWT_SECRET, JWT_EXPIRES_IN, RATE_LIMIT } = require('../config');

const router = express.Router();

// --- Rate Limiter ---
// Applied to both /login and /register to prevent brute-force attacks.
const authLimiter = rateLimit({
    windowMs: RATE_LIMIT.windowMs,
    max: RATE_LIMIT.max,
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false,
    message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
});

// --- Validation Rules ---
const loginValidation = [
    body('username')
        .isString().withMessage('Username must be a string.')
        .trim()
        .isLength({ min: 3, max: 30 }).withMessage('Username must be between 3 and 30 characters.')
        .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username may only contain letters, numbers, or underscores.'),
    body('password')
        .isString().withMessage('Password must be a string.')
        .isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
];

const registerValidation = [
    ...loginValidation,
    // Registration can enforce stricter password rules
    body('password')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
        .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter.')
        .matches(/[0-9]/).withMessage('Password must contain at least one number.'),
];

/**
 * POST /api/auth/register
 * Creates a new user account. Fails if username already exists.
 */
router.post('/register', authLimiter, registerValidation, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { username, password } = req.body;
    try {
        const existingUser = await User.findOne({ username }).lean();
        if (existingUser) {
            return res.status(409).json({ success: false, message: 'Username is already taken.' });
        }

        const user = await User.create({ username, password });
        const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        return res.status(201).json({ success: true, message: 'Account created successfully!', username: user.username, token });
    } catch (error) {
        console.error('[Auth] Registration error:', error);
        return res.status(500).json({ success: false, message: 'Server error during registration.' });
    }
});

/**
 * POST /api/auth/login
 * Authenticates an existing user. Does NOT create accounts.
 */
router.post('/login', authLimiter, loginValidation, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { username, password } = req.body;
    try {
        // Use .select('+password') if password was hidden via schema, here it's not—but we use lean() for perf
        const user = await User.findOne({ username });
        if (!user) {
            // Generic message to prevent username enumeration
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        return res.status(200).json({ success: true, message: 'Login successful!', username: user.username, token });
    } catch (error) {
        console.error('[Auth] Login error:', error);
        return res.status(500).json({ success: false, message: 'Server error during login.' });
    }
});

module.exports = router;
