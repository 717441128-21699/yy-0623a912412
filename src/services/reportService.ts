import * as taskDao from '../daos/taskDao';
import { SubmitReportRequest, CheckReport, CheckItem, TaskStation, CheckType } from '../types';

export type ReportAction = 'continue' | 'handover' | 'exception';

export interface MissingField {
  field: string;
  message: string;
}

export interface SubmitReportResponse {
  success: boolean;
  report_id?: string;
  action: ReportAction;
  message: string;
  current_station?: {
    id: string;
    station_index: number;
    station_name: string;
    status: string;
  };
  missing_items?: Array<{
    check_item_id?: string;
    check_type: string;
    check_scope: string;
    check_name: string;
    due_time?: string;
    is_overdue?: boolean;
  }>;
  missing_fields?: MissingField[];
  next_station?: {
    id: string;
    station_index: number;
    station_name: string;
  };
  next_transit_check?: {
    check_item_id: string;
    check_name: string;
    due_time?: string;
    is_overdue?: boolean;
  };
  is_temperature_violation?: boolean;
  temperature_range?: {
    min: number;
    max: number;
  };
  exception_id?: string;
}

export interface FieldRule {
  check_type: CheckType;
  required_fields: string[];
}

const FIELD_VALIDATION_RULES: FieldRule[] = [
  { check_type: 'temperature', required_fields: ['temperature'] },
  { check_type: 'transit_temperature', required_fields: ['temperature'] },
  { check_type: 'photo', required_fields: ['photo_url'] },
  { check_type: 'arrival', required_fields: [] },
  { check_type: 'departure', required_fields: [] },
];

function getValidationRule(checkType: CheckType): FieldRule | undefined {
  return FIELD_VALIDATION_RULES.find((r) => r.check_type === checkType);
}

function validateRequiredFields(
  request: SubmitReportRequest,
  checkType?: CheckType
): MissingField[] {
  const missing: MissingField[] = [];
  const ct = checkType || request.check_type;
  if (!ct) return missing;

  const rule = getValidationRule(ct);
  if (!rule) return missing;

  rule.required_fields.forEach((field) => {
    if (field === 'temperature') {
      if ((request as any)[field] === undefined || (request as any)[field] === null) {
        missing.push({ field, message: ct.includes('temperature') ? '温度检测必须上报温度值' : `${field} 不能为空` });
      }
    } else if (field === 'photo_url') {
      const val = (request as any)[field];
      if (!val || (typeof val === 'string' && val.trim().length === 0)) {
        missing.push({ field, message: '照片上传必须提供照片地址' });
      }
    }
  });

  return missing;
}

function isCheckItemOverdue(item: CheckItem): boolean {
  if (!item.due_time || item.status !== 'pending') return false;
  return new Date().getTime() > new Date(item.due_time).getTime();
}

function collectPendingItems(
  stationItems: CheckItem[],
  transitItems: CheckItem[]
) {
  const missing: SubmitReportResponse['missing_items'] = [];

  stationItems
    .filter((item) => item.required === 1 && item.status === 'pending')
    .forEach((item) => {
      missing.push({
        check_item_id: item.id,
        check_type: item.check_type,
        check_scope: item.check_scope,
        check_name: item.check_name,
        due_time: item.due_time,
        is_overdue: isCheckItemOverdue(item),
      });
    });

  transitItems
    .filter((item) => item.required === 1 && item.status === 'pending')
    .forEach((item) => {
      missing.push({
        check_item_id: item.id,
        check_type: item.check_type,
        check_scope: item.check_scope,
        check_name: item.check_name,
        due_time: item.due_time,
        is_overdue: isCheckItemOverdue(item),
      });
    });

  return missing;
}

function updateTaskStatusAfterChange(taskId: string, isException: boolean) {
  const task = taskDao.getTaskById(taskId);
  if (!task) return;

  if (task.status === 'pending') {
    taskDao.updateTaskStatus(taskId, 'in_progress');
  } else if (isException && task.status !== 'exception') {
    taskDao.updateTaskStatus(taskId, 'exception');
  } else if (!isException && task.status === 'exception') {
    const pendingExceptions = taskDao
      .getExceptionsByTaskId(taskId)
      .filter((e) => e.status !== 'closed');
    if (pendingExceptions.length === 0) {
      taskDao.updateTaskStatus(taskId, 'in_progress');
    }
  }
}

