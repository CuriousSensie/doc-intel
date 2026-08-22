export type FileCategory = "avatar" | "document";

export type FileCategoryConfig = {
  bucket: string;
  maxSizeBytes: number;
  allowedMimeTypes: string[];
};

export const filesConfig: {
  categories: Record<FileCategory, FileCategoryConfig>;
  signedUrlExpirySeconds: number;
} = {
  categories: {
    avatar: {
      bucket: "avatars",
      maxSizeBytes: 5 * 1024 * 1024,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"]
    },
    document: {
      bucket: "files",
      maxSizeBytes: 20 * 1024 * 1024,
      allowedMimeTypes: [
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "application/pdf",
        "text/plain",
        "text/csv"
      ]
    }
  },
  signedUrlExpirySeconds: 300
};
