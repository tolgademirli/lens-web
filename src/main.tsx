import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";
import { posthog } from "./lib/posthog";
import { supabase } from "./lib/supabase";

supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN" && session?.user) {
    posthog.identify(session.user.id);
  } else if (event === "SIGNED_OUT") {
    posthog.reset();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
