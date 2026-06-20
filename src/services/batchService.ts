import * as taskDao from '../daos/taskDao';
import { BatchSubmitRequest, BatchTemperaturePoint, CheckItem, CheckReport, ExceptionRecord } from '../types';
import { isCheckOverdue } from './queryService';

export type BatchPointStatus = 'matched' | 'duplicate' | 'near_match' | 'no_match' | 'invalid';

export interface BatchPointResult {
  point_index: number;
  point_id?: string;
  report_time: string;
  temperature: number;
  status: BatchPointStatus;
  matched_check_item_id?: string;
  matched_check_name?: string;
  matched_due_time?: string;
  time_diff_minutes?: number;
  is_duplicate: boolean;
  is_violation: boolean;
  exception_id?: string;
  report_id?: string;
  remark?: string;
}

export interface BatchSubmitResponse {
  success: boolean;
  batch_id?: string;
  is_cached: boolean;
  total_points: number;
  matched_points: number;
  duplicate_points: number;
  near_match_points: number;
  no_match_points: number;
  invalid_points: number;
  violation_count: number;
  results: BatchPointResult[];
  task_status: string;
  has_open_exception: boolean;
  summary_message: string;
}

interface BatchCacheEntry {
  batch_id: string;
  task_id: string;
  response: BatchSubmitResponse;
  created_at: string;
}

const batchCache = new Map<string, BatchCacheEntry>();

