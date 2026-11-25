export interface GalleryMessage {
  messageId: string;
  conversationId: string;
  text?: string;
  attachments?: { file_id: string; filename: string; content: string }[];
  content?: { type?: string; text?: string }[];
}
export interface GalleryPage {
  messages: GalleryMessage[];
  nextCursor?: string;
}
export interface GalleryArtifact {
  id: string;
  title: string;
  type: string;
  content: string;
  messageId: string;
  conversationId: string;
}
export interface ArtifactGalleryPage {
  artifacts: GalleryArtifact[];
  nextCursor?: string;
}
export const artifactGalleryPath = '/api/artifact-gallery';
