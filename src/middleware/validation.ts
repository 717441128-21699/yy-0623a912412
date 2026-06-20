import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

const createTaskSchema = z.object({
  waybill_no: z.string().min(1, '运单号不能为空'),
  plate_no: z.string().min(1, '车牌号不能为空'),
  driver_id: z.string().min(1, '司机ID不能为空'),
  driver_name: z.string().min(1, '司机姓名不能为空'),
  goods_temp_zone: z.string().min(1, '货品温区不能为空'),
  temp_min: z.number(),
  temp_max: z.number(),
  check_interval_minutes: z.number().int().positive('检查间隔必须为正整数'),
  stations: z.array(
    z.object({
      station_name: z.string().min(1, '站点名称不能为空'),
      station_address: z.string().optional(),
      planned_arrival_time: z.string().optional(),
    })
  ).min(1, '至少需要一个站点'),
});

const submitReportSchema = z.object({
  task_id: z.string().min(1, '任务ID不能为空'),
  station_id: z.string().optional(),
  report_source: z.enum(['driver_app', 'onboard_device']),
  temperature: z.number().optional(),
  photo_url: z.string().optional(),
  remark: z.string().optional(),
  report_time: z.string().optional(),
  check_type: z.enum(['arrival', 'temperature', 'photo', 'departure', 'transit_temperature']).optional(),
  check_item_id: z.string().optional(),
});

const handleExceptionSchema = z.object({
  exception_id: z.string().min(1, '异常ID不能为空'),
  handler: z.string().min(1, '处理人不能为空'),
  handle_remark: z.string().min(1, '处理备注不能为空'),
  status: z.enum(['pending', 'handling', 'closed']),
});

export function validateCreateTask(req: Request, res: Response, next: NextFunction) {
  try {
    createTaskSchema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: '参数校验失败',
        details: error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
    } else {
      next(error);
    }
  }
}

export function validateSubmitReport(req: Request, res: Response, next: NextFunction) {
  try {
    submitReportSchema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: '参数校验失败',
        details: error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
    } else {
      next(error);
    }
  }
}

export function validateHandleException(req: Request, res: Response, next: NextFunction) {
  try {
    handleExceptionSchema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: '参数校验失败',
        details: error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
    } else {
      next(error);
    }
  }
}
