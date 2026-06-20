import { Request, Response } from 'express';
import * as exceptionService from '../services/exceptionService';
import { HandleExceptionRequest } from '../types';

export async function getTaskExceptions(req: Request, res: Response) {
  const { task_id } = req.params;
  const result = exceptionService.getExceptionsByTaskId(task_id);

  if (!result) {
    res.status(404).json({
      code: 404,
      error: '任务不存在',
    });
    return;
  }

  res.json({
    code: 0,
    data: result,
  });
}

export async function getExceptionDetail(req: Request, res: Response) {
  const { id } = req.params;
  const exception = exceptionService.getExceptionById(id);

  if (!exception) {
    res.status(404).json({
      code: 404,
      error: '异常记录不存在',
    });
    return;
  }

  res.json({
    code: 0,
    data: exception,
  });
}

export async function handleException(req: Request, res: Response) {
  const request: HandleExceptionRequest = req.body;
  const result = exceptionService.handleException(request);

  if (!result) {
    res.status(404).json({
      code: 404,
      error: '异常记录不存在',
    });
    return;
  }

  res.json({
    code: 0,
    message:
      result.status === 'closed' ? '异常已闭环处理' : '异常已更新处理状态',
    data: result,
  });
}
