import type { MetadataRoute } from "next";
import { appManifest } from "@/lib/pwa";

/** /manifest.webmanifest — what makes MONZA AI installable as an app. The content and its rules: lib/pwa.ts. */
export default function manifest(): MetadataRoute.Manifest {
  return appManifest() as MetadataRoute.Manifest;
}
