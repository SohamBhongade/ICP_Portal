// Server-only Cloudinary configuration + signing helper.
//
// Circular attachments are uploaded DIRECTLY from the browser to Cloudinary
// using a short-lived signature minted here — the file bytes never pass through
// our server (no server-action body-size limits), and the API secret stays on
// the server. The client then persists only the returned URL + metadata via a
// server action.

import "server-only";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };

/** Folder all circular uploads land in (keeps the media library tidy). */
export const CIRCULARS_FOLDER = "icp-portal/circulars";

/** True only when every Cloudinary env var is present. */
export function isCloudinaryConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );
}

/** Sign the params the client will send to Cloudinary's upload endpoint. */
export function signUploadParams(params: Record<string, string | number>): string {
  return cloudinary.utils.api_sign_request(
    params,
    process.env.CLOUDINARY_API_SECRET as string,
  );
}
