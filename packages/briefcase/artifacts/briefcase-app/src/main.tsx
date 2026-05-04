import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  // `reducedMotion="user"` makes framer-motion honor the OS / browser
  // `prefers-reduced-motion` setting — animations collapse to instant
  // transitions when the user has requested less motion.
  <MotionConfig reducedMotion="user">
    <App />
  </MotionConfig>,
);
