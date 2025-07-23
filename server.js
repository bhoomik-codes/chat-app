// server.js
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// Import models
const User = require('./models/User');
const Message = require('./models/Message');
const Chat = require('./models/Chat');
const MessageRequest = require('./models/MessageRequest');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chat_app_db';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretdefaultkey';

mongoose.connect(MONGODB_URI).then(() => console.log('✅ Connected to MongoDB')).catch(err => console.error('❌ MongoDB connection error:', err));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/home.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));

// API Endpoint for Authentication
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }
    try {
        let user = await User.findOne({ username });
        if (!user) {
            user = await User.create({ username, password });
        } else {
            const isMatch = await user.comparePassword(password);
            if (!isMatch) {
                return res.status(401).json({ success: false, message: 'Invalid credentials.' });
            }
        }
        const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
        return res.status(200).json({ success: true, message: 'Login successful!', username: user.username, token });
    } catch (error) {
        console.error('Server error during authentication:', error);
        return res.status(500).json({ success: false, message: 'Server error.' });
    }
});

const userSocketMap = new Map();

// Helper function to emit notifications to a specific user
function sendNotification(userId, data) {
    const userSockets = userSocketMap.get(userId.toString());
    if (userSockets) {
        userSockets.forEach(socketId => {
            io.to(socketId).emit('newNotification', data);
        });
    }
}

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error: No token.'));
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.userId = decoded.userId;
        socket.username = decoded.username;
        next();
    } catch (error) {
        return next(new Error('Authentication error: Invalid token.'));
    }
});

