/**
 * canvas.js — KASUGAI Scroll Canvas
 *
 * Key improvements over original:
 *  - Socket listeners registered ONCE via a shared `attachSocketListeners()`
 *    function (original duplicated all listeners in two code paths)
 *  - Canvas resolution correctly accounts for device pixel ratio (sharp on HiDPI)
 *  - Clipboard API replaces deprecated document.execCommand('copy')
 *  - Slider thumb position tracks value dynamically via CSS custom property
 *  - WebP export format added
 *  - Colour preset palette with active-state tracking
 *  - Full touch support preserved
 */

'use strict';

const SOCKET_SERVER_URL = window.location.origin;

// ── DOM refs ──────────────────────────────────────────────────────────────
const canvas         = document.getElementById('drawingCanvas');
const ctx            = canvas.getContext('2d');

const colorPicker    = document.getElementById('colorPicker');
const colorPresetsCt = document.getElementById('colorPresets');
const thicknessSlider= document.getElementById('thicknessSlider');
const thicknessValue = document.getElementById('thicknessValue');
const eraserBtn      = document.getElementById('eraserBtn');
const clearBtn       = document.getElementById('clearBtn');
const undoBtn        = document.getElementById('undoBtn');
const redoBtn        = document.getElementById('redoBtn');
const saveBtn        = document.getElementById('saveBtn');
const saveFormatSel  = document.getElementById('saveFormat');
const closeCanvasBtn = document.getElementById('closeCanvasBtn');

const roomModal      = document.getElementById('roomModal');
const usernameInput  = document.getElementById('usernameInput');
const roomInput      = document.getElementById('roomInput');
const joinRoomBtn    = document.getElementById('joinRoomBtn');
const appContainer   = document.getElementById('appContainer');
const currentRoomId  = document.getElementById('currentRoomId');
const copyRoomIdBtn  = document.getElementById('copyRoomIdBtn');
const contributorsList = document.getElementById('contributorsList');
const toast          = document.getElementById('toast');

// ── State ─────────────────────────────────────────────────────────────────
let socket         = null;
let username       = '';
let roomId         = '';
let isDrawing      = false;
let lastX          = 0;
let lastY          = 0;
let currentStroke  = null;
let currentColor   = colorPicker.value;
let currentThick   = parseInt(thicknessSlider.value, 10);
let isErasing      = false;
let drawingHistory = [];
let undoneHistory  = [];
let toastTimer     = null;

// ── Camera State ──────────────────────────────────────────────────────────
let cameraX = 0;
let cameraY = 0;
let zoom    = 1.0;
const keys  = { w: false, a: false, s: false, d: false, q: false, e: false };
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let initialPinchDistance = null;
let lastTouchPanX = 0;
let lastTouchPanY = 0;
let touchTimer = null;
let isTouchHeld = false;
let touchStartX = 0;
let touchStartY = 0;

// ── Colour Presets ────────────────────────────────────────────────────────
const PRESETS = [
    '#EFE8D1', // Parchment Cream
    '#DFA83E', // Lantern Gold
    '#731A1E', // Blood Crimson
    '#10101A', // Deep Night
    '#2C3036', // Slate Shadow
    '#33261C', // Aged Timber
    '#3a7bd5', // Cerulean
    '#2ecc71', // Jade
    '#e67e22', // Ember
    '#9b59b6', // Amethyst
    '#1abc9c', // Teal
    '#ffffff', // White
];

function buildPresets() {
    PRESETS.forEach(hex => {
        const swatch = document.createElement('div');
        swatch.className = 'color-preset';
        swatch.style.background = hex;
        swatch.title = hex;
        swatch.dataset.color = hex;
        if (hex === currentColor) swatch.classList.add('active');
        swatch.addEventListener('click', () => {
            setColor(hex);
            colorPicker.value = hex;
        });
        colorPresetsCt.appendChild(swatch);
    });
}

