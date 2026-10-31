import { API_ROUTES, routeUrl } from "@/app/api/routes";

/** One file saved by the backend into `<workspace>/uploads/` (plain files, never SQLite). */
export interface UploadedFile {
  name: string;
  /** Workspace-relative path, e.g. `uploads/photo.png`. */
  path: string;
  absolutePath: string;
  size: number;
  contentType: string;
}

/** Per-file upload limit: 300 MB (mirrors the backend multer limit). */
export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

interface WireUploaded {
  name?: string;
  path?: string;
  absolute_path?: string;
  size?: number;
  content_type?: string;
}

/**
 * Upload prompt attachments of any type (documents, images, ...) to the agent
 * workspace's `uploads/` folder. Streams multipart form data with no client-side
 * timeout — large files take as long as they take. Throws on failure.
 */
export async function uploadFiles(
  files: File[] | FileList,
  signal?: AbortSignal,
): Promise<UploadedFile[]> {
  const list = Array.from(files);
  if (list.length === 0) return [];

  for (const file of list) {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(`"${file.name}" is larger than the 300 MB upload limit.`);
    }
  }

  const form = new FormData();
  for (const file of list) form.append("files", file, file.name);

  const res = await fetch(routeUrl(API_ROUTES.filesUpload), {
    method: "POST",
    body: form,
    cache: "no-store",
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error ?? `Upload failed (${res.status})`,
    );
  }
  const saved = (data as { files?: WireUploaded[] }).files ?? [];
  return saved
    .filter((f) => typeof f?.path === "string" && f.path.length > 0)
    .map((f) => ({
      name: typeof f.name === "string" && f.name ? f.name : "upload",
      path: f.path as string,
      absolutePath: typeof f.absolute_path === "string" ? f.absolute_path : "",
      size: typeof f.size === "number" ? f.size : 0,
      contentType:
        typeof f.content_type === "string" ? f.content_type : "application/octet-stream",
    }));
}

/**
 * Build the attachment notice appended to the user's prompt so the agent looks at
 * the uploaded files first. Lists workspace-relative `uploads/...` paths (plus the
 * absolute path the file tools need) and nudges images toward read_image.
 */
export function buildAttachmentPrompt(files: UploadedFile[]): string {
  if (files.length === 0) return "";
  const refs = files
    .map((f) =>
      f.absolutePath ? `${f.path} (${f.absolutePath})` : f.path,
    )
    .join(", ");
  const hasImage = files.some(
    (f) =>
      f.contentType.startsWith("image/") ||
      /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(f.name),
  );
  return (
    `The user has attached ${files.length} file${files.length === 1 ? "" : "s"} ` +
    `with this prompt — please examine ${files.length === 1 ? "it" : "them"} first: ${refs}. ` +
    `The files are saved under the agent workspace's uploads/ folder (not in the database). ` +
    `Read text and document files with file_read (absolute path) before answering` +
    (hasImage
      ? `, and inspect attached images with read_image (it needs a vision-capable model)`
      : ``) +
    `.`
  );
}
