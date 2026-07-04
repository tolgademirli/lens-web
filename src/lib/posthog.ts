import posthog from "posthog-js";

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
console.log("[PostHog] key present:", !!key, "| host:", import.meta.env.VITE_POSTHOG_HOST);
if (key) {
  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST as string,
    autocapture: false,
    capture_pageview: true,
  });
}

export { posthog };