function setColor(hex) {
    currentColor = hex;
    isErasing = false;
    ctx.strokeStyle = hex;
    eraserBtn.classList.remove('btn-eraser-active');
    // Update active swatch
    document.querySelectorAll('.color-preset').forEach(s => {
        s.classList.toggle('active', s.dataset.color === hex);
    });
}

// ── Toast ─────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.className = `toast ${type} show`;
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// ── Canvas Setup & Resize ─────────────────────────────────────────────────
function resizeCanvas() {
    const wrap = canvas.parentElement;
    const dpr  = window.devicePixelRatio || 1;

    // On mobile the wrap may have zero height immediately after display:flex.
    // Use requestAnimationFrame to ensure layout is complete.
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;

    if (w === 0 || h === 0) {
        // Retry once layout settles
        requestAnimationFrame(() => resizeCanvas());
        return;
    }

    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';

    redrawCanvas();
}

// ── Camera Controls ───────────────────────────────────────────────────────
function updateCamera() {
    let moved = false;
    const speed = 15;
    
    // Pan
    if (keys.w) { cameraY += speed; moved = true; }
    if (keys.s) { cameraY -= speed; moved = true; }
    if (keys.a) { cameraX += speed; moved = true; }
    if (keys.d) { cameraX -= speed; moved = true; }
    
    // Zoom
    if (keys.q) { zoomCamera(1.03); moved = true; }
    if (keys.e) { zoomCamera(1 / 1.03); moved = true; }
    
    if (moved) redrawCanvas();
    requestAnimationFrame(updateCamera);
}
requestAnimationFrame(updateCamera);

function zoomCamera(factor, focusX = canvas.width / 2, focusY = canvas.height / 2) {
    const newZoom = Math.min(Math.max(zoom * factor, 0.1), 10.0);
    const zoomRatio = newZoom / zoom;
    
    cameraX = focusX - (focusX - cameraX) * zoomRatio;
    cameraY = focusY - (focusY - cameraY) * zoomRatio;
    zoom = newZoom;
}

function applyCameraTransform() {
    ctx.setTransform(zoom, 0, 0, zoom, cameraX, cameraY);
}

// ── Rendering ─────────────────────────────────────────────────────────────
function clearVisual() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#10101A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function redrawCanvas() {
    clearVisual();
    applyCameraTransform();

    drawingHistory.forEach(action => {
        if (action.type === 'clear') { 
            clearVisual(); 
            applyCameraTransform(); 
            return; 
        }
        if (action.type !== 'stroke' || action.points.length < 2) return;
        
        ctx.beginPath();
        ctx.moveTo(action.points[0].x, action.points[0].y);
        for (let i = 1; i < action.points.length; i++) {
            ctx.lineTo(action.points[i].x, action.points[i].y);
        }
        ctx.strokeStyle = action.color;
        ctx.lineWidth   = action.thickness;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.stroke();
    });
    
    // Render current active stroke
    if (isDrawing && currentStroke && currentStroke.points.length > 0) {
        ctx.beginPath();
        ctx.moveTo(currentStroke.points[0].x, currentStroke.points[0].y);
        for (let i = 1; i < currentStroke.points.length; i++) {
            ctx.lineTo(currentStroke.points[i].x, currentStroke.points[i].y);
        }
        ctx.strokeStyle = currentStroke.color;
        ctx.lineWidth   = currentStroke.thickness;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.stroke();
    }
}

function updateHistoryButtons() {
    undoBtn.disabled = drawingHistory.length === 0;
    redoBtn.disabled = undoneHistory.length === 0;
}

// ── Drawing ───────────────────────────────────────────────────────────────
function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    let clientX, clientY;
    
    if (e.touches) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    
    const canvasX = (clientX - rect.left) * dpr;
    const canvasY = (clientY - rect.top) * dpr;
    
    return {
        x: (canvasX - cameraX) / zoom,
        y: (canvasY - cameraY) / zoom
    };
}

function getRawPos(e) {
    if (e.touches) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
}

