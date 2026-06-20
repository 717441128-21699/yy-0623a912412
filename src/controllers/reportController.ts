import { Request, Response } from 'express';
import * as reportService from '../services/reportService';
import { SubmitReportRequest } from '../types';

export async function submitReport(req: Request, res: Response) {
  const request: SubmitReportRequest = req.body;
  const result = reportService.submitReport(request);

  const statusCode = result.action === 'exception' ? 202 : 200;

  res.status(statusCode).json({
    code: 0,
    message: result.message,
    data: result,
  });
}
