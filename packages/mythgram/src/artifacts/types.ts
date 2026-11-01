/**
 * Shared artifact-domain types.
 *
 * An artifact is a saved, named file the agent produces and can later list, read,
 * show to the user, edit, pin, duplicate, or delete. Artifact files live as plain
 * files on disk inside the workspace at `.mythgram/artifacts/`, while their
 * metadata (id, title, description, type, ...) lives in a small JSON manifest in
 * the same folder. Media files (image/video/audio) can never be saved as artifacts.
 */

/** The kind of content an artifact holds. Shown as a label on the artifact card. */
export type ArtifactType =
  | "markdown"
  | "code_file"
  | "text"
  | "html"
  | "csv"
  | "json"
  | "docs"
  | "design"
  | "slides";

/** Every valid artifact type, in the order they are advertised to the model. */
export const ARTIFACT_TYPES: readonly ArtifactType[] = [
  "markdown",
  "code_file",
  "text",
  "html",
  "csv",
  "json",
  "docs",
  "design",
  "slides",
];

/** Metadata describing one saved artifact. */
export interface ArtifactMeta {
  /** Stable unique id (16-character alphanumeric); also the file-name stem. */
  id: string;
  /** Human-readable title shown on the artifact card. */
  title: string;
  /** Brief description of the artifact and its contents. */
  description: string;
  /** The kind of content the artifact holds (rendered as a card label). */
  type: ArtifactType;
  /** Workspace-relative posix path of the artifact file, e.g. ".mythgram/artifacts/<id>.md". */
  file: string;
  /** Size of the artifact file in bytes. */
  sizeBytes: number;
  /** Whether the artifact is pinned to the top of the artifacts panel. */
  pinned: boolean;
  /** Epoch ms when the artifact was first saved. */
  createdAt: number;
  /** Epoch ms when the artifact's metadata/content was last updated. */
  updatedAt: number;
}

/** Full artifact payload including its raw file content (used by read/show). */
export interface ArtifactWithContent extends ArtifactMeta {
  /** The artifact file's raw content (text). */
  content: string;
}

/** Fields accepted by the save operation (mirrors the save_artifacts tool schema). */
export interface SaveArtifactInput {
  /** Absolute (or workspace-relative) path of the source file to save as an artifact. */
  artifactFilePath: string;
  /** Title of the artifact. */
  title: string;
  /** Brief description of the artifact and its contents. */
  description: string;
  /** Type of the artifact. */
  type: ArtifactType;
}

/** Fields accepted when editing an artifact's metadata (and optionally its content). */
export interface UpdateArtifactInput {
  title?: string;
  description?: string;
  type?: ArtifactType;
  /** When present, replaces the artifact file's content. */
  content?: string;
}
