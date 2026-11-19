// Serves a photograph: to anyone only when it is public, to the signed-in
// owner always, 404 otherwise. The single way photo bytes leave the database.
import { getDatabase } from "@/db/client";
import { getStudioSession } from "@/server/auth/studio";
import { resolvePhoto } from "@/server/media/photos";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const signedIn = (await getStudioSession()) !== null;
  const photo = await resolvePhoto(getDatabase(), id, signedIn);
  if (photo.status === 404) {
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  return new Response(new Uint8Array(photo.bytes), {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.bytes.length),
      "Cache-Control": photo.cacheControl,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
