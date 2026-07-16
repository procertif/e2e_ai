import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/index.css";
import App from "./App";
import { I18nProvider } from "./i18n/I18nContext";
import { AuthProvider } from "./auth/AuthContext";
import { ChatProvider } from "./chat/ChatContext";
import { QueueProvider } from "./queue/QueueContext";
import { EnvironmentProvider } from "./environment/EnvironmentContext";
import { CampaignQueueProvider } from "./campaigns/CampaignQueueContext";
import { AiQueueProvider } from "./ai/AiQueueContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <AuthProvider>
          <EnvironmentProvider>
            <AiQueueProvider>
              <ChatProvider>
                <QueueProvider>
                  <CampaignQueueProvider>
                    <App />
                  </CampaignQueueProvider>
                </QueueProvider>
              </ChatProvider>
            </AiQueueProvider>
          </EnvironmentProvider>
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
