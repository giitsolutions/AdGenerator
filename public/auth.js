let isSignup = false;

function toggleMode() {
  isSignup = !isSignup;
  document.getElementById('formTitle').textContent = isSignup ? 'Sign Up' : 'Log In';
  document.getElementById('submitBtn').textContent = isSignup ? 'Sign Up' : 'Log In';
  document.getElementById('toggleText').innerHTML = isSignup
    ? 'Already have an account? <a onclick="toggleMode()">Log in</a>'
    : "Don't have an account? <a onclick=\"toggleMode()\">Sign up</a>";
  document.getElementById('errorMsg').textContent = '';
}

async function submitForm() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('errorMsg');
  errorEl.textContent = '';

  if (!email || !password) {
    errorEl.textContent = 'Please fill in both fields.';
    return;
  }

  const endpoint = isSignup ? '/api/auth/signup' : '/api/auth/login';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'Something went wrong.';
      return;
    }

    localStorage.setItem('authToken', data.token);
    localStorage.setItem('userEmail', data.user.email);
    window.location.href = '/index.html';
  } catch (err) {
    errorEl.textContent = 'Could not reach the server. Is it running?';
  }
}

// If already logged in, skip straight to the dashboard
if (localStorage.getItem('authToken')) {
  window.location.href = '/index.html';
}
