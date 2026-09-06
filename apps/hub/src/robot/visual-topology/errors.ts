export class RobotVisualTopologyError extends Error {
  constructor(
    readonly code: 'conflict' | 'not_found',
    message: string,
  ) {
    super(message);
  }
}
