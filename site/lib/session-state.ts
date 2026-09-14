export type SharedSessionState = {
  revision: number;
  stageIndex: number;
  featuredCamera: number;
  planningProgress: number;
  instructionText: string;
  instructionEditing: boolean;
  updatedAt: number;
};

export type SharedSessionPatch = Partial<Pick<
  SharedSessionState,
  'stageIndex' | 'featuredCamera' | 'planningProgress' | 'instructionText' | 'instructionEditing'
>>;

export const DEFAULT_SHARED_SESSION_STATE: SharedSessionState = {
  revision: 0,
  stageIndex: 0,
  featuredCamera: 1,
  planningProgress: -1,
  instructionText: '',
  instructionEditing: false,
  updatedAt: Date.now(),
};

const integerInRange = (value: unknown, minimum: number, maximum: number) => (
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
);

export function parseSharedSessionPatch(value: unknown): SharedSessionPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Session state must be a JSON object');
  }
  const input = value as Record<string, unknown>;
  const patch: SharedSessionPatch = {};

  if ('stageIndex' in input) {
    if (!integerInRange(input.stageIndex, 0, 18)) throw new TypeError('Invalid stage index');
    patch.stageIndex = input.stageIndex as number;
  }
  if ('featuredCamera' in input) {
    if (!integerInRange(input.featuredCamera, 0, 2)) throw new TypeError('Invalid featured camera');
    patch.featuredCamera = input.featuredCamera as number;
  }
  if ('planningProgress' in input) {
    if (!integerInRange(input.planningProgress, -1, 7)) throw new TypeError('Invalid planning progress');
    patch.planningProgress = input.planningProgress as number;
  }
  if ('instructionText' in input) {
    if (typeof input.instructionText !== 'string' || input.instructionText.length > 4000) {
      throw new TypeError('Invalid instruction text');
    }
    patch.instructionText = input.instructionText;
  }
  if ('instructionEditing' in input) {
    if (typeof input.instructionEditing !== 'boolean') {
      throw new TypeError('Invalid instruction editing state');
    }
    patch.instructionEditing = input.instructionEditing;
  }

  if (!Object.keys(patch).length) throw new TypeError('No shared session fields provided');
  return patch;
}