function startDrawing(e) {
    if (!socket?.connected) return;
    
    // Right-click to pan
    if (e.button === 2) {
        isPanning = true;
        const raw = getRawPos(e);
        panStartX = raw.x;
        panStartY = raw.y;
        canvas.style.cursor = 'grabbing';
        return;
    }
    
    // Only draw on left click (0) or touch
    if (e.button !== 0 && !e.touches) return;

    isDrawing = true;
    const p = getPos(e);
    lastX = p.x;
    lastY = p.y;
    currentStroke = {
        type: 'stroke',
        color: isErasing ? '#10101A' : currentColor,
        thickness: currentThick,
        points: [{ x: p.x, y: p.y }]
    };
}

function draw(e) {
    if (!socket?.connected) return;

    if (isPanning) {
        const raw = getRawPos(e);
        const dpr = window.devicePixelRatio || 1;
        const dx = (raw.x - panStartX) * dpr;
        const dy = (raw.y - panStartY) * dpr;
        
        cameraX += dx;
        cameraY += dy;
        
        panStartX = raw.x;
        panStartY = raw.y;
        redrawCanvas();
        return;
    }

    if (!isDrawing || !currentStroke) return;
    const p = getPos(e);
    
    // Draw segment locally for immediate feedback
    applyCameraTransform();
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = currentStroke.color;
    ctx.lineWidth   = currentStroke.thickness;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform
    
    currentStroke.points.push({ x: p.x, y: p.y });
    
    socket.emit('drawingLive', {
        x1: lastX, y1: lastY,
        x2: p.x, y2: p.y,
        color: currentStroke.color,
        thickness: currentStroke.thickness
    });
    
    lastX = p.x;
    lastY = p.y;
}

function stopDrawing(e) { 
    if (isPanning) {
        isPanning = false;
        canvas.style.cursor = 'crosshair';
        return;
    }
    
    if (isDrawing && currentStroke && currentStroke.points.length > 1) {
        drawingHistory.push(currentStroke);
        undoneHistory = [];
        updateHistoryButtons();
        socket.emit('drawing', currentStroke);
    }
    isDrawing = false; 
    currentStroke = null;
}

// ── Save ──────────────────────────────────────────────────────────────────
function saveCanvas() {
    const format  = saveFormatSel.value;
    const ext     = format.split('/')[1];
    const quality = format === 'image/jpeg' ? 0.92 : 1.0;

    // To save the whole drawing regardless of zoom, we should render history 
    // onto an unscaled background canvas, or just save the current view.
    // Saving the current view is standard.
    const tmp    = document.createElement('canvas');
    tmp.width    = canvas.width;
    tmp.height   = canvas.height;
    const tctx   = tmp.getContext('2d');
    
    tctx.fillStyle = '#10101A';
    tctx.fillRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(canvas, 0, 0);

    const url = tmp.toDataURL(format, quality);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `kasugai-scroll-${Date.now()}.${ext}`;
    a.click();
    showToast(`Scroll saved as ${ext.toUpperCase()}! 📜`);
}

// ── Contributor List ──────────────────────────────────────────────────────
function renderContributors(users) {
    // Desktop panel
    contributorsList.innerHTML = '';
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'contributor-item';
        div.innerHTML = `
            <div class="contributor-avatar">${user.username.charAt(0).toUpperCase()}</div>
            <span class="contributor-name">${user.username}</span>
            ${user.username === username ? '<span class="contributor-you">You</span>' : ''}
        `;
        contributorsList.appendChild(div);
    });

    // Mobile people panel
    const mobList = document.getElementById('mobilePeopleList');
    if (mobList) {
        mobList.innerHTML = '';
        users.forEach(user => {
            const div = document.createElement('div');
            div.className = 'contributor-item';
            div.innerHTML = `
                <div class="contributor-avatar">${user.username.charAt(0).toUpperCase()}</div>
                <span class="contributor-name">${user.username}</span>
                ${user.username === username ? '<span class="contributor-you">You</span>' : ''}
            `;
            mobList.appendChild(div);
        });
    }
}