export function submitReport(request: SubmitReportRequest): SubmitReportResponse {
  const task = taskDao.getTaskById(request.task_id);
  if (!task) {
    throw new Error('任务不存在');
  }

  let effectiveCheckType = request.check_type;
  let checkItem: CheckItem | undefined;

  if (request.check_item_id) {
    checkItem = taskDao.getCheckItemById(request.check_item_id);
    if (!checkItem || checkItem.task_id !== request.task_id) {
      return {
        success: false,
        action: 'continue',
        message: '指定的检查项不存在',
      };
    }
    effectiveCheckType = checkItem.check_type;
  }

  const missingFields = validateRequiredFields(request, effectiveCheckType);
  if (missingFields.length > 0) {
    return {
      success: false,
      action: 'continue',
      message: `上报数据不完整，缺少必要字段：${missingFields.map((f) => f.field).join('、')}`,
      missing_fields: missingFields,
    };
  }

  let stationId = request.station_id;
  let station: TaskStation | undefined;

  if (checkItem) {
    stationId = checkItem.station_id;
    station = taskDao.getStationById(stationId);
  } else if (stationId) {
    station = taskDao.getStationById(stationId);
    if (!station || station.task_id !== request.task_id) {
      throw new Error('站点不存在或不属于该任务');
    }
  } else {
    if (effectiveCheckType === 'transit_temperature') {
      const nextTransit = taskDao.findNextDueTransitCheckItem(request.task_id);
      if (nextTransit) {
        checkItem = nextTransit;
        stationId = nextTransit.station_id;
        station = taskDao.getStationById(stationId);
      } else {
        station = taskDao.getCurrentStationByTaskId(request.task_id);
        if (!station) {
          throw new Error('没有待处理的站点');
        }
        stationId = station.id;
      }
    } else {
      station = taskDao.getCurrentStationByTaskId(request.task_id);
      if (!station) {
        throw new Error('没有待处理的站点');
      }
      stationId = station.id;
    }
  }

  const reportTime = request.report_time || new Date().toISOString();
  let isException = false;
  let exceptionType: string | undefined;

  const ct = effectiveCheckType;
  if ((ct === 'temperature' || ct === 'transit_temperature') && request.temperature !== undefined) {
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

  if (!checkItem && request.check_type && effectiveCheckType) {
    if (request.check_type === 'transit_temperature') {
      checkItem = taskDao.findNextDueTransitCheckItem(request.task_id);
    } else if (effectiveCheckType && !checkItem) {
      checkItem = taskDao.findPendingStationCheckItem(stationId, effectiveCheckType);
    }
  }

  if (checkItem && checkItem.status === 'pending') {
    taskDao.updateCheckItemStatus(
      checkItem.id,
      isException ? 'exception' : 'completed',
      reportTime
    );
  }

  if (effectiveCheckType === 'arrival' && station && station.status === 'pending') {
    taskDao.updateStationStatus(stationId, 'arrived', reportTime);
    station.status = 'arrived';
  }

  const report = taskDao.createReport(
    task.id,
    stationId,
    checkItem?.id,
    request.report_source,
    request.temperature,
    request.photo_url,
    request.remark,
    reportTime,
    isException,
    exceptionType
  );

  let exceptionId: string | undefined;
  if (isException) {
    const excRecord = taskDao.createException({
      task_id: task.id,
      station_id: stationId,
      check_item_id: checkItem?.id,
      report_id: report.id,
      exception_type: exceptionType as any,
      description:
        exceptionType === 'temperature_violation'
          ? `温度越界：${request.temperature}°C（范围 ${task.temp_min}°C ~ ${task.temp_max}°C）`
          : `司机备注异常：${request.remark}`,
      temperature: request.temperature,
      temperature_min: task.temp_min,
      temperature_max: task.temp_max,
      driver_remark: request.remark,
    });
    exceptionId = excRecord.id;
  }

  updateTaskStatusAfterChange(task.id, isException);

  const allStationItems = taskDao.getStationCheckItemsByTaskId(task.id);
  const allTransitItems = taskDao.getTransitCheckItemsByTaskId(task.id);
  const stationCheckItems = allStationItems.filter((item) => item.station_id === stationId);
  const requiredStationItems = stationCheckItems.filter((item) => item.required === 1);
  const pendingStationItems = requiredStationItems.filter((item) => item.status === 'pending');
  const pendingTransitItems = allTransitItems.filter(
    (item) => item.required === 1 && item.status === 'pending'
  );

  let action: ReportAction;
  let message: string;
  let missingItems: SubmitReportResponse['missing_items'] = [];

  if (isException) {
    action = 'exception';
    message = '检测到异常，已触发异常跟进，请联系调度处理';
    if (exceptionType === 'temperature_violation') {
      message = `温度越界！当前温度 ${request.temperature}°C，要求范围 ${task.temp_min}°C ~ ${task.temp_max}°C，已触发异常跟进（异常ID: ${exceptionId}）`;
    } else if (exceptionType === 'driver_remark') {
      message = `司机已上报异常备注，已触发异常跟进（异常ID: ${exceptionId}）`;
    }
    missingItems = collectPendingItems(stationCheckItems, []);
  } else if (pendingStationItems.length > 0) {
    action = 'continue';
    const totalPending = pendingStationItems.length + pendingTransitItems.length;
    message = `还有 ${totalPending} 项待完成（本站点:${pendingStationItems.length}项 / 途中巡检:${pendingTransitItems.length}项），请继续补录`;
    missingItems = collectPendingItems(stationCheckItems, pendingTransitItems.slice(0, 3));
  } else {
    action = 'handover';
    message = '本站点所有检查项已完成，允许交接';
    taskDao.updateStationStatus(stationId, 'completed');

    const allStations = taskDao.getStationsByTaskId(task.id);
    const completedStations = allStations.filter((s) => s.status === 'completed');
    const remainingTransit = allTransitItems.filter(
      (item) => item.required === 1 && item.status === 'pending'
    );

    if (completedStations.length === allStations.length && remainingTransit.length === 0) {
      const hasOpenException = taskDao
        .getExceptionsByTaskId(task.id)
        .some((e) => e.status !== 'closed');
      if (!hasOpenException) {
        taskDao.updateTaskStatus(task.id, 'completed');
        message = '所有站点和途中巡检已完成，任务结束';
      } else {
        message = '所有检查已完成，但仍有待闭环异常，请运营处理后完成任务';
      }
    }
  }

  const nextStation = taskDao.getNextStationByTaskId(task.id);
  const currentStation = taskDao.getStationById(stationId);
  const nextTransit = taskDao.findNextDueTransitCheckItem(task.id);

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
    next_transit_check: nextTransit
      ? {
          check_item_id: nextTransit.id,
          check_name: nextTransit.check_name,
          due_time: nextTransit.due_time,
          is_overdue: isCheckItemOverdue(nextTransit),
        }
      : undefined,
    is_temperature_violation: exceptionType === 'temperature_violation',
    temperature_range: {
      min: task.temp_min,
      max: task.temp_max,
    },
    exception_id: exceptionId,
  };
}
