import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import RequireAuth from "./auth/RequireAuth";
import LoginPage from "./auth/LoginPage";
import TestsPage from "./pages/TestsPage";
import CampaignsPage from "./pages/CampaignsPage";
import CorrectionsPage from "./pages/CorrectionsPage";
import ScreenshotsPage from "./pages/ScreenshotsPage";
import GroupsPage from "./pages/GroupsPage";
import ScenariosPage from "./pages/ScenariosPage";
import ChatPage from "./pages/ChatPage";
import LogsPage from "./pages/LogsPage";
import EnvironmentsPage from "./pages/EnvironmentsPage";
import VersioningPage from "./pages/VersioningPage";
import ConfigurationPage from "./pages/ConfigurationPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<TestsPage />} />
        <Route path="/campaigns" element={<CampaignsPage />} />
        <Route path="/corrections" element={<CorrectionsPage />} />
        <Route path="/screenshots" element={<ScreenshotsPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/scenarios" element={<ScenariosPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/environments" element={<EnvironmentsPage />} />
        <Route path="/versioning" element={<VersioningPage />} />
        <Route path="/configuration" element={<ConfigurationPage />} />
      </Route>
    </Routes>
  );
}