// ── Socket ────────────────────────────────────────────────────────────────
/**
 * Attaches all socket event listeners.
 * Called ONCE after socket is created — fixes the original code's duplication
 * of every listener across the two join code paths.
 */
function attachSocketListeners() {
    socket.on('connect', () => {
        socket.emit('joinRoom', { username, roomId });
        showToast(`Joining room "${roomId}"…`);
    });

    socket.on('connect_error', (err) => {
        console.error('[Canvas] Socket error:', err);
        showToast(err.message.includes('Authentication')
            ? 'Authentication failed. Returning to chat…'
            : 'Could not reach the drawing server.', 'error');
        if (err.message.includes('Authentication')) {
            setTimeout(() => { window.location.href = 'home.html'; }, 1800);
        }
    });

    socket.on('joinedRoom', (data) => {
        currentRoomId.textContent = data.roomId;
        drawingHistory = data.history || [];
        undoneHistory  = [];
        renderContributors(data.users || []);
        roomModal.classList.add('hidden');
        appContainer.style.display = 'flex';
        resizeCanvas(); // Important: must resize after container is visible
        updateHistoryButtons();
        showToast(`Welcome to "${data.roomId}"! 🐦‍⬛`);
    });

    socket.on('userJoined', (data) => {
        showToast(`${data.username} joined the scroll room.`);
        renderContributors(data.users || []);
    });

    socket.on('userLeft', (data) => {
        showToast(`${data.username} departed.`, 'error');
        renderContributors(data.users || []);
    });

    socket.on('drawing', (action) => {
        drawingHistory.push(action);
        redrawCanvas();
        updateHistoryButtons();
    });
    
    socket.on('drawingLive', (segment) => {
        applyCameraTransform();
        ctx.beginPath();
        ctx.moveTo(segment.x1, segment.y1);
        ctx.lineTo(segment.x2, segment.y2);
        ctx.strokeStyle = segment.color;
        ctx.lineWidth   = segment.thickness;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.stroke();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    });

    socket.on('undo', (data) => {
        drawingHistory = data.history;
        undoneHistory  = data.undone;
        redrawCanvas();
        updateHistoryButtons();
        showToast(`${data.username} undid a stroke.`);
    });

    socket.on('redo', (data) => {
        drawingHistory = data.history;
        undoneHistory  = data.undone;
        redrawCanvas();
        updateHistoryButtons();
        showToast(`${data.username} redid a stroke.`);
    });

    socket.on('clearCanvas', (data) => {
        drawingHistory = [];
        undoneHistory  = [];
        clearVisual();
        updateHistoryButtons();
        showToast(`${data.username} cleared the scroll.`, 'error');
    });

    socket.on('updateUsers', (users) => {
        renderContributors(users);
    });
}

function createSocket(token) {
    socket = io(SOCKET_SERVER_URL, { auth: { token } });
    attachSocketListeners(); // Single registration
}

