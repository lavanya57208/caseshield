import { api } from "../api.js";
import { icon } from "../components/icons.js";
import { escapeHtml, timeAgo } from "../util.js";
import { navigate } from "../router.js";

export async function renderNotifications(content: HTMLElement) {
  const notifs = await api.get<any[]>("/notifications");

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Notifications</h1>
        <div class="sub">${notifs.filter((n) => !n.is_read).length} unread</div>
      </div>
      <button class="btn btn-ghost btn-sm" type="button" data-action="mark-all">Mark all as read</button>
    </div>
    <div class="card">
      ${
        notifs.length
          ? notifs
              .map(
                (n: any) => `
        <div class="notif-item ${n.is_read ? "read" : ""}" data-id="${n.id}" data-link="${n.link || ""}" style="cursor:${n.link ? "pointer" : "default"};">
          <span class="dot"></span>
          <div>
            <div class="msg">${escapeHtml(n.message)}</div>
            <div class="time">${timeAgo(n.created_at)}</div>
          </div>
        </div>`
              )
              .join("")
          : `<div class="empty-state">${icon("bell", 28)}<div class="title">No notifications</div></div>`
      }
    </div>
  `;

  content.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => {
    el.addEventListener("click", async () => {
      const id = el.dataset.id!;
      const link = el.dataset.link;
      try {
        await api.post(`/notifications/${id}/read`);
      } catch {
        /* ignore */
      }
      if (link) navigate(link);
    });
  });

  content.querySelector('[data-action="mark-all"]')!.addEventListener("click", async () => {
    await api.post("/notifications/read-all");
    renderNotifications(content);
  });
}
