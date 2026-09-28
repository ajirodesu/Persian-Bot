import type { NextFunction, Request, Response } from 'express';

/**
 * Wraps an async (req, res) controller so rejections — e.g. a database
 * timeout inside requireAdmin() before the controller's own try/catch —
 * reach Express error middleware (JSON 500) instead of escaping as
 * unhandled promise rejections (the second of which kills the process).
 */
export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