// ── Mobile UI ──────────────────────────────────────────────────────────────────
function initMobileUI() {
    const drawer        = document.getElementById('mobileToolDrawer');
    const actionBar     = document.getElementById('mobileActionBar');
    if (!actionBar) return; // Not on canvas page

    const mobColorSwatch= document.getElementById('mobColorSwatch');
    const mobSizeSlider = document.getElementById('mobSizeSlider');
    const mobSizeLabel  = document.getElementById('mobSizeLabel');
    const mobEraserBtn  = document.getElementById('mobEraserBtn');
    const mobUndoBtn    = document.getElementById('mobUndoBtn');
    const mobRedoBtn    = document.getElementById('mobRedoBtn');
    const mobPeopleBtn  = document.getElementById('mobPeopleBtn');
    const mobExpandBtn  = document.getElementById('mobExpandBtn');
    const mobExpandIcon = document.getElementById('mobExpandIcon');

    const drawerPresets = document.getElementById('drawerColorPresets');
    const drawerPicker  = document.getElementById('drawerColorPicker');
    const drawerSizeSlider = document.getElementById('drawerSizeSlider');
    const drawerSizeVal    = document.getElementById('drawerSizeVal');
    const drawerEraserBtn  = document.getElementById('drawerEraserBtn');
    const drawerClearBtn   = document.getElementById('drawerClearBtn');
    const drawerSaveBtn    = document.getElementById('drawerSaveBtn');
    const drawerSaveFormat = document.getElementById('drawerSaveFormat');

    const peoplePanel   = document.getElementById('mobilePeoplePanel');
    const peopleBackdrop= document.getElementById('peoplePanelBackdrop');
    const peopleCloseBtn= document.getElementById('peoplePanelCloseBtn');

    // ── Helpers ──────────────────────────────────────────────────────────────

    function syncSwatchColor(hex) {
        if (mobColorSwatch) mobColorSwatch.style.background = hex;
    }

    function updateSizeUI(val) {
        const pct = ((val - 1) / (60 - 1) * 100).toFixed(1);
        if (mobSizeSlider)  { mobSizeSlider.value = val; mobSizeSlider.style.setProperty('--val', pct + '%'); }
        if (mobSizeLabel)   mobSizeLabel.textContent = val + 'px';
        if (drawerSizeSlider) { drawerSizeSlider.value = val; drawerSizeSlider.style.setProperty('--val', pct + '%'); }
        if (drawerSizeVal)  drawerSizeVal.textContent = val + 'px';
        // Sync main desktop slider too
        thicknessSlider.value = val;
        thicknessValue.textContent = val + 'px';
    }

    function updateEraserUI(erasing) {
        if (mobEraserBtn)   mobEraserBtn.classList.toggle('active', erasing);
        if (drawerEraserBtn) {
            drawerEraserBtn.textContent = erasing ? '✏ Pen' : '⬜ Eraser';
            drawerEraserBtn.style.background = erasing
                ? 'linear-gradient(135deg, #a87b28, #DFA83E)'
                : '';
            drawerEraserBtn.style.color = erasing ? '#10101A' : '';
        }
        // Also sync desktop eraser button
        if (erasing) {
            eraserBtn.classList.add('btn-eraser-active');
            eraserBtn.textContent = '✏ Pen';
        } else {
            eraserBtn.classList.remove('btn-eraser-active');
            eraserBtn.textContent = '⬜ Eraser';
        }
    }

    function openDrawer() {
        if (drawer) drawer.classList.add('open');
        if (mobExpandIcon) mobExpandIcon.textContent = '⌄';
        if (mobExpandBtn)  mobExpandBtn.classList.add('active');
    }

    function closeDrawer() {
        if (drawer) drawer.classList.remove('open');
        if (mobExpandIcon) mobExpandIcon.textContent = '⌃';
        if (mobExpandBtn)  mobExpandBtn.classList.remove('active');
    }

    function openPeople() {
        if (peoplePanel)   peoplePanel.classList.add('open');
        if (peopleBackdrop) peopleBackdrop.classList.add('show');
        if (mobPeopleBtn)  mobPeopleBtn.classList.add('active');
        closeDrawer();
    }

    function closePeople() {
        if (peoplePanel)   peoplePanel.classList.remove('open');
        if (peopleBackdrop) peopleBackdrop.classList.remove('show');
        if (mobPeopleBtn)  mobPeopleBtn.classList.remove('active');
    }

    // ── Initialise swatch with current color ──────────────────────────────────
    syncSwatchColor(currentColor);
    updateSizeUI(currentThick);

    // ── Drawer color presets ───────────────────────────────────────────
    if (drawerPresets) {
        PRESETS.forEach(hex => {
            const swatch = document.createElement('div');
            swatch.className = 'drawer-preset';
            swatch.style.background = hex;
            if (hex === currentColor) swatch.classList.add('active');
            swatch.addEventListener('click', () => {
                setColor(hex);
                colorPicker.value = hex;
                drawerPicker.value = hex;
                syncSwatchColor(hex);
                // Update active state
                drawerPresets.querySelectorAll('.drawer-preset').forEach(s => {
                    const rgb = `rgb(${parseInt(hex.slice(1,3),16)}, ${parseInt(hex.slice(3,5),16)}, ${parseInt(hex.slice(5,7),16)})`;
                    s.classList.toggle('active', s.style.background === hex || s.style.background === rgb);
                });
                closeDrawer();
            });
            drawerPresets.appendChild(swatch);
        });
    }

    // ── Drawer custom color picker ─────────────────────────────────────
    if (drawerPicker) {
        drawerPicker.addEventListener('input', e => {
            const hex = e.target.value;
            setColor(hex);
            colorPicker.value = hex;
            syncSwatchColor(hex);
        });
    }

    // ── Color swatch tap → open drawer ──────────────────────────────────
    if (mobColorSwatch) {
        mobColorSwatch.addEventListener('click', () => {
            if (drawer && drawer.classList.contains('open')) {
                closeDrawer();
            } else {
                openDrawer();
                closePeople();
            }
        });
    }

    // ── Expand button ─────────────────────────────────────────────────
    if (mobExpandBtn) {
        mobExpandBtn.addEventListener('click', () => {
            if (drawer && drawer.classList.contains('open')) {
                closeDrawer();
            } else {
                openDrawer();
                closePeople();
            }
        });
    }

    // ── Mini size slider ────────────────────────────────────────────────
    if (mobSizeSlider) {
        mobSizeSlider.addEventListener('input', e => {
            const val = parseInt(e.target.value, 10);
            currentThick = val;
            ctx.lineWidth = val;
            updateSizeUI(val);
        });
    }

    // ── Drawer size slider ──────────────────────────────────────────────
    if (drawerSizeSlider) {
        drawerSizeSlider.addEventListener('input', e => {
            const val = parseInt(e.target.value, 10);
            currentThick = val;
            ctx.lineWidth = val;
            updateSizeUI(val);
        });
    }

    // ── Eraser ───────────────────────────────────────────────────────────────
    if (mobEraserBtn) {
        mobEraserBtn.addEventListener('click', () => {
            isErasing = !isErasing;
            ctx.strokeStyle = isErasing ? '#10101A' : currentColor;
            updateEraserUI(isErasing);
        });
    }

    if (drawerEraserBtn) {
        drawerEraserBtn.addEventListener('click', () => {
            isErasing = !isErasing;
            ctx.strokeStyle = isErasing ? '#10101A' : currentColor;
            updateEraserUI(isErasing);
        });
    }

    // ── Clear (drawer) ────────────────────────────────────────────────────
    if (drawerClearBtn) {
        drawerClearBtn.addEventListener('click', () => {
            if (socket?.connected) socket.emit('clearCanvas', { roomId, username });
            closeDrawer();
        });
    }

    // ── Save (drawer) ────────────────────────────────────────────────────
    if (drawerSaveBtn) {
        drawerSaveBtn.addEventListener('click', () => {
            // Temporarily override format if user changed drawer select
            if (drawerSaveFormat) saveFormatSel.value = drawerSaveFormat.value;
            saveCanvas();
            closeDrawer();
        });
    }

    // ── Undo / Redo from mini bar ───────────────────────────────────────
    if (mobUndoBtn) mobUndoBtn.addEventListener('click', () => undoBtn.click());
    if (mobRedoBtn) mobRedoBtn.addEventListener('click', () => redoBtn.click());

    // ── People panel ───────────────────────────────────────────────────
    if (mobPeopleBtn) {
        mobPeopleBtn.addEventListener('click', () => {
            if (peoplePanel && peoplePanel.classList.contains('open')) {
                closePeople();
            } else {
                openPeople();
            }
        });
    }

    if (peopleCloseBtn) peopleCloseBtn.addEventListener('click', closePeople);
    if (peopleBackdrop) peopleBackdrop.addEventListener('click', closePeople);

    // ── Tap canvas to close overlays ───────────────────────────────────
    canvas.addEventListener('pointerdown', () => {
        closeDrawer();
        // Don't close people panel on canvas tap (it has backdrop)
    }, { passive: true });
}

