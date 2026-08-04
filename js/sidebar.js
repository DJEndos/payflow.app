const PAYFLOW_LOGO_SVG = `
<svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M13 1L24 5.5V12C24 18.5 19.5 23.5 13 25C6.5 23.5 2 18.5 2 12V5.5L13 1Z" fill="#0B6E4F"/>
  <path d="M8 13.5C8 13.5 10.5 9 13 9C16 9 15 13 18 13C20 13 21 10.5 21 10.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

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
