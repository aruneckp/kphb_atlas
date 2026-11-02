import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Gate from "./components/Gate.jsx";
import "@fontsource-variable/anek-telugu/standard.css";
import "./styles.css";

createRoot(document.getElementById("root")).render(<Gate><App /></Gate>);