// ── Init ──────────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
    buildPresets();
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => {
        setTimeout(resizeCanvas, 300);
    });

    // ── Mobile UI ──────────────────────────────────────────────────────────
    initMobileUI();

    const authToken = localStorage.getItem('authToken');
    const params    = new URLSearchParams(window.location.search);
    const paramRoom = params.get('roomId');
    const paramUser = params.get('username');

    if (paramRoom && paramUser && authToken) {
        username = paramUser;
        roomId   = paramRoom;
        createSocket(authToken);
    } else {
        roomModal.classList.remove('hidden');
        appContainer.style.display = 'none';
        updateHistoryButtons();
    }
});

// ── Manual Join ───────────────────────────────────────────────────────────
joinRoomBtn.addEventListener('click', () => {
    username = usernameInput.value.trim();
    roomId   = roomInput.value.trim();

    if (!username || !roomId) {
        showToast('Please enter both your name and a room ID.', 'error');
        return;
    }

    const token = localStorage.getItem('authToken');
    if (!token) {
        showToast('No auth token found. Please log in first.', 'error');
        return;
    }

    createSocket(token);
});

// Enter key in modal
[usernameInput, roomInput].forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') joinRoomBtn.click(); });
});

// ── Canvas Event Listeners ────────────────────────────────────────────────
canvas.addEventListener('contextmenu', e => e.preventDefault()); // Prevent right-click menu
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup',   stopDrawing);
canvas.addEventListener('mouseout',  stopDrawing);

