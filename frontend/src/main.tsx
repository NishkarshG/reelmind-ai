import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import "./index.css";
import { StoreProvider } from "./lib/store";
import Analytics from "./pages/Analytics";
import Episodes from "./pages/Episodes";
import Evaluation from "./pages/Evaluation";
import Overview from "./pages/Overview";
import Promos from "./pages/Promos";
import Scenes from "./pages/Scenes";
import Settings from "./pages/Settings";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/episodes" element={<Episodes />} />
            <Route path="/promos" element={<Promos />} />
            <Route path="/scenes" element={<Scenes />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/evaluation" element={<Evaluation />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
);