io.on('connection', (socket) => {
    console.log(`${socket.username} connected`);
    if (!userSocketMap.has(socket.userId)) {
        userSocketMap.set(socket.userId, new Set());
    }
    userSocketMap.get(socket.userId).add(socket.id);

    io.emit('userStatusUpdate', { username: socket.username, online: true });

    socket.on('requestInitialData', async () => {
        try {
            const currentUser = await User.findById(socket.userId).populate('friends', 'username');
            if (!currentUser) return;
            const groups = await Chat.find({ isGroupChat: true, members: socket.userId }).select('groupName members');
            const sentRequests = await MessageRequest.find({ sender: socket.userId }).populate('receiver', 'username');
            const receivedRequests = await MessageRequest.find({ receiver: socket.userId }).populate('sender', 'username');
            const onlineUsernames = new Set();
            for (const userId of userSocketMap.keys()) {
                const user = await User.findById(userId, 'username');
                if (user) onlineUsernames.add(user.username);
            }
            socket.emit('initialData', { friends: currentUser.friends, groups, sentRequests, receivedRequests, onlineUsers: [...onlineUsernames] });
        } catch (error) {
            console.error('Error fetching initial data:', error);
        }
    });

    socket.on('searchUsers', async ({ searchTerm }) => {
        try {
            if (!searchTerm || searchTerm.trim() === '') return socket.emit('searchResults', { results: [] });
            const currentUser = await User.findById(socket.userId);
            const friendIds = currentUser.friends.map(f => f.toString());
            const users = await User.find({ username: { $regex: searchTerm, $options: 'i' }, _id: { $nin: [...friendIds, socket.userId] } }).select('username').limit(5);
            const groups = await Chat.find({ isGroupChat: true, groupName: { $regex: searchTerm, $options: 'i' } }).select('groupName members').limit(5);
            const results = [...users.map(u => ({ ...u.toObject(), type: 'user' })), ...groups.map(g => ({ ...g.toObject(), type: 'group' }))];
            socket.emit('searchResults', { results });
        } catch (error) {
            console.error('Error searching users/groups:', error);
        }
    });

    socket.on('loadChatContext', async ({ targetId, isGroup }) => {
        try {
            let chat;
            if (isGroup) {
                chat = await Chat.findById(targetId).populate('members', 'username');
            } else {
                const partner = await User.findById(targetId);
                if (!partner) return;
                chat = await Chat.findOne({ isGroupChat: false, members: { $all: [socket.userId, partner._id] } }).populate('members', 'username');
            }
            if (chat) {
                const messages = await Message.find({ chatId: chat._id }).populate('sender', 'username').sort({ createdAt: 1 });
                return socket.emit('chatContext', { type: 'existingChat', chat, messages });
            }
            if (!isGroup) {
                const partner = await User.findById(targetId);
                const request = await MessageRequest.findOne({ $or: [{ sender: socket.userId, receiver: partner._id }, { sender: partner._id, receiver: socket.userId }] }).populate('sender receiver initialMessage');
                if (request) {
                   if (request.initialMessage) await Message.populate(request.initialMessage, { path: 'sender', select: 'username' });
                   const contextType = request.sender._id.toString() === socket.userId ? 'requestSent' : 'requestReceived';
                   return socket.emit('chatContext', { type: contextType, request });
                }
                return socket.emit('chatContext', { type: 'new', partner: { username: partner.username, _id: partner._id } });
            }
        } catch (error) {
            console.error('Error loading chat context:', error);
        }
    });

    socket.on('sendInitialMessage', async ({ targetUserId, messageContent }) => {
        try {
            const newMsg = new Message({ sender: socket.userId, content: messageContent });
            await newMsg.save();
            await MessageRequest.create({ sender: socket.userId, receiver: targetUserId, initialMessage: newMsg._id, status: 'pending' });
            socket.emit('initialMessageSent');
            const receiverSockets = userSocketMap.get(targetUserId.toString());
            if (receiverSockets) {
                receiverSockets.forEach(socketId => io.to(socketId).emit('newRequestReceived'));
                // Send a desktop notification to the receiver
                sendNotification(targetUserId, {
                    title: "New Message Request",
                    body: `You have a new message request from ${socket.username}.`
                });
            }
        } catch (error) {
            console.error('Error sending initial message:', error);
        }
    });

    socket.on('acceptRequest', async ({ requestId }) => {
        try {
            const request = await MessageRequest.findById(requestId);
            if (!request || request.receiver.toString() !== socket.userId) return;

            await User.updateOne({ _id: request.sender }, { $addToSet: { friends: request.receiver } });
            await User.updateOne({ _id: request.receiver }, { $addToSet: { friends: request.sender } });

            const newChat = new Chat({ members: [request.sender, request.receiver] });
            if (request.initialMessage) {
                await Message.updateOne({ _id: request.initialMessage }, { $set: { chatId: newChat._id } });
                newChat.lastMessage = request.initialMessage;
            }
            await newChat.save();
            await MessageRequest.findByIdAndDelete(requestId);

            const populatedChat = await Chat.findById(newChat._id).populate('members', 'username');
            const messages = await Message.find({ chatId: newChat._id }).populate('sender', 'username').sort({ createdAt: 1 });
            const payload = { chat: populatedChat, messages };

            const senderSockets = userSocketMap.get(request.sender.toString());
            if (senderSockets) {
                senderSockets.forEach(id => io.to(id).emit('requestAccepted', payload));
                // Notify the original sender that their request was accepted
                sendNotification(request.sender, {
                    title: "Request Accepted",
                    body: `${socket.username} accepted your message request.`
                });
            }

            const receiverSockets = userSocketMap.get(request.receiver.toString());
            if (receiverSockets) receiverSockets.forEach(id => io.to(id).emit('requestAccepted', payload));

        } catch (error) {
            console.error("Error accepting request:", error);
        }
    });

    socket.on('sendMessage', async ({ chatId, messageContent }) => {
        try {
            const newMessage = new Message({ sender: socket.userId, chatId, content: messageContent });
            await newMessage.save();
            const populatedMessage = await Message.findById(newMessage._id).populate('sender', 'username');
            const chat = await Chat.findById(chatId).populate('members');
            if(chat) {
                chat.members.forEach(member => {
                    const memberSockets = userSocketMap.get(member._id.toString());
                    if (memberSockets) {
                        memberSockets.forEach(socketId => {
                            io.to(socketId).emit('newMessage', { message: populatedMessage });
                        });
                    }
                });
            }
        } catch (error) {
            console.error('Error sending message:', error);
        }
    });

    socket.on('deleteRequest', async ({ requestId }) => {
        await MessageRequest.findByIdAndDelete(requestId);
        socket.emit('requestHandled');
    });

    socket.on('blockRequest', async ({ requestId }) => {
        await MessageRequest.findByIdAndDelete(requestId);
        socket.emit('requestHandled');
    });

    socket.on('disconnect', () => {
        console.log(`${socket.username} disconnected`);
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
