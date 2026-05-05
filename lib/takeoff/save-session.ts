import type { TakeoffSession } from '@/lib/types/takeoff';
import { takeoffSessionToApiPayload } from '@/lib/takeoff/workspace-v2';

const lastPersistedRevision = new Map<string, string>();
const activeSaveControllers = new Map<string, AbortController>();

export function registerPersistedSessionRevision(
  sessionId: string,
  updatedAt: string | null | undefined,
) {
  if (!updatedAt) return;
  lastPersistedRevision.set(sessionId, updatedAt);
}

async function performSave(
  session: TakeoffSession,
  expectedUpdatedAt: string,
  signal: AbortSignal,
) {
  return fetch(`/api/takeoff/sessions/${session.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...takeoffSessionToApiPayload(session),
      expected_updated_at: expectedUpdatedAt,
    }),
    signal,
  });
}

/**
 * Save the current takeoff session to Supabase.
 * Sends calibrations, traces, and classifications as JSONB.
 * Best-effort — logs errors but doesn't throw.
 */
export async function saveSession(session: TakeoffSession): Promise<boolean> {
  const previousController = activeSaveControllers.get(session.id);
  if (previousController) {
    previousController.abort();
  }

  const controller = new AbortController();
  activeSaveControllers.set(session.id, controller);
  const initialExpectedUpdatedAt =
    lastPersistedRevision.get(session.id) ?? session.updatedAt;

  try {
    let response = await performSave(
      session,
      initialExpectedUpdatedAt,
      controller.signal,
    );
    let conflictMessage: string | null = null;

    if (response.status === 409) {
      const conflictBody = await response
        .json()
        .catch(() => null) as { current_updated_at?: unknown; error?: unknown } | null;
      const currentUpdatedAt =
        typeof conflictBody?.current_updated_at === 'string'
          ? conflictBody.current_updated_at
          : null;
      conflictMessage =
        typeof conflictBody?.error === 'string' ? conflictBody.error : null;

      if (currentUpdatedAt && !controller.signal.aborted) {
        response = await performSave(session, currentUpdatedAt, controller.signal);
      }
    }

    if (!response.ok) {
      const text = conflictMessage ?? await response.text();
      console.error('[saveSession] Failed:', text);
      return false;
    }

    const data = await response.json().catch(() => null) as { updated_at?: unknown } | null;
    if (typeof data?.updated_at === 'string') {
      lastPersistedRevision.set(session.id, data.updated_at);
    }

    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return false;
    }
    console.error('[saveSession] Network error:', err);
    return false;
  } finally {
    if (activeSaveControllers.get(session.id) === controller) {
      activeSaveControllers.delete(session.id);
    }
  }
}
