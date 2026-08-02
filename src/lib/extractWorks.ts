import { supabase } from "./supabase";
import type { ExtractWorksResponse, ExtractedWork, WorkType } from "./types";

export class ExtractError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export interface ExtractImage {
  media_type: string;
  data: string;
}

export interface ExtractInput {
  type: WorkType;
  images?: ExtractImage[];
  text?: string;
}

/**
 * Ekran görüntüsü / metinden eser çıkarır. Havuza YAZMAZ — yazma onaydan sonra.
 * `works` boş dönerse guardrail state'i gösterilir; bu bir hata değil.
 */
export async function extractWorks(input: ExtractInput): Promise<ExtractWorksResponse> {
  const { data, error } = await supabase.functions.invoke("extract-works", {
    body: input,
  });

  if (error) {
    let message = "Bir hata oluştu. Lütfen tekrar deneyin.";
    let status = 500;
    try {
      const res: Response | undefined = (error as any).context;
      if (res) {
        status = res.status;
        const body = await res.json();
        if (body?.error) message = body.error;
      }
    } catch { /* ignore */ }
    throw new ExtractError(message, status);
  }

  return {
    works: (data?.works ?? []) as ExtractedWork[],
    batch_id: (data?.batch_id ?? "") as string,
  };
}

/** Dosyayı API'nin beklediği ham base64'e çevirir (data URI ön eki atılır). */
export function fileToBase64(file: File): Promise<ExtractImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve({
        media_type: file.type,
        data: comma === -1 ? result : result.slice(comma + 1),
      });
    };
    reader.onerror = () => reject(new Error("Dosya okunamadı."));
    reader.readAsDataURL(file);
  });
}

/**
 * Onaylanan satırı adım akışının/analyze'in beklediği string formatına çevirir.
 * Bu format kasıtlı: `analyze` " - " ile bölüp [title, creator] çıkarıyor,
 * ve `pendingReport` string[] tutuyor. Eski akış bozulmasın.
 */
export function workToEntry(work: { creator: string; title: string }): string {
  return work.title.trim() ? `${work.title.trim()} - ${work.creator.trim()}` : work.creator.trim();
}
