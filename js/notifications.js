// Renders a notification bell into any element with id="notificationBellSlot".
// Call renderNotificationBell() once the page has requireAuth()'d.
async function renderNotificationBell() {
  const slot = document.getElementById("notificationBellSlot");
  if (!slot) return;

  slot.innerHTML = `
    <div class="notif-bell-wrap">
      <button class="notif-bell-btn" id="notifBellBtn" aria-label="Notifications">
        🔔<span class="notif-badge d-none" id="notifBadge">0</span>
      </button>
      <div class="notif-dropdown d-none" id="notifDropdown">
        <div class="notif-dropdown-header">Notifications</div>
        <div id="notifList" class="notif-list">
          <div class="text-muted small p-3">Loading...</div>
        </div>
      </div>
    </div>
  `;

  const btn = document.getElementById("notifBellBtn");
  const dropdown = document.getElementById("notifDropdown");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("d-none");
  });
  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && e.target !== btn) dropdown.classList.add("d-none");
  });

  await loadNotifications();
}

async function loadNotifications() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/notifications`, { headers: authHeaders() });
    const result = await res.json();
    if (!result.success) return;

    const unreadCount = result.data.filter((n) => !n.read).length;
    const badge = document.getElementById("notifBadge");
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 9 ? "9+" : unreadCount;
      badge.classList.remove("d-none");
    } else {
      badge.classList.add("d-none");
    }

    const list = document.getElementById("notifList");
    if (!result.data.length) {
      list.innerHTML = '<div class="text-muted small p-3">No notifications yet.</div>';
      return;
    }

    list.innerHTML = result.data
      .map(
        (n) => `<div class="notif-item${n.read ? "" : " unread"}" data-id="${n._id}">
          <div class="fw-semibold small">${n.title}</div>
          <div class="text-muted small">${n.message}</div>
          <div class="text-muted" style="font-size:0.72rem;">${new Date(n.createdAt).toLocaleString()}</div>
        </div>`
      )
      .join("");

    list.querySelectorAll(".notif-item.unread").forEach((el) => {
      el.addEventListener("click", async () => {
        const id = el.dataset.id;
        el.classList.remove("unread");
        await fetch(`${API_BASE_URL}/api/notifications/${id}/read`, {
          method: "POST",
          headers: authHeaders(),
        });
        loadNotifications();
      });
    });
  } catch (err) {
    console.error("Could not load notifications:", err);
  }
}
