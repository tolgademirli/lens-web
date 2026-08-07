import posthog from "posthog-js";
import type { WorkSource, WorkType } from "./types";

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
if (key) {
  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST as string,
    autocapture: false,
    capture_pageview: true,
  });
}

export { posthog };

/**
 * Edinim yolu event'i. `source` property'si user_works.source ile AYNI sözlükten
 * gelir: 'screenshot' | 'paste' | 'manual' | 'form'. Şemsiye bir 'import' değeri
 * yoktur — hangi yoldan girildiği tek tek bilinir.
 *
 * Değer burada hesaplanmaz: çağıran, eserlerle birlikte kütüphaneye yazılan
 * source dizisini olduğu gibi geçer. Böylece event ile user_works tek kaynaktan
 * türer ve ayrışamaz. Aynı yol birden çok eserde tekrarlanırsa tek event düşer.
 */
export function captureSourcePath(type: WorkType, sources: WorkSource[]) {
  for (const source of Array.from(new Set(sources))) {
    posthog.capture("source_path_selected", { type, source });
  }
}
