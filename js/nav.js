function renderNav() {
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<nav class="navbar navbar-expand-lg mb-2">
      <div class="container">
        <a class="navbar-brand" href="/dashboard.html">  <a class="navbar-brand d-flex align-items-center gap-2" href="/index.html">
       <img src="/logo.png" alt="" width="100"> 
      </a></a>
        <div class="ms-auto d-flex gap-2">
          <a href="/dashboard.html" class="btn btn-sm btn-outline-secondary">Dashboard</a>
          <a href="/wallet.html" class="btn btn-sm btn-outline-secondary">Wallet</a>
          <a href="/bills.html" class="btn btn-sm btn-outline-secondary">Bills</a>
          <a href="#" onclick="logout(); return false;" class="btn btn-sm btn-outline-danger">Log out</a>
        </div>
      </div>
    </nav>`
  );
}