function findMatchingCheckItem(
  taskId: string,
  reportTime: string,
  alreadyMatchedIds: Set<string>
): { item: CheckItem; timeDiffMinutes: number } | undefined {
  const allItems = [
    ...taskDao.getStationCheckItemsByTaskId(taskId),
    ...taskDao.getTransitCheckItemsByTaskId(taskId),
  ].filter(
    (item) =>
      item.required === 1 &&
      item.due_time &&
      item.status === 'pending' &&
      (item.check_type === 'temperature' || item.check_type === 'transit_temperature')
  );

  if (allItems.length === 0) return undefined;

  const targetTime = new Date(reportTime).getTime();
  let bestMatch: CheckItem | undefined;
  let bestDiff = Infinity;

  for (const item of allItems) {
    if (!item.due_time) continue;
    if (alreadyMatchedIds.has(item.id)) continue;

    const dueTime = new Date(item.due_time).getTime();
    const diff = Math.abs(targetTime - dueTime);

    const maxWindow = 120 * 60 * 1000;
    if (diff < bestDiff && diff < maxWindow) {
      bestDiff = diff;
      bestMatch = item;
    }
  }

  if (!bestMatch) return undefined;

  return {
    item: bestMatch,
    timeDiffMinutes: Math.round(bestDiff / (60 * 1000)),
  };
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
  allReports: CheckReport[],
  alreadyMatchedIds: Set<string>
): BatchPointResult {
  const result: BatchPointResult = {
    point_index: index,
    point_id: point.point_id,
    report_time: point.report_time,
    temperature: point.temperature,
    status: 'invalid',
    is_duplicate: false,
    is_violation: false,
    remark: point.remark,
  };

  if (point.temperature === undefined || point.temperature === null) {
    result.status = 'invalid';
    return result;
  }

  if (!point.report_time) {
    result.status = 'invalid';
    return result;
  }

  const match = findMatchingCheckItem(taskId, point.report_time, alreadyMatchedIds);
  if (!match) {
    const allPending = [
      ...taskDao.getStationCheckItemsByTaskId(taskId),
      ...taskDao.getTransitCheckItemsByTaskId(taskId),
    ].filter(
      (i) =>
        i.required === 1 &&
        i.due_time &&
        i.status === 'pending' &&
        (i.check_type === 'temperature' || i.check_type === 'transit_temperature')
    );

    if (allPending.length === 0) {
      result.status = 'no_match';
      result.remark = '所有温度巡检点已处理，数据已接收但无需匹配（仅温度类计划点生效）';
    } else {
      result.status = 'no_match';
      result.remark = '未找到时间窗口内的温度巡检点，数据已接收（仅匹配temperature/transit_temperature）';
    }
    return result;
  }

  result.matched_check_item_id = match.item.id;
  result.matched_check_name = match.item.check_name;
  result.matched_due_time = match.item.due_time;
  result.time_diff_minutes = match.timeDiffMinutes;

  if (isItemAlreadyReported(match.item.id, allReports)) {
    result.status = 'duplicate';
    result.is_duplicate = true;
    result.remark = `该检查点已有上报记录，本次重复推送已忽略（原检查点: ${match.item.check_name}）`;
    return result;
  }

  alreadyMatchedIds.add(match.item.id);

  if (match.timeDiffMinutes > 60) {
    result.status = 'near_match';
    result.remark = `匹配到最近巡检点（时间偏差${match.timeDiffMinutes}分钟），已记录`;
  } else {
    result.status = 'matched';
  }

  const isViolation = point.temperature < tempMin || point.temperature > tempMax;
  result.is_violation = isViolation;

  const report = taskDao.createReport(
    taskId,
    match.item.station_id,
    match.item.id,
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
    match.item.id,
    isViolation ? 'exception' : 'completed',
    point.report_time
  );

  if (isViolation) {
    const exc = taskDao.createException({
      task_id: taskId,
      station_id: match.item.station_id,
      check_item_id: match.item.id,
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

  const batchId = request.batch_id;
  const cacheKey = `${request.task_id}:${batchId || ''}`;
  if (batchId && batchCache.has(cacheKey)) {
    const cached = batchCache.get(cacheKey)!;
    return {
      ...cached.response,
      batch_id: batchId,
      is_cached: true,
      summary_message: `[批次重复] ${cached.response.summary_message}（已使用缓存结果，未产生重复记录）`,
    };
  }

  const allReports = taskDao.getReportsByTaskId(request.task_id);
  const results: BatchPointResult[] = [];
  const alreadyMatchedIds = new Set<string>();
  const alreadySeenPointIds = new Map<string, BatchPointResult>();

  const sortedPoints = [...request.points].sort(
    (a, b) => new Date(a.report_time).getTime() - new Date(b.report_time).getTime()
  );

  sortedPoints.forEach((point, idx) => {
    const originalIndex = request.points.indexOf(point);

    if (point.point_id && alreadySeenPointIds.has(point.point_id)) {
      const prev = alreadySeenPointIds.get(point.point_id)!;
      results.push({
        ...prev,
        point_index: originalIndex,
        status: 'duplicate',
        is_duplicate: true,
        remark: `同批内 point_id=${point.point_id} 重复，已忽略（首次处理结果: ${prev.status}）`,
      });
      return;
    }

    const result = processSinglePoint(
      point,
      originalIndex,
      request.task_id,
      task.temp_min,
      task.temp_max,
      allReports,
      alreadyMatchedIds
    );

    if (point.point_id) {
      alreadySeenPointIds.set(point.point_id, result);
    }

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

  results.sort((a, b) => a.point_index - b.point_index);

  const matchedPoints = results.filter((r) => r.status === 'matched').length;
  const duplicatePoints = results.filter((r) => r.status === 'duplicate').length;
  const nearMatchPoints = results.filter((r) => r.status === 'near_match').length;
  const noMatchPoints = results.filter((r) => r.status === 'no_match').length;
  const invalidPoints = results.filter((r) => r.status === 'invalid').length;
  const processedPoints = results.filter((r) => r.report_id).length;
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

  let summaryMessage = `批量上报完成：共 ${request.points.length} 条`;
  if (matchedPoints > 0) summaryMessage += `，精确匹配 ${matchedPoints} 条`;
  if (nearMatchPoints > 0) summaryMessage += `，近距匹配 ${nearMatchPoints} 条`;
  if (duplicatePoints > 0) summaryMessage += `，重复跳过 ${duplicatePoints} 条`;
  if (noMatchPoints > 0) summaryMessage += `，无匹配 ${noMatchPoints} 条（数据已接收）`;
  if (invalidPoints > 0) summaryMessage += `，无效 ${invalidPoints} 条`;
  if (violationCount > 0) summaryMessage += `，越界 ${violationCount} 条（已触发异常跟进）`;

  const exceptions = taskDao.getExceptionsByTaskId(request.task_id);
  const hasOpenException = exceptions.some((e) => e.status !== 'closed');
  const taskAfter = taskDao.getTaskById(request.task_id)!;

  const response: BatchSubmitResponse = {
    success: true,
    batch_id: batchId,
    is_cached: false,
    total_points: request.points.length,
    matched_points: matchedPoints + nearMatchPoints,
    duplicate_points: duplicatePoints,
    near_match_points: nearMatchPoints,
    no_match_points: noMatchPoints,
    invalid_points: invalidPoints,
    violation_count: violationCount,
    results,
    task_status: taskAfter.status,
    has_open_exception: hasOpenException,
    summary_message: summaryMessage,
  };

  if (batchId) {
    batchCache.set(cacheKey, {
      batch_id: batchId,
      task_id: request.task_id,
      response,
      created_at: new Date().toISOString(),
    });
  }

  return response;
}
