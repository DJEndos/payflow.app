

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
