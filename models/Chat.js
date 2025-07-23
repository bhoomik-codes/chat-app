// models/Chat.js
const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  // Members of the chat (User IDs) - for both direct and group chats
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isGroupChat: { type: Boolean, default: false },
  groupName: { type: String, default: null }, // Name for group chats
  groupAvatar: { type: String, default: null }, // Avatar URL for group chats
  // Reference to the last message in this chat, for quick display in chat lists
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
}, { timestamps: true });

// Add an index on members for faster lookup of chats involving specific users
// This ensures that finding a chat between two users, or all chats for a user, is efficient.
chatSchema.index({ members: 1 });

module.exports = mongoose.model('Chat', chatSchema);
