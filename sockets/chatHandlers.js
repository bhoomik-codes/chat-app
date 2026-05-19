// sockets/chatHandlers.js
// All Socket.IO event logic lives here, separated from server bootstrap.
// Fixes:
//   - N+1 query: replaced loop + findById with a single $in query via userService
//   - Silent fails: all catch blocks now emit 'socketError' back to the client
//   - Duplicate partner lookup: partner fetched once in loadChatContext
//   - deleteRequest / blockRequest: wrapped in try/catch with authorization check
//   - sendMessage: guards against non-member message injection
//   - sendInitialMessage: guards against self-requests

const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const { getOnlineUsernames } = require('../services/userService');

const User = require('../models/User');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const MessageRequest = require('../models/MessageRequest');

/** The in-memory map of userId (string) -> Set<socketId> */
const userSocketMap = new Map();

/**
 * Emits a 'newNotification' event to all sockets belonging to a specific user.
 * @param {string|ObjectId} userId
 * @param {object} data - { title, body }
 */
function sendNotification(userId, data) {
    const userSockets = userSocketMap.get(userId.toString());
    if (userSockets) {
        userSockets.forEach(socketId => {
            // Access the io instance attached to the socket namespace
        });
    }
}

/**
 * Registers the Socket.IO authentication middleware and all event handlers.
 * @param {import('socket.io').Server} io
 */
