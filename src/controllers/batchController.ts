import { Request, Response } from 'express';
import * as batchService from '../services/batchService';
import { BatchSubmitRequest } from '../types';

export async function submitBatchReport(req: Request, res: Response) {
  const request: BatchSubmitRequest = req.body;
  const result = batchService.submitBatchReport(request);

  res.json({
    code: 0,
    message: result.summary_message,
    data: result,
  });
}
