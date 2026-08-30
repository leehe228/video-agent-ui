const STREAM_BASE_URL = process.env.REALSENSE_STREAM_BASE_URL ?? 'http://127.0.0.1:8765';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ slot: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { slot } = await context.params;
  if (!/^[0-2]$/.test(slot)) return new Response('Camera slot not found', { status: 404 });

  try {
    const upstream = await fetch(`${STREAM_BASE_URL}/stream/${slot}.mjpg`, {
      cache: 'no-store',
      headers: { Accept: 'multipart/x-mixed-replace' },
      signal: request.signal,
    });
    if (!upstream.ok || !upstream.body) return new Response('Camera stream unavailable', { status: 502 });
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch {
    return new Response('Camera stream unavailable', { status: 503 });
  }
}
