import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "@/app/App";
import { AppErrorBoundary } from "@/app/AppErrorBoundary";
import "./styles.css";

type RootGlobal = typeof globalThis & {
  __reviewLabRoot?: ReturnType<typeof ReactDOM.createRoot>;
};

const rootGlobal = globalThis as RootGlobal;
rootGlobal.__reviewLabRoot ??= ReactDOM.createRoot(document.getElementById("root")!);
rootGlobal.__reviewLabRoot.render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
