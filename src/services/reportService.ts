import * as taskDao from '../daos/taskDao';
import { SubmitReportRequest, CheckReport, CheckItem, TaskStation } from '../types';

export type ReportAction = 'continue' | 'handover' | 'exception';

export interface SubmitReportResponse {
  success: boolean;
  report_id: string;
  action: ReportAction;
  message: string;
  current_station?: {
    id: string;
    station_index: number;
    station_name: string;
    status: string;
  };
  missing_items?: Array<{
    check_type: string;
    check_name: string;
  }>;
  next_station?: {
    id: string;
    station_index: number;
    station_name: string;
  };
  is_temperature_violation?: boolean;
  temperature_range?: {
    min: number;
    max: number;
  };
}

export function submitReport(request: SubmitReportRequest): SubmitReportResponse {
  const task = taskDao.getTaskById(request.task_id);
  if (!task) {
    throw new Error('任务不存在');
  }

  let stationId = request.station_id;
  let station: TaskStation | undefined;

  if (stationId) {
    station = taskDao.getStationById(stationId);
    if (!station || station.task_id !== request.task_id) {
      throw new Error('站点不存在或不属于该任务');
    }
  } else {
    station = taskDao.getCurrentStationByTaskId(request.task_id);
    if (!station) {
      throw new Error('没有待处理的站点');
    }
    stationId = station.id;
  }

  const reportTime = request.report_time || new Date().toISOString();
  let isException = false;
  let exceptionType: string | undefined;

  if (request.temperature !== undefined) {
    if (request.temperature < task.temp_min || request.temperature > task.temp_max) {
      isException = true;
      exceptionType = 'temperature_violation';
    }
  }

  if (request.remark && request.remark.length > 0) {
    isException = true;
    if (!exceptionType) {
      exceptionType = 'driver_remark';
    }
  }

  let checkItemId: string | undefined;

  if (request.check_type) {
    const pendingItem = taskDao.findPendingCheckItem(stationId, request.check_type);
    if (pendingItem) {
      checkItemId = pendingItem.id;
      taskDao.updateCheckItemStatus(
        pendingItem.id,
        isException ? 'exception' : 'completed',
        reportTime
      );
    }
  }

  if (request.check_type === 'arrival') {
    if (station.status === 'pending') {
      taskDao.updateStationStatus(stationId, 'arrived', reportTime);
      station.status = 'arrived';
    }
  }

  const report = taskDao.createReport(
    task.id,
    stationId,
    checkItemId,
    request.report_source,
    request.temperature,
    request.photo_url,
    request.remark,
    reportTime,
    isException,
    exceptionType
  );

  if (task.status === 'pending') {
    taskDao.updateTaskStatus(task.id, 'in_progress');
  } else if (isException && task.status !== 'exception') {
    taskDao.updateTaskStatus(task.id, 'exception');
  }

  const stationCheckItems = taskDao.getCheckItemsByStationId(stationId);
  const requiredItems = stationCheckItems.filter((item) => item.required === 1);
  const pendingRequired = requiredItems.filter((item) => item.status === 'pending');

  let action: ReportAction;
  let message: string;
  let missingItems: Array<{ check_type: string; check_name: string }> = [];

  if (isException) {
    action = 'exception';
    message = '检测到异常，已触发异常跟进';
    if (exceptionType === 'temperature_violation') {
      message = `温度越界！当前温度 ${request.temperature}°C，要求范围 ${task.temp_min}°C ~ ${task.temp_max}°C，已触发异常跟进`;
    }
  } else if (pendingRequired.length > 0) {
    action = 'continue';
    message = `还有 ${pendingRequired.length} 项待完成，请继续补录`;
    missingItems = pendingRequired.map((item) => ({
      check_type: item.check_type,
      check_name: item.check_name,
    }));
  } else {
    action = 'handover';
    message = '本站点所有检查项已完成，允许交接';
    taskDao.updateStationStatus(stationId, 'completed');

    const allStations = taskDao.getStationsByTaskId(task.id);
    const completedStations = allStations.filter((s) => s.status === 'completed');
    if (completedStations.length === allStations.length) {
      taskDao.updateTaskStatus(task.id, 'completed');
      message = '所有站点检查已完成，任务结束';
    }
  }

  const nextStation = taskDao.getNextStationByTaskId(task.id);
  const currentStation = taskDao.getStationById(stationId);

  return {
    success: true,
    report_id: report.id,
    action,
    message,
    current_station: currentStation
      ? {
          id: currentStation.id,
          station_index: currentStation.station_index,
          station_name: currentStation.station_name,
          status: currentStation.status,
        }
      : undefined,
    missing_items: missingItems.length > 0 ? missingItems : undefined,
    next_station: nextStation && nextStation.id !== stationId
      ? {
          id: nextStation.id,
          station_index: nextStation.station_index,
          station_name: nextStation.station_name,
        }
      : undefined,
    is_temperature_violation: exceptionType === 'temperature_violation',
    temperature_range: {
      min: task.temp_min,
      max: task.temp_max,
    },
  };
}