canvas.addEventListener('wheel', e => {
    if (!socket?.connected) return;
    e.preventDefault();
    
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const focusX = (e.clientX - rect.left) * dpr;
    const focusY = (e.clientY - rect.top) * dpr;
    
    const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
    zoomCamera(factor, focusX, focusY);
    redrawCanvas();
}, { passive: false });

function getDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function getMidpoint(t1, t2) {
    return {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2
    };
}

canvas.addEventListener('touchstart', e => { 
    e.preventDefault(); 
    if (e.touches.length === 2) {
        clearTimeout(touchTimer);
        isPanning = true;
        isDrawing = false;
        currentStroke = null;
        redrawCanvas();
        
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        initialPinchDistance = getDistance(t1, t2);
        
        const mid = getMidpoint(t1, t2);
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        lastTouchPanX = (mid.x - rect.left) * dpr;
        lastTouchPanY = (mid.y - rect.top) * dpr;
        return;
    }
    
    if (e.touches.length === 1) {
        startDrawing(e);
        const raw = getRawPos(e);
        touchStartX = raw.x;
        touchStartY = raw.y;
        isTouchHeld = false;
        
        touchTimer = setTimeout(() => {
            isTouchHeld = true;
            isPanning = true;
            isDrawing = false;
            currentStroke = null; // discard the dot
            redrawCanvas();
            panStartX = raw.x;
            panStartY = raw.y;
            canvas.style.cursor = 'grabbing';
            showToast("Pan Mode Active 👆", 'success');
        }, 400); // 400ms hold
    }
}, { passive: false });

