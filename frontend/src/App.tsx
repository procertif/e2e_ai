import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import RequireAuth from "./auth/RequireAuth";
import LoginPage from "./auth/LoginPage";
import TestsPage from "./pages/TestsPage";
import CampaignsPage from "./pages/CampaignsPage";
import GroupsPage from "./pages/GroupsPage";
import LogsPage from "./pages/LogsPage";
import EnvironmentsPage from "./pages/EnvironmentsPage";
import VersioningPage from "./pages/VersioningPage";
import ConfigurationPage from "./pages/ConfigurationPage";

// Corrections now live as a sub-tab of the Tests page — keep old
// /corrections links (bookmarks, campaign "corriger" buttons from before)
// working by rewriting them, filename param included.
function CorrectionsRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set("tab", "corrections");
  return <Navigate to={`/?${params.toString()}`} replace />;
}

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
        <Route path="/corrections" element={<CorrectionsRedirect />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/environments" element={<EnvironmentsPage />} />
        <Route path="/versioning" element={<VersioningPage />} />
        <Route path="/configuration" element={<ConfigurationPage />} />
      </Route>
    </Routes>
  );
}
