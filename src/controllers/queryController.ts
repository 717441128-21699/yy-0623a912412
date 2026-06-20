import { Request, Response } from 'express';
import * as queryService from '../services/queryService';
import { FilterStatus } from '../services/queryService';

const VALID_FILTERS: FilterStatus[] = ['all', 'pending', 'exception', 'overdue', 'completed', 'closed'];

function getFilter(req: Request): FilterStatus | undefined {
  const filter = req.query.filter as string;
  if (!filter) return undefined;
  if (VALID_FILTERS.includes(filter as FilterStatus)) {
    return filter as FilterStatus;
  }
  return undefined;
}

export async function getTaskStatusByWaybill(req: Request, res: Response) {
  const { waybill_no } = req.params;
  const filter = getFilter(req);
  const result = queryService.getTaskStatusByWaybill(waybill_no, filter);

  res.json({
    code: 0,
    data: {
      total: result.length,
      filter_applied: filter || 'all',
      available_filters: VALID_FILTERS,
      tasks: result,
    },
  });
}

export async function getTaskStatusById(req: Request, res: Response) {
  const { id } = req.params;
  const filter = getFilter(req);
  const result = queryService.getTaskStatusById(id, filter);

  if (!result) {
    res.status(404).json({
      code: 404,
      error: '任务不存在',
    });
    return;
  }

  res.json({
    code: 0,
    data: {
      filter_applied: filter || 'all',
      available_filters: VALID_FILTERS,
      ...result,
    },
  });
}
