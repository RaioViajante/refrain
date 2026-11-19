// Serves a photograph: to anyone only when it is public, to the signed-in
// owner always, 404 otherwise. The single way photo bytes leave the database.
// No shared cache stores a response (src/server/media/photos.ts).
import { getDatabase } from "@/db/client";
import { getStudioSession } from "@/server/auth/studio";
import { CDN_NO_STORE, resolvePhoto } from "@/server/media/photos";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const signedIn = (await getStudioSession()) !== null;
  const photo = await resolvePhoto(
    getDatabase(),
    id,
    signedIn,
    request.headers.get("if-none-match"),
  );
  if (photo.status === 404) {
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "private, no-store", ...CDN_NO_STORE },
    });
  }
  const common = {
    "Cache-Control": photo.cacheControl,
    ETag: photo.etag,
    // A shared cache must not answer one viewer with another's response.
    Vary: "Cookie",
    ...CDN_NO_STORE,
  };
  if (photo.status === 304) {
    return new Response(null, { status: 304, headers: common });
  }
  return new Response(new Uint8Array(photo.bytes), {
    headers: {
      ...common,
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.bytes.length),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
