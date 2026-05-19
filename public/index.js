document.addEventListener('DOMContentLoaded', () => {
    const authToken = localStorage.getItem("authToken");
    if (!authToken) {
        location.href = "/";
        return;
    }

    const socket = io({ auth: { token: authToken } });

    // --- Global Variables ---
    let myUsername = localStorage.getItem("authenticatedUsername") || "";
    let currentChatContext = {};
    let friendsList = {};
    let onlineUsers = new Set();

    // --- Element Selectors ---
    const chatBox = document.getElementById("chatBox");
    const messageInput = document.getElementById("m");
    const userList = document.getElementById("userList");
    const userSearchInput = document.getElementById('userSearch');
    const chatWithHeader = document.getElementById("chat-with-header");
    const logoutButton = document.getElementById("logoutButton");
    const loggedInUsernameDisplay = document.getElementById('loggedInUsernameDisplay');
    const messageInputContainer = document.getElementById('messageInputContainer');
    const messageRequestBar = document.getElementById('messageRequestBar');
    const emojiButton = document.getElementById('emojiButton');
    const emojiPicker = document.querySelector('emoji-picker');
    const startCanvasBtn = document.getElementById('startCanvasBtn');
    const inputAreaWrapper = document.getElementById('inputAreaWrapper');
    const replyPreviewBar = document.getElementById('replyPreviewBar');
    const replyPreviewLabel = document.getElementById('replyPreviewLabel');
    const replyPreviewText = document.getElementById('replyPreviewText');
    const replyCancelBtn = document.getElementById('replyCancelBtn');

    // --- New Features Variables ---
    const newGroupBtn = document.getElementById('newGroupBtn');
    const groupModal = document.getElementById('groupModal');
    const cancelGroupBtn = document.getElementById('cancelGroupBtn');
    const confirmGroupBtn = document.getElementById('confirmGroupBtn');
    const groupNameInput = document.getElementById('groupNameInput');
    const groupFriendList = document.getElementById('groupFriendList');

    const profileCardBtn = document.getElementById('profileCardBtn');
    const profileDrawer = document.getElementById('profileDrawer');
    const closeProfileBtn = document.getElementById('closeProfileBtn');
    const saveProfileBtn = document.getElementById('saveProfileBtn');
    const profileQuoteInput = document.getElementById('profileQuoteInput');
    const profileColorInput = document.getElementById('profileColorInput');
    const profileCardName = document.getElementById('profileCardName');
    const profileCardStatus = document.getElementById('profileCardStatus');

    const contextMenu = document.getElementById('contextMenu');
    const ctxCopyBtn = document.getElementById('ctxCopyBtn');
    const ctxReplyBtn = document.getElementById('ctxReplyBtn');
    const ctxPinBtn = document.getElementById('ctxPinBtn');
    const toastContainer = document.getElementById('toastContainer');
    const pinnedHeaderBar = document.getElementById('pinnedHeaderBar');
    const pinnedMessagePreview = document.getElementById('pinnedMessagePreview');

    // --- Reply & Context State ---
    let replyContext = null; // { messageId, senderName, content }
    let contextTargetMessage = null; // { id, content, senderName }

    // --- Audio Context for Notification Sound ---
    let audioCtx;
    function playNotificationSound() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(600, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.2);
    }

    // --- Notification Permission ---
    function requestNotificationPermission() {
        if ('Notification' in window) {
            if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        console.log('Notification permission granted.');
                    }
                });
            }
        }
    }
    requestNotificationPermission();

    // --- Initial Setup ---
    if (myUsername) {
        loggedInUsernameDisplay.textContent = `Logged in as: ${myUsername}`;
        socket.emit("requestInitialData");
    } else {
        location.href = "/";
    }

    // --- Core Event Listeners ---
    document.getElementById("send").addEventListener("click", sendMessage);
    messageInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendMessage(); });

    // Reply cancel button
    replyCancelBtn.addEventListener('click', clearReply);
    logoutButton.addEventListener('click', () => {
        localStorage.clear();
        socket.disconnect();
        location.href = "/";
    });

    // --- Toast Helper ---
    function showToast(msg) {
        const t = document.createElement('div');
        t.className = 'toast';
        t.textContent = msg;
        toastContainer.appendChild(t);
        setTimeout(() => t.remove(), 3500);
    }

    // --- Profile Settings ---
    profileCardBtn.addEventListener('click', () => profileDrawer.classList.remove('hidden'));
    closeProfileBtn.addEventListener('click', () => profileDrawer.classList.add('hidden'));
    saveProfileBtn.addEventListener('click', async () => {
        const statusQuote = profileQuoteInput.value;
        const bannerColor = profileColorInput.value;
        try {
            const res = await fetch('/api/user/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify({ statusQuote, bannerColor })
            });
            const data = await res.json();
            if (data.success) {
                profileCardStatus.textContent = statusQuote || 'Ready';
                document.querySelector('.profile-avatar').style.backgroundColor = bannerColor;
                showToast('Profile updated!');
                profileDrawer.classList.add('hidden');
            } else {
                showToast('Failed to update profile.');
            }
        } catch (e) {
            showToast('Error updating profile.');
        }
    });

    // --- Group Creation ---
    newGroupBtn.addEventListener('click', () => {
        groupNameInput.value = '';
        groupFriendList.innerHTML = '';
        Object.entries(friendsList).forEach(([name, data]) => {
            if (data.type === 'user' && data.status === 'friend') {
                const label = document.createElement('label');
                label.className = 'friend-select-item';
                label.innerHTML = `<input type="checkbox" value="${data._id}"> ${name}`;
                groupFriendList.appendChild(label);
            }
        });
        groupModal.classList.remove('hidden');
    });
    cancelGroupBtn.addEventListener('click', () => groupModal.classList.add('hidden'));
    confirmGroupBtn.addEventListener('click', () => {
        const groupName = groupNameInput.value.trim();
        const selected = Array.from(groupFriendList.querySelectorAll('input:checked')).map(cb => cb.value);
        if (groupName && selected.length > 0) {
            socket.emit('createGroup', { groupName, memberIds: selected });
            groupModal.classList.add('hidden');
        } else {
            showToast('Enter a name and select members.');
        }
    });

    // --- Context Menu Actions ---
    document.body.addEventListener('click', () => contextMenu.classList.add('hidden'));
    
    ctxCopyBtn.addEventListener('click', () => {
        if (!contextTargetMessage) return;
        navigator.clipboard.writeText(contextTargetMessage.content).then(() => {
            showToast('Scroll copied to clipboard!');
        });
    });
    
    ctxReplyBtn.addEventListener('click', () => {
        if (!contextTargetMessage) return;
        setReply(contextTargetMessage.id, contextTargetMessage.senderName, contextTargetMessage.content);
    });
    
    ctxPinBtn.addEventListener('click', () => {
        if (!contextTargetMessage || !currentChatContext.chat) return;
        const isPinned = currentChatContext.chat.pinnedMessages?.some(m => (m._id || m) === contextTargetMessage.id);
        if (isPinned) {
            socket.emit('unpinMessage', { chatId: currentChatContext.chat._id, messageId: contextTargetMessage.id });
        } else {
            socket.emit('pinMessage', { chatId: currentChatContext.chat._id, messageId: contextTargetMessage.id });
        }
    });

    // ── Canvas Launch Button ───────────────────────────────────────────────
    startCanvasBtn.addEventListener('click', () => {
        if (currentChatContext.type === 'existingChat') {
            const room = `kasugai-room-${currentChatContext.chat._id}`;
            const url  = `/canvas.html?username=${encodeURIComponent(myUsername)}&roomId=${encodeURIComponent(room)}`;
            // Send invite message
            socket.emit('sendMessage', { chatId: currentChatContext.chat._id, messageContent: `$$CANVAS_INVITE$$${room}` });
            window.open(url, '_blank');
        }
    });

    // Handle Join Canvas clicks in chat
    chatBox.addEventListener('click', (e) => {
        if (e.target.classList.contains('join-scroll-btn')) {
            const room = e.target.dataset.room;
            const url  = `/canvas.html?username=${encodeURIComponent(myUsername)}&roomId=${encodeURIComponent(room)}`;
            window.open(url, '_blank');
        }
    });

    userList.addEventListener("click", (e) => {
        const listItem = e.target.closest('li.user-item');
        if (listItem) {
            document.querySelectorAll('#userList .user-item.active').forEach(item => item.classList.remove('active'));
            listItem.classList.add('active');
            const targetId = listItem.dataset.id;
            const isGroup = listItem.dataset.isgroup === 'true';
            socket.emit('loadChatContext', { targetId, isGroup });
            
            // Activate chat on mobile
            document.querySelector('.app-container').classList.add('chat-active');
        }
    });

    const mobileBackBtn = document.getElementById('mobileBackBtn');
    if (mobileBackBtn) {
        mobileBackBtn.addEventListener('click', () => {
            document.querySelector('.app-container').classList.remove('chat-active');
            // Deselect user locally
            document.querySelectorAll('#userList .user-item.active').forEach(item => item.classList.remove('active'));
        });
    }

    userSearchInput.addEventListener('input', () => {
        const searchTerm = userSearchInput.value.trim();
        if (searchTerm === '') {
            populateUserList(friendsList);
        } else {
            socket.emit('searchUsers', { searchTerm });
        }
    });

    userSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const firstUserItem = userList.querySelector('.user-item');
            if (firstUserItem) {
                firstUserItem.click();
            }
        }
    });

    // --- Emoji Picker Listeners ---
    emojiButton.addEventListener('click', (e) => {
        e.stopPropagation();
        emojiPicker.classList.toggle('hidden');
    });
    emojiPicker.addEventListener('emoji-click', event => messageInput.value += event.detail.unicode);
    document.body.addEventListener('click', () => emojiPicker.classList.add('hidden'));

    // --- Socket Event Handlers ---
    socket.on('initialData', ({ friends, groups, sentRequests, receivedRequests, onlineUsers: onlineUserList }) => {
        onlineUsers = new Set(onlineUserList);
        const partners = {};

        friends.forEach(u => partners[u.username] = { type: 'user', status: 'friend', online: onlineUsers.has(u.username), _id: u._id });
        groups.forEach(g => partners[g.groupName] = { type: 'group', status: 'group', memberCount: g.members.length, _id: g._id });
        sentRequests.forEach(req => partners[req.receiver.username] = { type: 'user', status: 'requestSent', online: onlineUsers.has(req.receiver.username), _id: req.receiver._id });
        receivedRequests.forEach(req => partners[req.sender.username] = { type: 'user', status: 'requestReceived', online: onlineUsers.has(req.sender.username), _id: req.sender._id });

        friendsList = partners;
        populateUserList(partners);
    });

    socket.on('searchResults', ({ results }) => {
        const searchResultPartners = {};
        results.forEach(res => {
            if (res.type === 'user') {
                searchResultPartners[res.username] = { type: 'user', status: 'new', online: onlineUsers.has(res.username), _id: res._id };
            } else if (res.type === 'group') {
                searchResultPartners[res.groupName] = { type: 'group', status: 'group', memberCount: res.members.length, _id: res._id };
            }
        });
        populateUserList(searchResultPartners);
    });

    socket.on('userStatusUpdate', ({ username, online }) => {
        if (online) onlineUsers.add(username);
        else onlineUsers.delete(username);
        const userItemDot = document.querySelector(`li[data-username="${username}"] .status-dot`);
        if (userItemDot) userItemDot.className = `status-dot ${online ? 'online' : 'offline'}`;
    });

    socket.on('chatContext', (context) => {
        currentChatContext = context;
        chatBox.innerHTML = "";
        switch (context.type) {
            case 'existingChat':
                const chatName = context.chat.isGroupChat ? context.chat.groupName : context.chat.members.find(m => m.username !== myUsername).username;
                chatWithHeader.textContent = `Chat with ${chatName}`;
                startCanvasBtn.classList.remove('hidden');
                context.messages.forEach(msg => appendMessage(msg));
                showRequestBar(false);
                showChatInput(true);
                updatePinnedHeader();
                break;
            case 'requestSent':
                chatWithHeader.textContent = `Request to ${context.request.receiver.username}`;
                startCanvasBtn.classList.add('hidden');
                appendSystemMessage("You sent a request. Awaiting response.");
                if(context.request.initialMessage) appendMessage(context.request.initialMessage);
                showRequestBar(false);
                showChatInput(false);
                break;
            case 'requestReceived':
                chatWithHeader.textContent = `Request from ${context.request.sender.username}`;
                startCanvasBtn.classList.add('hidden');
                if(context.request.initialMessage) appendMessage(context.request.initialMessage);
                showRequestBar(true, context.request);
                showChatInput(false);
                break;
            case 'new':
                chatWithHeader.textContent = `Start chat with ${context.partner.username}`;
                startCanvasBtn.classList.add('hidden');
                appendSystemMessage(`Send a message to connect with ${context.partner.username}.`);
                showRequestBar(false);
                showChatInput(true);
                break;
        }
    });

    socket.on('newMessage', ({ message }) => {
        if (currentChatContext.type === 'existingChat' && currentChatContext.chat._id === message.chatId) {
            appendMessage(message);
        }
        if (document.hidden && Notification.permission === 'granted' && message.sender.username !== myUsername) {
            new Notification(`New message from ${message.sender.username}`, {
                body: message.content,
                icon: 'https://placehold.co/40x40/6a5af9/FFFFFF?text=💬'
            });
            playNotificationSound();
        }
    });

    socket.on('newNotification', (data) => {
        if (document.hidden && Notification.permission === 'granted') {
            new Notification(data.title, {
                body: data.body,
                icon: 'https://placehold.co/40x40/6a5af9/FFFFFF?text=🔔'
            });
            playNotificationSound();
        }
    });

    const refreshAndLoadChat = (chat) => {
        userSearchInput.value = '';
        socket.emit("requestInitialData");

        setTimeout(() => {
            let targetId;
            if (chat.isGroupChat) {
                targetId = chat._id;
            } else {
                const partner = chat.members.find(member => member.username !== myUsername);
                if (partner) targetId = partner._id;
            }
            if (targetId) {
                const userItem = document.querySelector(`li[data-id="${targetId}"]`);
                if (userItem) userItem.click();
            }
        }, 150);
    };

    socket.on('requestAccepted', ({ chat }) => refreshAndLoadChat(chat));
    socket.on('initialMessageSent', () => socket.emit("requestInitialData"));
    socket.on('newRequestReceived', () => socket.emit("requestInitialData"));

    socket.on('requestHandled', () => {
        socket.emit("requestInitialData");
        chatWithHeader.textContent = "Select a user to start chatting";
        startCanvasBtn.classList.add('hidden');
        chatBox.innerHTML = "";
        showRequestBar(false);
        showChatInput(false);
    });

    socket.on('messagePinned', ({ chatId, pinnedMessages }) => {
        if (currentChatContext.type === 'existingChat' && currentChatContext.chat._id === chatId) {
            currentChatContext.chat.pinnedMessages = pinnedMessages;
            updatePinnedHeader();
        }
    });
    
    socket.on('messageUnpinned', ({ chatId, messageId }) => {
        if (currentChatContext.type === 'existingChat' && currentChatContext.chat._id === chatId) {
            currentChatContext.chat.pinnedMessages = currentChatContext.chat.pinnedMessages.filter(m => (m._id || m) !== messageId);
            updatePinnedHeader();
        }
    });

    socket.on('groupCreated', ({ chat }) => {
        socket.emit("requestInitialData");
    });

    let currentPinIndex = 0;
    function updatePinnedHeader() {
        const pins = currentChatContext.chat?.pinnedMessages || [];
        if (pins.length > 0) {
            pinnedHeaderBar.classList.remove('hidden');
            const pin = pins[currentPinIndex % pins.length];
            const pContent = pin.content || "Pinned message";
            pinnedMessagePreview.textContent = pContent.length > 50 ? pContent.substring(0,50)+'...' : pContent;
            pinnedHeaderBar.onclick = () => {
                currentPinIndex++;
                updatePinnedHeader();
                const msgEl = document.querySelector(`.message-wrapper[data-id="${pin._id || pin}"] .message`);
                if (msgEl) {
                    msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    msgEl.classList.add('highlight');
                    setTimeout(() => msgEl.classList.remove('highlight'), 1000);
                }
            };
        } else {
            pinnedHeaderBar.classList.add('hidden');
        }
    }

    function populateUserList(partners) {
        userList.innerHTML = "";
        Object.entries(partners).forEach(([name, data]) => {
            const li = document.createElement("li");
            li.className = "user-item";
            li.dataset.id = data._id;

            if (data.type === 'group') {
                li.dataset.isgroup = 'true';
                li.innerHTML = `
                    <img class="avatar" src="https://placehold.co/40x40/6a5af9/FFFFFF?text=G" alt="Group Avatar">
                    <span class="username">[CORPS UNIT] ${name}</span>
                    <span class="status-label group">${data.memberCount} members</span>`;
            } else {
                li.dataset.isgroup = 'false';
                li.dataset.username = name;
                let statusLabel = '';
                if (data.status === 'requestSent') statusLabel = '<span class="status-label sent">Sent</span>';
                if (data.status === 'requestReceived') statusLabel = '<span class="status-label received">Request</span>';
                li.innerHTML = `
                    <img class="avatar" src="https://placehold.co/40x40/4f586a/E0E0E0?text=${name.charAt(0).toUpperCase()}" alt="Avatar">
                    <span class="username">${name}</span>
                    ${statusLabel}
                    <span class="status-dot ${data.online ? 'online' : 'offline'}"></span>`;
            }
            userList.appendChild(li);
        });
    }

    function appendMessage(msg) {
        if (!msg || !msg.sender) return;
        const isSelf = msg.sender.username === myUsername;
        const date = new Date(msg.createdAt || Date.now());

        // Outer wrapper (holds message bubble + reply button)
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${isSelf ? 'self' : 'other'}`;
        wrapper.dataset.id = msg._id;
        
        const msgDiv = document.createElement("div");
        msgDiv.className = `message ${isSelf ? 'self' : 'other'}`;

        // Reply quote block (if this message is a reply)
        let replyQuoteHtml = '';
        if (msg.replyTo) {
            const rSender = msg.replyTo.senderName || (msg.replyTo.sender && msg.replyTo.sender.username) || 'Unknown';
            replyQuoteHtml = `
                <div class="reply-quote" data-target="${msg.replyTo._id}">
                    <div class="reply-quote-author">${rSender}</div>
                    <div class="reply-quote-text">${msg.replyTo.content}</div>
                </div>`;
        }
        
        if (msg.content.startsWith('$$CANVAS_INVITE$$')) {
            const roomId = msg.content.substring(17);
            msgDiv.innerHTML = `
                <div class="message-content">
                    ${replyQuoteHtml}
                    <strong>${isSelf ? 'You' : msg.sender.username}</strong>
                    <p>🎨 I've opened a collaborative Scroll Canvas.</p>
                    <button class="join-scroll-btn" data-room="${roomId}" style="margin-top: 8px; padding: 6px 12px; background: linear-gradient(135deg, var(--gold-dim) 0%, var(--gold) 100%); color: var(--night); border: none; border-radius: 6px; cursor: pointer; font-family: var(--font-display); font-weight: 600;">Join Scroll &nbsp;→</button>
                    <span class="timestamp">${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>`;
        } else {
            msgDiv.innerHTML = `
                <div class="message-content">
                    ${replyQuoteHtml}
                    <strong>${isSelf ? 'You' : msg.sender.username}</strong>
                    <p>${msg.content}</p>
                    <span class="timestamp">${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>`;
        }

        // Add scroll to reply handler
        const quoteBlock = msgDiv.querySelector('.reply-quote');
        if (quoteBlock) {
            quoteBlock.style.cursor = 'pointer';
            quoteBlock.style.borderLeft = '4px solid var(--gold)';
            quoteBlock.style.background = 'rgba(212, 175, 55, 0.1)';
            quoteBlock.style.padding = '5px';
            quoteBlock.style.marginBottom = '5px';
            quoteBlock.addEventListener('click', () => {
                const targetId = quoteBlock.dataset.target;
                const targetEl = document.querySelector(`.message-wrapper[data-id="${targetId}"] .message`);
                if (targetEl) {
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetEl.classList.add('highlight');
                    setTimeout(() => targetEl.classList.remove('highlight'), 1000);
                }
            });
        }

        // Context Menu Handler
        msgDiv.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            contextTargetMessage = { id: msg._id, content: msg.content, senderName: isSelf ? 'You' : msg.sender.username };
            
            // Check if pinned to update pin button text
            const isPinned = currentChatContext.chat?.pinnedMessages?.some(m => (m._id || m) === msg._id);
            ctxPinBtn.innerHTML = isPinned ? '<i class="fa-solid fa-thumbtack-slash"></i> Unpin' : '<i class="fa-solid fa-thumbtack"></i> Pin';
            
            contextMenu.style.left = `${e.pageX}px`;
            contextMenu.style.top = `${e.pageY}px`;
            contextMenu.classList.remove('hidden');
        });

        // Reply button
        const replyBtn = document.createElement('button');
        replyBtn.className = 'reply-btn';
        replyBtn.title = 'Reply';
        replyBtn.innerHTML = '<i class="fa-solid fa-reply"></i>';
        replyBtn.addEventListener('click', () => {
            setReply(msg._id, msg.sender.username === myUsername ? 'You' : msg.sender.username, msg.content);
        });

        wrapper.appendChild(msgDiv);
        wrapper.appendChild(replyBtn);

        chatBox.appendChild(wrapper);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function appendSystemMessage(text) {
        const systemDiv = document.createElement("div");
        systemDiv.className = "system-message";
        systemDiv.textContent = text;
        chatBox.appendChild(systemDiv);
    }

    function showChatInput(show) {
        // Toggle the entire input area wrapper
        inputAreaWrapper.classList.toggle('hidden', !show);
        if (!show) clearReply();
    }

    function showRequestBar(show, request = null) {
        messageRequestBar.classList.toggle('hidden', !show);
        if (show && request) {
            document.getElementById('requestSenderName').textContent = request.sender.username;
            document.getElementById('acceptRequestBtn').onclick = () => socket.emit('acceptRequest', { requestId: request._id });
            document.getElementById('deleteRequestBtn').onclick = () => socket.emit('deleteRequest', { requestId: request._id });
            document.getElementById('blockRequestBtn').onclick = () => socket.emit('blockRequest', { requestId: request._id });
        }
    }

    function sendMessage() {
        const content = messageInput.value.trim();
        if (!content) return;

        if (currentChatContext.type === 'existingChat') {
            socket.emit('sendMessage', {
                chatId: currentChatContext.chat._id,
                messageContent: content,
                replyToId: replyContext ? replyContext.messageId : null
            });
        } else if (currentChatContext.type === 'new') {
            socket.emit('sendInitialMessage', { targetUserId: currentChatContext.partner._id, messageContent: content });
        }

        messageInput.value = "";
        clearReply();
    }

    function setReply(messageId, senderName, content) {
        replyContext = { messageId, senderName, content };
        replyPreviewLabel.textContent = `Replying to ${senderName}`;
        // Truncate long messages in preview
        replyPreviewText.textContent = content.length > 80 ? content.slice(0, 80) + '…' : content;
        replyPreviewBar.classList.remove('hidden');
        messageInput.focus();
    }

    function clearReply() {
        replyContext = null;
        replyPreviewBar.classList.add('hidden');
        replyPreviewLabel.textContent = '';
        replyPreviewText.textContent = '';
    }
});
