let isSignupMode = false;

const nameInput = document.getElementById('nameInput');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const submitBtn = document.getElementById('submitBtn');
const formTitle = document.getElementById('formTitle');
const toggleText = document.getElementById('toggleText');
const errorMsg = document.getElementById('errorMsg');
const successMsg = document.getElementById('successMsg');
const authForm = document.getElementById('authForm');

// Check if user is already logged in on page load
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('authToken');
  if (token && window.location.pathname.includes('login.html')) {
    window.location.href = '/index.html';
  }
});

// Toggle between Login and Signup
function toggleMode() {
  isSignupMode = !isSignupMode;
  
  if (isSignupMode) {
    if (formTitle) formTitle.textContent = 'Sign Up';
    if (submitBtn) submitBtn.textContent = 'Sign Up';
    if (nameInput) nameInput.style.display = 'block';
    if (toggleText) toggleText.innerHTML = 'Already have an account? [Log in](#)';
  } else {
    if (formTitle) formTitle.textContent = 'Log In';
    if (submitBtn) submitBtn.textContent = 'Log In';
    if (nameInput) nameInput.style.display = 'none';
    if (toggleText) toggleText.innerHTML = 'Don\'t have an account? [Sign up](#)';
  }
  
  clearMessages();
  if (authForm) authForm.reset();
}

// Validate inputs
function validateInputs() {
  if (!emailInput?.value || !passwordInput?.value) {
    showError('Please fill in all fields');
    return false;
  }
  
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value)) {
    showError('Invalid email format');
    return false;
  }
  
  if (passwordInput.value.length < 6) {
    showError('Password must be at least 6 characters');
    return false;
  }
  
  if (isSignupMode && (!nameInput?.value || !nameInput.value.trim())) {
    showError('Please enter your name');
    return false;
  }
  
  return true;
}

// Show error message
function showError(message) {
  if (errorMsg) errorMsg.textContent = message;
  if (successMsg) successMsg.textContent = '';
}

// Show success message
function showSuccess(message) {
  if (successMsg) successMsg.textContent = message;
  if (errorMsg) errorMsg.textContent = '';
}

// Clear messages
function clearMessages() {
  if (errorMsg) errorMsg.textContent = '';
  if (successMsg) successMsg.textContent = '';
}

// Submit form
async function submitForm(e) {
  e.preventDefault();
  clearMessages();
  
  if (!validateInputs()) return;
  
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = isSignupMode ? 'Signing up...' : 'Logging in...';
  }
  
  try {
    const url = isSignupMode ? '/api/auth/signup' : '/api/auth/login';
    
    const payload = {
      email: emailInput.value.trim(),
      password: passwordInput.value,
      ...(isSignupMode && { name: nameInput.value.trim() })
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      showError(data.error || 'Something went wrong');
      return;
    }
    
    // Store token in localStorage
    if (data.token) {
      localStorage.setItem('authToken', data.token);
    }
    
    showSuccess(isSignupMode ? '✓ Account created! Redirecting...' : '✓ Logged in! Redirecting...');
    
    // Redirect to main page after delay
    setTimeout(() => {
      window.location.href = '/index.html';
    }, 1200);
    
  } catch (error) {
    showError('Network error: ' + error.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = isSignupMode ? 'Sign Up' : 'Log In';
    }
  }
}

// Global logout helper function
function logoutUser() {
  localStorage.removeItem('authToken');
  window.location.href = '/login.html';
}

// Attach form submission event listener
if (authForm) {
  authForm.addEventListener('submit', submitForm);
}