import * as taskDao from '../daos/taskDao';
import { BatchSubmitRequest, BatchTemperaturePoint, CheckItem, CheckReport, ExceptionRecord } from '../types';
import { isCheckOverdue } from './queryService';

export interface BatchPointResult {
  point_index: number;
  report_time: string;
  temperature: number;
  matched_check_item_id?: string;
  matched_check_name?: string;
  is_duplicate: boolean;
  is_violation: boolean;
  exception_id?: string;
  report_id?: string;
  error?: string;
}

export interface BatchSubmitResponse {
  success: boolean;
  total_points: number;
  processed_points: number;
  matched_points: number;
  duplicate_points: number;
  violation_count: number;
  results: BatchPointResult[];
  task_status: string;
  has_open_exception: boolean;
  summary_message: string;
}

function findMatchingCheckItem(
  taskId: string,
  reportTime: string
): CheckItem | undefined {
  const allItems = [
    ...taskDao.getStationCheckItemsByTaskId(taskId),
    ...taskDao.getTransitCheckItemsByTaskId(taskId),
  ].filter((item) => item.required === 1 && item.due_time && item.status === 'pending');

  if (allItems.length === 0) return undefined;

  const targetTime = new Date(reportTime).getTime();
  let bestMatch: CheckItem | undefined;
  let bestDiff = Infinity;

  for (const item of allItems) {
    if (!item.due_time) continue;
    const dueTime = new Date(item.due_time).getTime();
    const diff = Math.abs(targetTime - dueTime);

    const maxWindow = 60 * 60 * 1000;
    if (diff < bestDiff && diff < maxWindow) {
      bestDiff = diff;
      bestMatch = item;
    }
  }

  return bestMatch;
}

function isItemAlreadyReported(
  checkItemId: string,
  allReports: CheckReport[]
): boolean {
  return allReports.some((r) => r.check_item_id === checkItemId);
}

function processSinglePoint(
  point: BatchTemperaturePoint,
  index: number,
  taskId: string,
  tempMin: number,
  tempMax: number,
  allReports: CheckReport[]
): BatchPointResult {
  const result: BatchPointResult = {
    point_index: index,
    report_time: point.report_time,
    temperature: point.temperature,
    is_duplicate: false,
    is_violation: false,
  };

  if (point.temperature === undefined || point.temperature === null) {
    result.error = '缺少温度值';
    return result;
  }

  if (!point.report_time) {
    result.error = '缺少上报时间';
    return result;
  }

  const matchingItem = findMatchingCheckItem(taskId, point.report_time);
  if (!matchingItem) {
    result.error = '未找到匹配的计划巡检点';
    return result;
  }

  result.matched_check_item_id = matchingItem.id;
  result.matched_check_name = matchingItem.check_name;

  if (isItemAlreadyReported(matchingItem.id, allReports)) {
    result.is_duplicate = true;
    result.error = '该检查点已完成，跳过';
    return result;
  }

  const isViolation = point.temperature < tempMin || point.temperature > tempMax;
  result.is_violation = isViolation;

  const report = taskDao.createReport(
    taskId,
    matchingItem.station_id,
    matchingItem.id,
    'onboard_device',
    point.temperature,
    undefined,
    point.remark,
    point.report_time,
    isViolation,
    isViolation ? 'temperature_violation' : undefined
  );
  result.report_id = report.id;

  taskDao.updateCheckItemStatus(
    matchingItem.id,
    isViolation ? 'exception' : 'completed',
    point.report_time
  );

  if (isViolation) {
    const exc = taskDao.createException({
      task_id: taskId,
      station_id: matchingItem.station_id,
      check_item_id: matchingItem.id,
      report_id: report.id,
      exception_type: 'temperature_violation',
      description: `温度越界：${point.temperature}°C（范围 ${tempMin}°C ~ ${tempMax}°C）`,
      temperature: point.temperature,
      temperature_min: tempMin,
      temperature_max: tempMax,
      driver_remark: point.remark,
    });
    result.exception_id = exc.id;
  }

  return result;
}

export function submitBatchReport(request: BatchSubmitRequest): BatchSubmitResponse {
  const task = taskDao.getTaskById(request.task_id);
  if (!task) {
    throw new Error('任务不存在');
  }

  const allReports = taskDao.getReportsByTaskId(request.task_id);
  const results: BatchPointResult[] = [];

  request.points
    .sort((a, b) => new Date(a.report_time).getTime() - new Date(b.report_time).getTime())
    .forEach((point, idx) => {
      const result = processSinglePoint(
        point,
        idx,
        request.task_id,
        task.temp_min,
        task.temp_max,
        allReports
      );
      results.push(result);
      if (result.report_id) {
        allReports.push({
          id: result.report_id,
          task_id: request.task_id,
          station_id: '',
          check_item_id: result.matched_check_item_id,
          report_source: 'onboard_device',
          temperature: result.temperature,
          report_time: result.report_time,
          is_exception: result.is_violation ? 1 : 0,
          exception_type: result.is_violation ? 'temperature_violation' : undefined,
          created_at: new Date().toISOString(),
        });
      }
    });

  const processedPoints = results.filter((r) => r.report_id).length;
  const matchedPoints = results.filter((r) => r.matched_check_item_id).length;
  const duplicatePoints = results.filter((r) => r.is_duplicate).length;
  const violationCount = results.filter((r) => r.is_violation).length;

  if (task.status === 'pending') {
    taskDao.updateTaskStatus(request.task_id, 'in_progress');
  }
  if (violationCount > 0 && task.status !== 'exception') {
    taskDao.updateTaskStatus(request.task_id, 'exception');
  } else if (violationCount === 0 && task.status === 'exception') {
    const pendingExceptions = taskDao
      .getExceptionsByTaskId(request.task_id)
      .filter((e) => e.status !== 'closed');
    if (pendingExceptions.length === 0) {
      taskDao.updateTaskStatus(request.task_id, 'in_progress');
    }
  }

  const allItems = [
    ...taskDao.getStationCheckItemsByTaskId(request.task_id),
    ...taskDao.getTransitCheckItemsByTaskId(request.task_id),
  ].filter((i) => i.required === 1);
  const pendingItems = allItems.filter((i) => i.status === 'pending');

  let summaryMessage = `批量上报完成：共 ${request.points.length} 条，成功匹配 ${matchedPoints} 条，重复 ${duplicatePoints} 条，越界 ${violationCount} 条`;
  if (pendingItems.length > 0) {
    summaryMessage += `，还有 ${pendingItems.length} 项待完成`;
  }
  if (violationCount > 0) {
    summaryMessage += '，已触发异常跟进';
  }

  const exceptions = taskDao.getExceptionsByTaskId(request.task_id);
  const hasOpenException = exceptions.some((e) => e.status !== 'closed');
  const taskAfter = taskDao.getTaskById(request.task_id)!;

  return {
    success: true,
    total_points: request.points.length,
    processed_points: processedPoints,
    matched_points: matchedPoints,
    duplicate_points: duplicatePoints,
    violation_count: violationCount,
    results,
    task_status: taskAfter.status,
    has_open_exception: hasOpenException,
    summary_message: summaryMessage,
  };
}
