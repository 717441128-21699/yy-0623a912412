import { Request, Response } from 'express';
import * as taskService from '../services/taskService';
import { CreateTaskRequest } from '../types';

export async function createTask(req: Request, res: Response) {
  const request: CreateTaskRequest = req.body;
  const result = taskService.generateTask(request);

  const stationCheckCount = result.checklist.reduce(
    (sum, s) => sum + s.station_checks.length,
    0
  );

  res.status(201).json({
    code: 0,
    message: '任务创建成功',
    data: {
      task_id: result.task.id,
      task_no: result.task.task_no,
      waybill_no: result.task.waybill_no,
      plate_no: result.task.plate_no,
      driver: {
        id: result.task.driver_id,
        name: result.task.driver_name,
      },
      temp_zone: {
        name: result.task.goods_temp_zone,
        temp_min: result.task.temp_min,
        temp_max: result.task.temp_max,
      },
      check_interval_minutes: result.task.check_interval_minutes,
      stations: result.checklist,
      transit_checks: result.transit_checks,
      total_stations: result.stations.length,
      total_station_checks: stationCheckCount,
      total_transit_checks: result.transit_checks.length,
      total_check_items: result.checkItems.length,
    },
  });
}

export async function getTask(req: Request, res: Response) {
  const { id } = req.params;
  const detail = taskService.getTaskDetail(id);

  if (!detail) {
    res.status(404).json({
      code: 404,
      error: '任务不存在',
    });
    return;
  }

  res.json({
    code: 0,
    data: detail,
  });
}

export async function getTasksByWaybill(req: Request, res: Response) {
  const { waybill_no } = req.params;
  const tasks = taskService.getTaskByWaybill(waybill_no);

  res.json({
    code: 0,
    data: {
      total: tasks.length,
      tasks,
    },
  });
}
