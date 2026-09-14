import {
  DEFAULT_SHARED_SESSION_STATE,
  parseSharedSessionPatch,
  type SharedSessionState,
} from '@/lib/session-state';

export const dynamic = 'force-dynamic';

let sessionState: SharedSessionState = { ...DEFAULT_SHARED_SESSION_STATE };

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' };

export async function GET() {
  return Response.json(sessionState, { headers: noStoreHeaders });
}

export async function PUT(request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > 8192) {
      return Response.json({ ok: false, error: 'Request body is too large' }, { status: 413, headers: noStoreHeaders });
    }
    const patch = parseSharedSessionPatch(await request.json());
    sessionState = {
      ...sessionState,
      ...patch,
      revision: sessionState.revision + 1,
      updatedAt: Date.now(),
    };
    return Response.json(sessionState, { headers: noStoreHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid shared session state';
    return Response.json({ ok: false, error: message }, { status: 400, headers: noStoreHeaders });
  }
}
