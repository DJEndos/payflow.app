const FOOTER_NAV_LINKS = [
  { href: "/dashboard.html", icon: "⌂", label: "Dashboard" },
  { href: "/wallet.html", icon: "⇄", label: "Wallet" },
  { href: "/bills.html", icon: "⚡", label: "Bills" },
  { href: "/profile.html", icon: "👤", label: "Profile" },
];

function renderFooterNav(activePage) {
  const shell = document.querySelector(".app-shell");
  if (!shell) return;
  shell.classList.add("has-footer-nav");

  const linksHtml = FOOTER_NAV_LINKS.map(
    (link) => `<a href="${link.href}" class="footer-nav-link${link.href.includes(activePage) ? " active" : ""}">
      <span class="footer-nav-icon">${link.icon}</span>${link.label}
    </a>`
  ).join("");

  const footer = document.createElement("nav");
  footer.className = "footer-nav";
  footer.innerHTML = linksHtml;
  document.body.appendChild(footer);
}
