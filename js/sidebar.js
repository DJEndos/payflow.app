const PAYFLOW_LOGO_SVG = `
  <a class="navbar-brand d-flex align-items-center gap-2" href="/index.html">
       <img src="/logo.png"  width="100">
      </a>`;

const SIDEBAR_LINKS = [
  { href: "/dashboard.html", icon: "⌂", label: "Dashboard" },
  { href: "/wallet.html", icon: "⇄", label: "Wallet" },
  { href: "/bills.html", icon: "⚡", label: "Pay Bills" },
  { href: "/settings.html", icon: "⚙", label: "Settings" },
];

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
    <aside class="sidebar">
      <div class="sidebar-logo">${PAYFLOW_LOGO_SVG} PayFlow</div>
      <nav class="sidebar-nav">${linksHtml}</nav>
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
