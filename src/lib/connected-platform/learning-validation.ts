export class LearningInputError extends Error {
  readonly code = "LEARNING_INVALID_REQUEST";
  constructor(message: string, readonly status = 400) { super(message); }
}
export function learningOrder(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 100000) throw new LearningInputError("Display order must be a whole number between 0 and 100000.");
  return value;
}
export function validateWatchInput(input: { durationSeconds: number; positionSeconds: number; watchedSeconds: number; activeSeconds?: number }) {
  if (![input.durationSeconds, input.positionSeconds, input.watchedSeconds].every(Number.isFinite) || input.durationSeconds <= 0 || input.durationSeconds > 604800 || input.positionSeconds < 0 || input.positionSeconds > input.durationSeconds + 1 || input.watchedSeconds < 0 || (input.activeSeconds !== undefined && (!Number.isFinite(input.activeSeconds) || input.activeSeconds < 0 || input.activeSeconds > 15))) throw new LearningInputError("Invalid learning playback event.");
}
export function validateLearningReorder(items: Array<{id: string; sortOrder: number}>) {
  if (!items.length || items.length > 500 || items.some(item => !item.id.trim()) || new Set(items.map(item => item.id)).size !== items.length) throw new LearningInputError("Choose a unique list of learning content to reorder.");
  items.forEach(item => learningOrder(item.sortOrder));
  if (new Set(items.map(item => item.sortOrder)).size !== items.length) throw new LearningInputError("Each item needs a different display order.");
}
