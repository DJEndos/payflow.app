
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
      <div class="sidebar-logo">${PAYFLOW_LOGO_SVG} PayFlow</div>
    </div>

    <div class="sidebar-backdrop" onclick="toggleSidebar(false)"></div>

    <aside class="sidebar">
      <div class="sidebar-logo sidebar-logo-desktop">${PAYFLOW_LOGO_SVG} PayFlow</div>
      <nav class="sidebar-nav" onclick="toggleSidebar(false)">${linksHtml}</nav>
      <div class="sidebar-footer">
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
}
