// services/userService.js
// Business logic layer for user-related operations.
// Isolates DB queries from socket/route handlers for testability and reuse.

const User = require('../models/User');

/**
 * Resolves online usernames from the userSocketMap efficiently using a
 * single batched $in query — fixes the N+1 query problem in requestInitialData.
 *
 * @param {Map} userSocketMap - The in-memory map of userId -> Set<socketId>
 * @returns {Promise<string[]>} - Array of online usernames
 */
async function getOnlineUsernames(userSocketMap) {
    const onlineUserIds = Array.from(userSocketMap.keys());
    if (onlineUserIds.length === 0) return [];

    // Single DB query instead of N sequential queries
    const onlineUsers = await User.find(
        { _id: { $in: onlineUserIds } },
        'username'
    ).lean();

    return onlineUsers.map(u => u.username);
}

/**
 * Checks if two users are friends.
 * @param {string} userId
 * @param {string} targetUserId
 * @returns {Promise<boolean>}
 */
async function areFriends(userId, targetUserId) {
    const user = await User.findById(userId, 'friends').lean();
    if (!user) return false;
    return user.friends.some(f => f.toString() === targetUserId.toString());
}

module.exports = { getOnlineUsernames, areFriends };
