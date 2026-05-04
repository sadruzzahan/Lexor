import { useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

export interface UploadedFile {
  id: string;
  caseId: string;
  filename: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  sourceType: string | null;
  storageUrl: string;
  caption: string | null;
  transcript: string | null;
  sha256: string | null;
  createdAt: string;
}

interface UseFileUploadOptions {
  caseId: string;
  sourceType: "photo" | "audio" | "note" | "upload";
  onSuccess?: (file: UploadedFile) => void;
}

class ClientError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function uploadWithRetry(
  url: string,
  formData: FormData,
  maxRetries = 3,
  onRetry?: (attempt: number) => void,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", body: formData });
      if (res.ok || res.status === 200 || res.status === 201) return res;
      // 4xx = client error — deterministic, do not retry
      if (res.status >= 400 && res.status < 500) throw new ClientError(res.status);
      // 5xx / unexpected = transient, eligible for retry
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      // Never retry client errors (4xx)
      if (err instanceof ClientError) throw err;
      lastErr = err;
      if (attempt < maxRetries) {
        onRetry?.(attempt);
        await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastErr;
}

export function useFileUpload({ caseId, sourceType, onSuccess }: UseFileUploadOptions) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const { toast } = useToast();
  const apiBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

  const uploadFile = useCallback(
    async (file: File, caption?: string): Promise<UploadedFile | null> => {
      setIsUploading(true);
      setProgress(0);
      const formData = new FormData();
      formData.append("file", file, file.name);
      formData.append("sourceType", sourceType);
      if (caption) formData.append("caption", caption);

      try {
        const res = await uploadWithRetry(
          `${apiBase}/api/v1/cases/${caseId}/files`,
          formData,
          3,
          (attempt) => {
            toast({
              title: "Upload retry",
              description: `Network error — retrying (attempt ${attempt}/3)…`,
              variant: "default",
            });
          },
        );
        const data = (await res.json()) as UploadedFile;
        setProgress(100);
        onSuccess?.(data);
        return data;
      } catch (err) {
        toast({
          title: "Upload failed",
          description: `Could not upload ${file.name} after 3 attempts. Check your connection.`,
          variant: "destructive",
        });
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [caseId, sourceType, apiBase, onSuccess, toast],
  );

  return { uploadFile, isUploading, progress };
}
