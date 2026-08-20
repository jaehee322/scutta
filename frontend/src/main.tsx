import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { PwaProvider } from "./components/PwaManager";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <PwaProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </PwaProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
);
