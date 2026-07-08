import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import RequireAuth from "./auth/RequireAuth";
import LoginPage from "./auth/LoginPage";
import TestsPage from "./pages/TestsPage";
import ScreenshotsPage from "./pages/ScreenshotsPage";
import GroupsPage from "./pages/GroupsPage";
import ScenariosPage from "./pages/ScenariosPage";
import ChatPage from "./pages/ChatPage";
import LogsPage from "./pages/LogsPage";
import EnvironmentsPage from "./pages/EnvironmentsPage";

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
        <Route path="/screenshots" element={<ScreenshotsPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/scenarios" element={<ScenariosPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/environments" element={<EnvironmentsPage />} />
      </Route>
    </Routes>
  );
}
