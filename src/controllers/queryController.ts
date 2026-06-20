import { Request, Response } from 'express';
import * as queryService from '../services/queryService';
import { FilterStatus, DashboardQuery, ExceptionQueueQuery, ExceptionPriority } from '../services/queryService';

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

export async function dashboardQuery(req: Request, res: Response) {
  const params: DashboardQuery = {};

  if (req.query.plate_no) params.plate_no = req.query.plate_no as string;
  if (req.query.driver_id) params.driver_id = req.query.driver_id as string;
  if (req.query.goods_temp_zone) params.goods_temp_zone = req.query.goods_temp_zone as string;
  if (req.query.exception_status) params.exception_status = req.query.exception_status as any;
  if (req.query.planned_arrival_from) params.planned_arrival_from = req.query.planned_arrival_from as string;
  if (req.query.planned_arrival_to) params.planned_arrival_to = req.query.planned_arrival_to as string;

  const result = queryService.queryDashboard(params);

  res.json({
    code: 0,
    data: {
      total: result.length,
      query: params,
      tasks: result,
    },
  });
}

export async function exceptionQueue(req: Request, res: Response) {
  const params: ExceptionQueueQuery = {};

  if (req.query.status) params.status = req.query.status as any;
  if (req.query.plate_no) params.plate_no = req.query.plate_no as string;
  if (req.query.driver_id) params.driver_id = req.query.driver_id as string;
  if (req.query.goods_temp_zone) params.goods_temp_zone = req.query.goods_temp_zone as string;
  if (req.query.exception_type) params.exception_type = req.query.exception_type as string;
  if (req.query.min_priority) params.min_priority = req.query.min_priority as ExceptionPriority;

  if (req.query.pending_minutes_min) {
    const v = parseInt(req.query.pending_minutes_min as string, 10);
    if (!isNaN(v)) params.pending_minutes_min = v;
  }
  if (req.query.pending_minutes_max) {
    const v = parseInt(req.query.pending_minutes_max as string, 10);
    if (!isNaN(v)) params.pending_minutes_max = v;
  }

  const result = queryService.queryExceptionQueue(params);

  const counts = {
    total: result.length,
    critical: result.filter((r) => r.priority === 'critical').length,
    high: result.filter((r) => r.priority === 'high').length,
    medium: result.filter((r) => r.priority === 'medium').length,
    low: result.filter((r) => r.priority === 'low').length,
  };

  res.json({
    code: 0,
    data: {
      query: params,
      counts,
      items: result,
    },
  });
}
