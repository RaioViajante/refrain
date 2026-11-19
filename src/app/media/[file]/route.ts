// Serves photographs stored locally during development. In production the
// storage driver is never "local", so this always answers 404.
import { readLocalImage } from "@/server/media/storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const image = await readLocalImage((await params).file);
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
