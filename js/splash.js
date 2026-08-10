
function showSplashLoader() {
  const el = document.createElement("div");
  el.className = "splash-loader";
  el.id = "splashLoader";
  el.innerHTML = `
    <div class="splash-loader-logo">
      <img src="/logo.png" alt="PayFlow"/>
    </div>
  `;
  document.body.insertAdjacentElement("afterbegin", el);
}

function hideSplashLoader() {
  const el = document.getElementById("splashLoader");
  if (!el) return;
  el.classList.add("fade-out");
  setTimeout(() => el.remove(), 400);
}

// Auto-hide after a minimum display time so it doesn't feel like a flash,
// but never blocks the page from becoming usable for long.
showSplashLoader();
window.addEventListener("load", () => {
  setTimeout(hideSplashLoader, 600);
});
