import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";
import { posthog } from "./lib/posthog";
import { watchAnalyticsConsent } from "./lib/analyticsConsent";
import { supabase } from "./lib/supabase";

// İlk çizimden ÖNCE: oturumu açık kişinin kararı hesabından okunana kadar analitik
// bandı bekler, yoksa kararı hesabında duran kişi bandı bir an görürdü.
watchAnalyticsConsent();

supabase.auth.onAuthStateChange((event, session) => {
  // INITIAL_SESSION da sayılır: analitik izni girişten SONRA verilirse kimliğin
  // o an bağlanabilmesi için sarmalayıcının oturumdaki kullanıcıyı bilmesi gerek,
  // ve sayfa açık bir oturumla yüklendiğinde SIGNED_IN gelmez.
  if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user) {
    posthog.identify(session.user.id);
  } else if (event === "SIGNED_OUT") {
    posthog.reset();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
