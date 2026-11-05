import { addRoute, setLoginRoute, startRouter } from "./router.js";
import { renderLogin } from "./pages/login.js";
import { renderDashboard } from "./pages/dashboard.js";
import { renderCases } from "./pages/cases.js";
import { renderCaseDetail, CaseTab } from "./pages/case/shell.js";
import { renderSearch } from "./pages/search.js";
import { renderNotifications } from "./pages/notifications.js";
import { renderAuditLog } from "./pages/auditLog.js";
import { renderProfile } from "./pages/profile.js";

setLoginRoute((content) => renderLogin(content));

addRoute("/dashboard", "Dashboard", (content) => renderDashboard(content));
addRoute("/cases", "Cases", (content, params, query) => renderCases(content, params, query));
addRoute("/search", "Search", (content, params, query) => renderSearch(content, params, query));
addRoute("/notifications", "Notifications", (content) => renderNotifications(content));
addRoute("/audit-log", "System Audit Log", (content, params, query) => renderAuditLog(content, params, query));
addRoute("/profile", "Profile", (content) => renderProfile(content));

addRoute("/cases/:id", "Case", (content, params, _q, setTitle) => renderCaseDetail(content, params.id, "overview", setTitle));
(["overview", "documents", "evidence", "chain-of-custody", "audit-trail", "access-requests"] as CaseTab[]).forEach((tab) => {
  addRoute(`/cases/:id/${tab}`, "Case", (content, params, _q, setTitle) => renderCaseDetail(content, params.id, tab, setTitle));
});

startRouter();
