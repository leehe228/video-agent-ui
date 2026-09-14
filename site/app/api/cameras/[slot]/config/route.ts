const STREAM_BASE_URL = process.env.REALSENSE_STREAM_BASE_URL ?? 'http://127.0.0.1:8765';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ slot: string }> };

const ALLOWED_RESOLUTIONS = new Set(['424x240', '640x360', '640x480']);
const ALLOWED_RATES = new Set([5, 10, 15]);

export async function PUT(request: Request, context: RouteContext) {
  const { slot } = await context.params;
  if (!/^[0-2]$/.test(slot)) {
    return Response.json({ ok: false, error: 'Camera slot not found' }, { status: 404 });
  }

  let payload: { width?: unknown; height?: unknown; fps?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const width = Number(payload.width);
  const height = Number(payload.height);
  const fps = Number(payload.fps);
  if (!ALLOWED_RESOLUTIONS.has(`${width}x${height}`) || !ALLOWED_RATES.has(fps)) {
    return Response.json({ ok: false, error: 'Unsupported camera profile' }, { status: 400 });
  }

  try {
    const upstream = await fetch(`${STREAM_BASE_URL}/api/cameras/${slot}/config`, {
      method: 'PUT',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width, height, fps }),
      signal: request.signal,
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch {
    return Response.json({ ok: false, error: 'RealSense capture service unavailable' }, { status: 503 });
  }
}