canvas.addEventListener('touchmove', e => { 
    e.preventDefault(); 
    if (e.touches.length === 2 && isPanning) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        
        const currentDist = getDistance(t1, t2);
        const incrFactor = currentDist / initialPinchDistance;
        initialPinchDistance = currentDist;
        
        const mid = getMidpoint(t1, t2);
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        const midX = (mid.x - rect.left) * dpr;
        const midY = (mid.y - rect.top) * dpr;
        
        cameraX += (midX - lastTouchPanX);
        cameraY += (midY - lastTouchPanY);
        
        lastTouchPanX = midX;
        lastTouchPanY = midY;
        
        zoomCamera(incrFactor, midX, midY);
        redrawCanvas();
        return;
    }
    
    if (e.touches.length === 1) {
        const raw = getRawPos(e);
        if (isTouchHeld) {
            const dpr = window.devicePixelRatio || 1;
            cameraX += (raw.x - panStartX) * dpr;
            cameraY += (raw.y - panStartY) * dpr;
            panStartX = raw.x;
            panStartY = raw.y;
            redrawCanvas();
        } else {
            const dx = raw.x - touchStartX;
            const dy = raw.y - touchStartY;
            if (Math.sqrt(dx*dx + dy*dy) > 5) {
                clearTimeout(touchTimer); // Cancel hold-to-pan if moving
            }
            if (isDrawing) draw(e);
        }
    }
}, { passive: false });

canvas.addEventListener('touchend', e => { 
    e.preventDefault();
    clearTimeout(touchTimer);
    
    if (isTouchHeld || isPanning) {
        if (e.touches.length < 2) {
            isTouchHeld = false;
            isPanning = false;
            canvas.style.cursor = 'crosshair';
        }
    }
    
    if (e.touches.length === 0) {
        if (isDrawing) stopDrawing(e);
    }
});

canvas.addEventListener('touchcancel', e => {
    clearTimeout(touchTimer);
    isTouchHeld = false;
    isPanning = false;
    stopDrawing(e);
});

// ── Control Listeners ─────────────────────────────────────────────────────
colorPicker.addEventListener('input', e => {
    setColor(e.target.value);
});

thicknessSlider.addEventListener('input', e => {
    currentThick = parseInt(e.target.value, 10);
    thicknessValue.textContent = `${currentThick}px`;
    ctx.lineWidth = currentThick;
    // Drive CSS gradient fill on the range track
    const pct = ((currentThick - 1) / (60 - 1) * 100).toFixed(1);
    thicknessSlider.style.setProperty('--val', `${pct}%`);
});

eraserBtn.addEventListener('click', () => {
    isErasing = !isErasing;
    if (isErasing) {
        ctx.strokeStyle = '#10101A';
        eraserBtn.classList.add('btn-eraser-active');
        eraserBtn.textContent = '✏ Pen';
    } else {
        ctx.strokeStyle = currentColor;
        eraserBtn.classList.remove('btn-eraser-active');
        eraserBtn.textContent = '⬜ Eraser';
    }
});

clearBtn.addEventListener('click', () => {
    if (!socket?.connected) return;
    socket.emit('clearCanvas', { roomId, username });
});

undoBtn.addEventListener('click', () => {
    if (!socket?.connected || drawingHistory.length === 0) return;
    socket.emit('undo', { roomId, username });
});

redoBtn.addEventListener('click', () => {
    if (!socket?.connected || undoneHistory.length === 0) return;
    socket.emit('redo', { roomId, username });
});

copyRoomIdBtn.addEventListener('click', async () => {
    if (!roomId) return;
    try {
        await navigator.clipboard.writeText(roomId);
        showToast('Room ID copied to clipboard!');
    } catch {
        showToast('Could not copy Room ID.', 'error');
    }
});

saveBtn.addEventListener('click', saveCanvas);

closeCanvasBtn.addEventListener('click', () => {
    if (socket?.connected) socket.disconnect();
    window.location.href = 'home.html';
});

// Keyboard shortcuts and camera controls
document.addEventListener('keydown', e => {
    // Ignore if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = true;
    
    if (!socket?.connected) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && key === 'z') { e.preventDefault(); undoBtn.click(); }
    if (ctrl && key === 'y') { e.preventDefault(); redoBtn.click(); }
    if (ctrl && key === 's') { e.preventDefault(); saveCanvas(); }
});

document.addEventListener('keyup', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;
});
