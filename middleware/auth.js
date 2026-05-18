// middleware/auth.js
// Reusable JWT authentication middleware for HTTP routes.
// Socket.io uses its own inline version in sockets/chatHandlers.js.

const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');

/**
 * Express middleware that verifies a JWT from the Authorization header.
 * Attaches the decoded payload to req.user on success.
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Expect "Bearer <token>"

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access denied: No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ success: false, message: 'Access denied: Invalid or expired token.' });
    }
}

module.exports = { authenticateToken };
