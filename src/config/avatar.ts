export const avatarConfig = {
  bucket: "avatars",
  maxSizeBytes: 5 * 1024 * 1024,
  allowedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"]
} as const;