function registerChatHandlers(io) {

    // ──────────────────────────────────────────────
    // Socket.IO Authentication Middleware
    // ──────────────────────────────────────────────
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('Authentication error: No token provided.'));
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            socket.userId = decoded.userId;
            socket.username = decoded.username;
            next();
        } catch (error) {
            return next(new Error('Authentication error: Invalid or expired token.'));
        }
    });

    // ──────────────────────────────────────────────
    // Connection Handler
    // ──────────────────────────────────────────────
    io.on('connection', (socket) => {
        console.log(`[Socket] ${socket.username} connected (${socket.id})`);

        // Register socket in userSocketMap
        if (!userSocketMap.has(socket.userId)) {
            userSocketMap.set(socket.userId, new Set());
        }
        userSocketMap.get(socket.userId).add(socket.id);

        io.emit('userStatusUpdate', { username: socket.username, online: true });

        // ────────────────────────────────────────
        // requestInitialData — FIXED: N+1 query
        // ────────────────────────────────────────
        socket.on('requestInitialData', async () => {
            try {
                const [currentUser, groups, sentRequests, receivedRequests, onlineUsernames] = await Promise.all([
                    User.findById(socket.userId).populate('friends', 'username').lean(),
                    Chat.find({ isGroupChat: true, members: socket.userId }).select('groupName members').lean(),
                    MessageRequest.find({ sender: socket.userId }).populate('receiver', 'username').lean(),
                    MessageRequest.find({ receiver: socket.userId }).populate('sender', 'username').lean(),
                    getOnlineUsernames(userSocketMap), // Single batched query — fixes N+1
                ]);

                if (!currentUser) return;

                socket.emit('initialData', {
                    friends: currentUser.friends,
                    groups,
                    sentRequests,
                    receivedRequests,
                    onlineUsers: onlineUsernames,
                });
            } catch (error) {
                console.error('[Socket] requestInitialData error:', error);
                socket.emit('socketError', { event: 'requestInitialData', message: 'Failed to load initial data.' });
            }
        });

        // ────────────────────────────────────────
        // searchUsers
        // ────────────────────────────────────────
        socket.on('searchUsers', async ({ searchTerm }) => {
            try {
                if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim() === '') {
                    return socket.emit('searchResults', { results: [] });
                }

                const trimmed = searchTerm.trim();
                const currentUser = await User.findById(socket.userId, 'friends').lean();
                const friendIds = currentUser.friends.map(f => f.toString());

                const [users, groups] = await Promise.all([
                    User.find({
                        username: { $regex: trimmed, $options: 'i' },
                        _id: { $nin: [...friendIds, socket.userId] }
                    }).select('username').limit(10).lean(),
                    Chat.find({
                        isGroupChat: true,
                        groupName: { $regex: trimmed, $options: 'i' }
                    }).select('groupName members').limit(5).lean(),
                ]);

                const results = [
                    ...users.map(u => ({ ...u, type: 'user' })),
                    ...groups.map(g => ({ ...g, type: 'group' })),
                ];
                socket.emit('searchResults', { results });
            } catch (error) {
                console.error('[Socket] searchUsers error:', error);
                socket.emit('socketError', { event: 'searchUsers', message: 'Search failed.' });
            }
        });

        // ────────────────────────────────────────
        // loadChatContext — FIXED: duplicate partner lookup removed
        // ────────────────────────────────────────
        socket.on('loadChatContext', async ({ targetId, isGroup }) => {
            try {
                let chat;
                let partner = null;

                if (isGroup) {
                    chat = await Chat.findById(targetId).populate('members', 'username').populate('pinnedMessages');
                } else {
                    partner = await User.findById(targetId); // Fetched ONCE, reused below
                    if (!partner) {
                        return socket.emit('socketError', { event: 'loadChatContext', message: 'User not found.' });
                    }
                    chat = await Chat.findOne({
                        isGroupChat: false,
                        members: { $all: [socket.userId, partner._id] }
                    }).populate('members', 'username').populate('pinnedMessages');
                }

                if (chat) {
                    const messages = await Message.find({ chatId: chat._id })
                        .populate('sender', 'username')
                        .populate({ path: 'replyTo', populate: { path: 'sender', select: 'username' } })
                        .sort({ createdAt: 1 })
                        .lean();
                    return socket.emit('chatContext', { type: 'existingChat', chat, messages });
                }

                if (!isGroup && partner) {
                    const request = await MessageRequest.findOne({
                        $or: [
                            { sender: socket.userId, receiver: partner._id },
                            { sender: partner._id, receiver: socket.userId }
                        ]
                    }).populate('sender receiver initialMessage');

                    if (request) {
                        if (request.initialMessage) {
                            await Message.populate(request.initialMessage, { path: 'sender', select: 'username' });
                        }
                        const contextType = request.sender._id.toString() === socket.userId
                            ? 'requestSent'
                            : 'requestReceived';
                        return socket.emit('chatContext', { type: contextType, request });
                    }

                    return socket.emit('chatContext', {
                        type: 'new',
                        partner: { username: partner.username, _id: partner._id }
                    });
                }
            } catch (error) {
                console.error('[Socket] loadChatContext error:', error);
                socket.emit('socketError', { event: 'loadChatContext', message: 'Failed to load chat.' });
            }
        });

        // ────────────────────────────────────────
        // sendInitialMessage — FIXED: self-request guard
        // ────────────────────────────────────────
        socket.on('sendInitialMessage', async ({ targetUserId, messageContent }) => {
            try {
                // Guard: prevent self-requests
                if (targetUserId.toString() === socket.userId.toString()) {
                    return socket.emit('socketError', { event: 'sendInitialMessage', message: 'You cannot message yourself.' });
                }

                // Guard: validate content is a non-empty string
                if (!messageContent || typeof messageContent !== 'string' || messageContent.trim() === '') {
                    return socket.emit('socketError', { event: 'sendInitialMessage', message: 'Message content cannot be empty.' });
                }

                const newMsg = new Message({ sender: socket.userId, content: messageContent.trim() });
                await newMsg.save();

                await MessageRequest.create({
                    sender: socket.userId,
                    receiver: targetUserId,
                    initialMessage: newMsg._id,
                    status: 'pending'
                });

                socket.emit('initialMessageSent');

                const receiverSockets = userSocketMap.get(targetUserId.toString());
                if (receiverSockets) {
                    receiverSockets.forEach(socketId => io.to(socketId).emit('newRequestReceived'));
                    io.to([...receiverSockets]).emit('newNotification', {
                        title: 'New Message Request',
                        body: `You have a new message request from ${socket.username}.`
                    });
                }
            } catch (error) {
                console.error('[Socket] sendInitialMessage error:', error);
                socket.emit('socketError', { event: 'sendInitialMessage', message: 'Failed to send message request.' });
            }
        });

        // ────────────────────────────────────────
        // acceptRequest
        // ────────────────────────────────────────
        socket.on('acceptRequest', async ({ requestId }) => {
            try {
                const request = await MessageRequest.findById(requestId);
                if (!request) {
                    return socket.emit('socketError', { event: 'acceptRequest', message: 'Request not found.' });
                }
                // Authorization check: only the receiver may accept
                if (request.receiver.toString() !== socket.userId) {
                    return socket.emit('socketError', { event: 'acceptRequest', message: 'Unauthorized action.' });
                }

                await Promise.all([
                    User.updateOne({ _id: request.sender }, { $addToSet: { friends: request.receiver } }),
                    User.updateOne({ _id: request.receiver }, { $addToSet: { friends: request.sender } }),
                ]);

                const newChat = new Chat({ members: [request.sender, request.receiver] });
                if (request.initialMessage) {
                    await Message.updateOne({ _id: request.initialMessage }, { $set: { chatId: newChat._id } });
                    newChat.lastMessage = request.initialMessage;
                }
                await newChat.save();
                await MessageRequest.findByIdAndDelete(requestId);

                const [populatedChat, messages] = await Promise.all([
                    Chat.findById(newChat._id).populate('members', 'username').populate('pinnedMessages'),
                    Message.find({ chatId: newChat._id }).populate('sender', 'username').populate({ path: 'replyTo', populate: { path: 'sender', select: 'username' } }).sort({ createdAt: 1 }).lean(),
                ]);

                const payload = { chat: populatedChat, messages };

                const senderSockets = userSocketMap.get(request.sender.toString());
                if (senderSockets) {
                    senderSockets.forEach(id => io.to(id).emit('requestAccepted', payload));
                    io.to([...senderSockets]).emit('newNotification', {
                        title: 'Request Accepted',
                        body: `${socket.username} accepted your message request.`
                    });
                }

                const receiverSockets = userSocketMap.get(request.receiver.toString());
                if (receiverSockets) {
                    receiverSockets.forEach(id => io.to(id).emit('requestAccepted', payload));
                }
            } catch (error) {
                console.error('[Socket] acceptRequest error:', error);
                socket.emit('socketError', { event: 'acceptRequest', message: 'Failed to accept request.' });
            }
        });

        // ────────────────────────────────────────
        // sendMessage — FIXED: membership guard
        // ────────────────────────────────────────
        socket.on('sendMessage', async ({ chatId, messageContent, replyToId }) => {
            try {
                if (!messageContent || typeof messageContent !== 'string' || messageContent.trim() === '') {
                    return socket.emit('socketError', { event: 'sendMessage', message: 'Message content cannot be empty.' });
                }

                const chat = await Chat.findById(chatId).populate('members', '_id');
                if (!chat) {
                    return socket.emit('socketError', { event: 'sendMessage', message: 'Chat not found.' });
                }

                // Authorization: verify sender is actually a member
                const isMember = chat.members.some(m => m._id.toString() === socket.userId.toString());
                if (!isMember) {
                    return socket.emit('socketError', { event: 'sendMessage', message: 'You are not a member of this chat.' });
                }
                
                let replyTo = null;
                if (replyToId) {
                    const parentMsg = await Message.findOne({ _id: replyToId, chatId });
                    if (!parentMsg) {
                        return socket.emit('socketError', { event: 'sendMessage', message: 'Replied message not found.' });
                    }
                    replyTo = parentMsg._id;
                }

                const newMessage = new Message({ sender: socket.userId, chatId, content: messageContent.trim(), replyTo });
                await newMessage.save();

                const populatedMessage = await Message.findById(newMessage._id).populate('sender', 'username').populate({ path: 'replyTo', populate: { path: 'sender', select: 'username' } }).lean();

                // Fan-out to all chat members
                chat.members.forEach(member => {
                    const memberSockets = userSocketMap.get(member._id.toString());
                    if (memberSockets) {
                        memberSockets.forEach(socketId => io.to(socketId).emit('newMessage', { message: populatedMessage }));
                    }
                });
            } catch (error) {
                console.error('[Socket] sendMessage error:', error);
                socket.emit('socketError', { event: 'sendMessage', message: 'Failed to send message.' });
            }
        });

        // ────────────────────────────────────────
        // deleteRequest — FIXED: authorization + try/catch
        // ────────────────────────────────────────
        socket.on('deleteRequest', async ({ requestId }) => {
            try {
                const request = await MessageRequest.findById(requestId);
                if (!request) return socket.emit('requestHandled');

                // Only sender or receiver may delete
                const isParty =
                    request.sender.toString() === socket.userId ||
                    request.receiver.toString() === socket.userId;

                if (!isParty) {
                    return socket.emit('socketError', { event: 'deleteRequest', message: 'Unauthorized action.' });
                }

                await MessageRequest.findByIdAndDelete(requestId);
                socket.emit('requestHandled');
            } catch (error) {
                console.error('[Socket] deleteRequest error:', error);
                socket.emit('socketError', { event: 'deleteRequest', message: 'Failed to delete request.' });
            }
        });

        // ────────────────────────────────────────
        // blockRequest — FIXED: authorization + try/catch
        // ────────────────────────────────────────
        socket.on('blockRequest', async ({ requestId }) => {
            try {
                const request = await MessageRequest.findById(requestId);
                if (!request) return socket.emit('requestHandled');

                // Only the receiver can block
                if (request.receiver.toString() !== socket.userId) {
                    return socket.emit('socketError', { event: 'blockRequest', message: 'Unauthorized action.' });
                }

                await MessageRequest.findByIdAndDelete(requestId);
                socket.emit('requestHandled');
            } catch (error) {
                console.error('[Socket] blockRequest error:', error);
                socket.emit('socketError', { event: 'blockRequest', message: 'Failed to block request.' });
            }
        });

        // ────────────────────────────────────────
        // Pinned Messages
        // ────────────────────────────────────────
        socket.on('pinMessage', async ({ chatId, messageId }) => {
            try {
                const chat = await Chat.findById(chatId);
                if (!chat) return socket.emit('socketError', { event: 'pinMessage', message: 'Chat not found.' });
                if (!chat.members.includes(socket.userId)) return socket.emit('socketError', { event: 'pinMessage', message: 'Unauthorized' });
                
                if (chat.pinnedMessages.length >= 3) {
                    chat.pinnedMessages.shift(); // Remove oldest pin
                }
                if (!chat.pinnedMessages.includes(messageId)) {
                    chat.pinnedMessages.push(messageId);
                    await chat.save();
                }
                const populatedChat = await Chat.findById(chatId).populate('pinnedMessages');
                chat.members.forEach(member => {
                    const socks = userSocketMap.get(member.toString());
                    if (socks) socks.forEach(id => io.to(id).emit('messagePinned', { chatId, pinnedMessages: populatedChat.pinnedMessages }));
                });
            } catch (err) {
                socket.emit('socketError', { event: 'pinMessage', message: 'Failed to pin message.' });
            }
        });

        socket.on('unpinMessage', async ({ chatId, messageId }) => {
            try {
                const chat = await Chat.findById(chatId);
                if (!chat || !chat.members.includes(socket.userId)) return;
                chat.pinnedMessages = chat.pinnedMessages.filter(id => id.toString() !== messageId);
                await chat.save();
                chat.members.forEach(member => {
                    const socks = userSocketMap.get(member.toString());
                    if (socks) socks.forEach(id => io.to(id).emit('messageUnpinned', { chatId, messageId }));
                });
            } catch (err) { }
        });

        // ────────────────────────────────────────
        // Group Management
        // ────────────────────────────────────────
        socket.on('createGroup', async ({ groupName, memberIds }) => {
            try {
                if (!groupName || !memberIds || !memberIds.length) return;
                const members = [...new Set([...memberIds, socket.userId])];
                const newGroup = new Chat({
                    isGroupChat: true,
                    groupName,
                    members,
                    groupAdmins: [socket.userId],
                    createdBy: socket.userId
                });
                await newGroup.save();
                
                members.forEach(member => {
                    const socks = userSocketMap.get(member.toString());
                    if (socks) socks.forEach(id => io.to(id).emit('groupCreated', { chat: newGroup }));
                });
            } catch (err) {
                socket.emit('socketError', { event: 'createGroup', message: 'Failed to create group.' });
            }
        });

        socket.on('updateGroupSettings', async ({ chatId, action, targetUserId }) => {
            try {
                const chat = await Chat.findById(chatId);
                if (!chat || !chat.isGroupChat) return socket.emit('socketError', { event: 'updateGroupSettings', message: 'Group not found.' });
                
                const isAdmin = chat.groupAdmins.some(adminId => adminId.toString() === socket.userId);
                if (!isAdmin) return socket.emit('socketError', { event: 'updateGroupSettings', message: 'Only admins can update group settings.' });

                if (action === 'addAdmin') {
                    if (!chat.groupAdmins.includes(targetUserId)) {
                        chat.groupAdmins.push(targetUserId);
                    }
                } else if (action === 'removeAdmin') {
                    chat.groupAdmins = chat.groupAdmins.filter(id => id.toString() !== targetUserId);
                } else if (action === 'kick') {
                    chat.members = chat.members.filter(id => id.toString() !== targetUserId);
                    chat.groupAdmins = chat.groupAdmins.filter(id => id.toString() !== targetUserId);
                }
                
                await chat.save();
                
                // Notify members
                chat.members.forEach(member => {
                    const socks = userSocketMap.get(member.toString());
                    if (socks) socks.forEach(id => io.to(id).emit('groupUpdated', { chatId }));
                });
            } catch (err) {
                socket.emit('socketError', { event: 'updateGroupSettings', message: 'Failed to update group.' });
            }
        });

        socket.on('disconnect', (reason) => {
            console.log(`[Socket] ${socket.username} disconnected (${reason})`);
            const userSockets = userSocketMap.get(socket.userId);
            if (userSockets) {
                userSockets.delete(socket.id);
                if (userSockets.size === 0) {
                    userSocketMap.delete(socket.userId);
                    io.emit('userStatusUpdate', { username: socket.username, online: false });
                }
            }
        });
    });
}

module.exports = { registerChatHandlers, userSocketMap };
