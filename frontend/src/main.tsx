import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/index.css";
import App from "./App";
import { I18nProvider } from "./i18n/I18nContext";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ChatProvider } from "./chat/ChatContext";
import { QueueProvider } from "./queue/QueueContext";
import { EnvironmentProvider } from "./environment/EnvironmentContext";
import { CampaignQueueProvider } from "./campaigns/CampaignQueueContext";
import { AiQueueProvider } from "./ai/AiQueueContext";

// Every provider below loads its data once on mount — mounted before login,
// those requests 401 and the providers would keep serving empty data after
// authentication (e.g. "create an environment" with one already existing).
// Keying the subtree on the auth state remounts them all on login/logout, so
// each initial load re-runs with the fresh token.
function DataProviders({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  return (
    <EnvironmentProvider key={`auth-${isAuthenticated}`}>
      <AiQueueProvider>
        <ChatProvider>
          <QueueProvider>
            <CampaignQueueProvider>{children}</CampaignQueueProvider>
          </QueueProvider>
        </ChatProvider>
      </AiQueueProvider>
    </EnvironmentProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <AuthProvider>
          <DataProviders>
            <App />
          </DataProviders>
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
