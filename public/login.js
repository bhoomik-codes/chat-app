/**
 * login.js — Client-side authentication handler.
 * Now uses /api/auth/login and /api/auth/register endpoints separately.
 */

document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('submitLogin');
    const registerBtn = document.getElementById('submitRegister');
    const toggleLink = document.getElementById('toggleMode');
    const formTitle = document.getElementById('formTitle');
    const passwordConfirmGroup = document.getElementById('passwordConfirmGroup');

    let isRegisterMode = false;

    // Toggle between Login and Register modes
    if (toggleLink) {
        toggleLink.addEventListener('click', (e) => {
            e.preventDefault();
            isRegisterMode = !isRegisterMode;
            if (isRegisterMode) {
                formTitle.textContent = 'Create Account';
                loginBtn.style.display = 'none';
                registerBtn.style.display = 'block';
                passwordConfirmGroup.style.display = 'block';
                toggleLink.textContent = 'Already have an account? Sign in';
            } else {
                formTitle.textContent = 'Login to Chat';
                loginBtn.style.display = 'block';
                registerBtn.style.display = 'none';
                passwordConfirmGroup.style.display = 'none';
                toggleLink.textContent = "Don't have an account? Register";
            }
        });
    }

    if (loginBtn) loginBtn.addEventListener('click', () => handleAuth('login'));
    if (registerBtn) registerBtn.addEventListener('click', () => handleAuth('register'));

    // Allow Enter key submission
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAuth(isRegisterMode ? 'register' : 'login');
    });
});

/**
 * Displays a temporary message box with a given message and type.
 * @param {string} message
 * @param {'success'|'error'} type
 */
function showMessage(message, type = 'error') {
    const messageBox = document.getElementById('messageBox');
    if (!messageBox) return;
    messageBox.textContent = message;
    messageBox.className = `message-box ${type}`;
    messageBox.style.display = 'block';
    setTimeout(() => { messageBox.style.display = 'none'; }, 4000);
}

/**
 * Handles both login and registration, calling the appropriate API endpoint.
 * @param {'login'|'register'} mode
 */
async function handleAuth(mode) {
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const passwordConfirmInput = document.getElementById('passwordConfirm');

    const username = usernameInput?.value.trim() ?? '';
    const password = passwordInput?.value.trim() ?? '';

    if (!username || !password) {
        return showMessage('Please enter both username and password.', 'error');
    }

    if (mode === 'register') {
        const passwordConfirm = passwordConfirmInput?.value.trim() ?? '';
        if (password !== passwordConfirm) {
            return showMessage('Passwords do not match.', 'error');
        }
        if (password.length < 8) {
            return showMessage('Password must be at least 8 characters.', 'error');
        }
    }

    const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        const data = await response.json();

        if (data.success) {
            showMessage(data.message, 'success');
            localStorage.setItem('authenticatedUsername', data.username);
            localStorage.setItem('authToken', data.token);
            setTimeout(() => { location.href = '/home.html'; }, 1000);
        } else {
            // Show first validation error if present, otherwise show the message
            const errMsg = data.errors?.[0]?.msg ?? data.message ?? 'An error occurred.';
            showMessage(errMsg, 'error');
        }
    } catch (error) {
        console.error('[Auth] API call failed:', error);
        showMessage('Network error. Please check your connection.', 'error');
    }
}
