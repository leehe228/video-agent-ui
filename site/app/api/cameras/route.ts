const STATUS_URL = process.env.REALSENSE_STATUS_URL ?? 'http://127.0.0.1:8765/api/status';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const upstream = await fetch(STATUS_URL, { cache: 'no-store' });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch {
    return Response.json({ ok: false, cameras: [], error: 'RealSense capture service unavailable' }, { status: 503 });
  }
}
