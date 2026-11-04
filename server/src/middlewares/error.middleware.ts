import { NextFunction, Request, Response } from 'express';
import { HttpException } from '@exceptions/HttpException';
import { logger } from '@utils/logger';

const errorMiddleware = (error: HttpException, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(error);

  // body-parser errors (400 invalid JSON, 413 too large) carry `status`/`statusCode` too.
  const status: number = error?.status || (error as any)?.statusCode || 500;
  const message: string = error?.message || 'Something went wrong';

  const log = `[${req.method}] ${req.path} >> StatusCode:: ${status}, Message:: ${message}`;
  if (status >= 500) {
    logger.error(log);
    logger.error(error);
  } else {
    // Client errors (bad signatures, oversized bodies) are expected noise, not app errors.
    logger.warn(log);
  }

  // Don't hand internal error details to the client.
  res.status(status).json({ message: status >= 500 ? 'Something went wrong' : message });
};

export default errorMiddleware;
