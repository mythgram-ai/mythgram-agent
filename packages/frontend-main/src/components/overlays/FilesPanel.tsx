import { Download, Eye, File as FileIcon, FileText, Paperclip } from "lucide-react";
import { useStore } from "@/store/useStore";
import type { AttachedFile } from "@/types";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/primitives";
import { formatBytes } from "@/utils/format";
import { API_ROUTES, routeUrl } from "@/app/api/routes";

export function FilesPanel() {
  const open = useStore((s) => s.filesOpen);
  const setFilesOpen = useStore((s) => s.setFilesOpen);
  const attachedFiles = useStore((s) => s.attachedFiles);
  const setPreview = useStore((s) => s.setPreview);
  const setPreviewOpen = useStore((s) => s.setPreviewOpen);

  const preview = (f: AttachedFile) => {
    setPreview(routeUrl(API_ROUTES.filesPreview, { query: { path: f.path } }));
    setPreviewOpen(true);
  };

  return (
    <Modal
      open={open}
      onClose={() => setFilesOpen(false)}
      align="top"
      size="md"
      icon={<Paperclip className="h-4 w-4" />}
      title={
        <span className="flex items-center gap-2">
          Attached files
          <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--muted)]">
            {attachedFiles.length} file{attachedFiles.length === 1 ? "" : "s"}
          </span>
        </span>
      }
    >
      <div className="p-5">
        {attachedFiles.length === 0 ? (
          <EmptyState icon={<FileIcon className="h-8 w-8" />}>
            No attached files yet. Ask the agent to attach a file and it will show up here.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {attachedFiles.map((file) => (
              <li key={file.id} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] p-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)]">
                    <FileText className="h-4 w-4 text-[var(--secondary)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate break-all font-mono text-[13px] font-medium text-[var(--fg)]">{file.name}</p>
                    <p className="mt-0.5 truncate text-[10px] text-[var(--subtle)]">{file.path}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">{file.size_label ?? formatBytes(file.size)}</span>
                      <span className="max-w-[180px] truncate rounded-full border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted)]">{file.content_type}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button onClick={() => preview(file)} className="flex h-8 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border)] px-2 text-[11px] text-[var(--muted)] transition hover:border-[var(--secondary)] hover:text-[var(--fg)]">
                      <Eye className="h-3.5 w-3.5" /> Preview
                    </button>
                    <a href={routeUrl(API_ROUTES.filesDownload, { query: { path: file.path } })} download={file.name} className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--muted)] transition hover:border-[var(--secondary)] hover:text-[var(--fg)]">
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
