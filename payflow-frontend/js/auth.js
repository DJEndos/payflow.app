// Shared auth helpers used across every page. Since the frontend and backend
// are on different domains now (Vercel + Render), we can't rely on cookies
// the way a same-origin app would — the JWT is stored in localStorage and
// sent manually as an Authorization header on every API call.

function getToken() {
  return localStorage.getItem("payflow_token");
}

function setToken(token) {
  localStorage.setItem("payflow_token", token);
}

function clearToken() {
  localStorage.removeItem("payflow_token");
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Call at the top of any page that requires login. Redirects to /login.html
// if there's no token, so a logged-out visitor never sees protected content.
function requireAuth() {
  if (!getToken()) {
    window.location.href = "/login.html";
  }
}

function logout() {
  clearToken();
  window.location.href = "/login.html";
}
