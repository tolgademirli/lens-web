import posthog from "posthog-js";

posthog.init(import.meta.env.VITE_POSTHOG_KEY as string, {
  api_host: import.meta.env.VITE_POSTHOG_HOST as string,
  autocapture: false,
  capture_pageview: true,
});

export { posthog };
