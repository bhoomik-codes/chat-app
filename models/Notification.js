// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { // The user who receives this notification
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: { // e.g., 'messageRequest', 'requestAccepted', 'requestRejected', 'groupCreated', 'newChatMessage'
    type: String,
    required: true
  },
  message: { // The display message for the notification
    type: String,
    required: true
  },
  isRead: {
    type: Boolean,
    default: false
  },
  relatedEntity: { // Optional: Link to the MessageRequest or Chat document
    type: mongoose.Schema.Types.ObjectId,
    // No ref here, as it could refer to different models (MessageRequest, Chat)
    default: null
  },
  relatedEntityType: { // Optional: To know which model relatedEntity refers to
    type: String,
    enum: ['MessageRequest', 'Chat', null],
    default: null
  }
}, { timestamps: true });

// Index for efficient lookup of notifications for a user, sorted by creation time and read status
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
