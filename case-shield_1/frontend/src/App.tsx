import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/layouts/AppLayout";
import { AuthLayout } from "@/layouts/AuthLayout";
import { ProtectedRoute } from "@/routes/ProtectedRoute";

import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { CasesListPage } from "@/pages/CasesListPage";
import { CaseWorkspacePage } from "@/pages/CaseWorkspacePage";
import { DocumentDetailPage } from "@/pages/DocumentDetailPage";
import { EvidenceDetailPage } from "@/pages/EvidenceDetailPage";
import { SearchPage } from "@/pages/SearchPage";
import { NotificationsPage } from "@/pages/NotificationsPage";
import { AuditPage } from "@/pages/AuditPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { SharesPage } from "@/pages/SharesPage";

export function App() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/cases" element={<CasesListPage />} />
        <Route path="/cases/:id" element={<CaseWorkspacePage />} />
        <Route path="/cases/:caseId/evidence/:evidenceId" element={<EvidenceDetailPage />} />
        <Route path="/documents/:id" element={<DocumentDetailPage />} />
        <Route path="/shares" element={<SharesPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
