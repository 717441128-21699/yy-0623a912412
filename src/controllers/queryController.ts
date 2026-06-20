import { Request, Response } from 'express';
import * as queryService from '../services/queryService';

export async function getTaskStatusByWaybill(req: Request, res: Response) {
  const { waybill_no } = req.params;
  const result = queryService.getTaskStatusByWaybill(waybill_no);

  res.json({
    code: 0,
    data: {
      total: result.length,
      tasks: result,
    },
  });
}

export async function getTaskStatusById(req: Request, res: Response) {
  const { id } = req.params;
  const result = queryService.getTaskStatusById(id);

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
