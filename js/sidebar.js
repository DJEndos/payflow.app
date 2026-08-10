const PAYFLOW_LOGO_SVG = ` <img src="/logo.png" alt="" width="100">`;

const SIDEBAR_LINKS = [
  { href: "/dashboard.html", icon: "⌂", label: "Dashboard" },
  { href: "/wallet.html", icon: "⇄", label: "Wallet" },
  { href: "/bills.html", icon: "⚡", label: "Pay Bills" },
  { href: "/settings.html", icon: "⚙", label: "Settings" },
];

function toggleSidebar(forceState) {
  const shell = document.querySelector(".app-shell");
  if (!shell) return;
  const shouldOpen = forceState !== undefined ? forceState : !shell.classList.contains("sidebar-open");
  shell.classList.toggle("sidebar-open", shouldOpen);
}

function initialsFromName(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function renderSidebar(activePage) {
  const linksHtml = SIDEBAR_LINKS.map(
    (link) => `<a href="${link.href}" class="sidebar-link${link.href.includes(activePage) ? " active" : ""}">
      <span class="nav-icon">${link.icon}</span> ${link.label}
    </a>`
  ).join("");

  const pageContent = document.getElementById("pageContent");
  if (!pageContent) {
    console.error("renderSidebar: no #pageContent element found on this page");
    return;
  }

  const shell = document.createElement("div");
  shell.className = "app-shell";
  shell.innerHTML = `
    <div class="mobile-topbar">
      <button class="hamburger-btn" onclick="toggleSidebar()" aria-label="Open menu">
        <span></span><span></span><span></span>
      </button>
      <div class="sidebar-logo">${PAYFLOW_LOGO_SVG} </div>
    </div>

    <div class="sidebar-backdrop" onclick="toggleSidebar(false)"></div>

    <aside class="sidebar">
      <div class="sidebar-logo sidebar-logo-desktop">${PAYFLOW_LOGO_SVG} PayFlow</div>
      <nav class="sidebar-nav" onclick="toggleSidebar(false)">${linksHtml}</nav>
      <div class="sidebar-footer">
        <a href="/profile.html" class="sidebar-link${activePage === "profile" ? " active" : ""}">
          <span class="avatar-initials avatar-mini" id="sidebarAvatar">..</span>
          <span id="sidebarProfileName">Profile</span>
        </a>
        <a href="#" onclick="logout(); return false;" class="sidebar-link">
          <span class="nav-icon">⏻</span> Log out
        </a>
      </div>
    </aside>
    <main class="main-content"></main>
  `;

  const mainContent = shell.querySelector(".main-content");
  mainContent.appendChild(pageContent); // pageContent keeps its id, just gets relocated

  document.body.insertAdjacentElement("afterbegin", shell);

  // Populate the sidebar avatar/name — self-contained so every page gets it
  // for free just by calling renderSidebar(), no extra wiring needed per page.
  const token = getToken();
  if (token) {
    fetch(`${API_BASE_URL}/api/user/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((result) => {
        if (!result.success) return;
        const name = result.data.businessName || result.data.fullName;
        document.getElementById("sidebarAvatar").textContent = initialsFromName(result.data.fullName);
        document.getElementById("sidebarProfileName").textContent = name;

        // Admin link is hidden from everyone else — not a security boundary
        // itself (the backend's adminOnly middleware is), just keeps it out
        // of sight for regular users.
        if (result.data.isAdmin) {
          const nav = shell.querySelector(".sidebar-nav");
          const isActive = activePage === "admin" ? " active" : "";
          nav.insertAdjacentHTML(
            "beforeend",
            `<a href="/admin.html" class="sidebar-link${isActive}"><span class="nav-icon">🛡</span> Admin</a>`
          );
        }
      })
      .catch(() => {});
  }
}
