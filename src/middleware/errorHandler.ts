import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error('[Error]', err.message);

  if (err.message === '任务不存在' || err.message === '站点不存在或不属于该任务' || err.message === '没有待处理的站点') {
    res.status(404).json({
      error: err.message,
    });
    return;
  }

  res.status(500).json({
    error: '服务器内部错误',
    message: err.message,
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: '接口不存在',
    path: req.path,
    method: req.method,
  });
}
