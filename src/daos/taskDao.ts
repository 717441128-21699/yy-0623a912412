import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../db/database';
import {
  TemperatureTask,
  TaskStation,
  CheckItem,
  CheckReport,
  CreateTaskRequest,
  ExceptionRecord,
  ExceptionType,
  ExceptionStatus,
} from '../types';

function now(): string {
  return new Date().toISOString();
}

function generateTransitCheckItems(
  taskId: string,
  stations: TaskStation[],
  intervalMinutes: number,
  createdAt: string
): CheckItem[] {
  const items: CheckItem[] = [];
  let sortCounter = 100;

  for (let i = 0; i < stations.length - 1; i++) {
    const fromStation = stations[i];
    const toStation = stations[i + 1];

    if (!fromStation.planned_arrival_time || !toStation.planned_arrival_time) {
      continue;
    }

    const startTime = new Date(fromStation.planned_arrival_time).getTime();
    const endTime = new Date(toStation.planned_arrival_time).getTime();
    const intervalMs = intervalMinutes * 60 * 1000;

    let checkTime = startTime + intervalMs;
    let sequence = 1;

    while (checkTime < endTime) {
      const itemId = uuidv4();
      const item: CheckItem = {
        id: itemId,
        task_id: taskId,
        station_id: fromStation.id,
        check_scope: 'transit',
        check_type: 'transit_temperature',
        check_name: `途中温度巡检 #${sequence} (${fromStation.station_name} → ${toStation.station_name})`,
        required: 1,
        sort_order: sortCounter++,
        status: 'pending',
        due_time: new Date(checkTime).toISOString(),
        created_at: createdAt,
      };
      dbStore.addCheckItem(item);
      items.push(item);

      checkTime += intervalMs;
      sequence++;
    }
  }

  return items;
}

export function createTask(request: CreateTaskRequest): {
  task: TemperatureTask;
  stations: TaskStation[];
  checkItems: CheckItem[];
} {
  const taskId = uuidv4();
  const taskNo = `TC${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
  const createdAt = now();

  const task: TemperatureTask = {
    id: taskId,
    task_no: taskNo,
    waybill_no: request.waybill_no,
    plate_no: request.plate_no,
    driver_id: request.driver_id,
    driver_name: request.driver_name,
    goods_temp_zone: request.goods_temp_zone,
    temp_min: request.temp_min,
    temp_max: request.temp_max,
    check_interval_minutes: request.check_interval_minutes,
    status: 'pending',
    created_at: createdAt,
    updated_at: createdAt,
  };

  dbStore.addTask(task);

  const stations: TaskStation[] = [];
  const checkItems: CheckItem[] = [];

  request.stations.forEach((stationInput, index) => {
    const stationId = uuidv4();
    const station: TaskStation = {
      id: stationId,
      task_id: taskId,
      station_index: index + 1,
      station_name: stationInput.station_name,
      station_address: stationInput.station_address,
      planned_arrival_time: stationInput.planned_arrival_time,
      status: 'pending',
      created_at: createdAt,
    };

    dbStore.addStation(station);
    stations.push(station);

    const itemTemplates = [
      { type: 'arrival' as const, name: '到站确认', required: 1, order: 1, scope: 'station' as const },
      { type: 'temperature' as const, name: '温度检测', required: 1, order: 2, scope: 'station' as const },
      { type: 'photo' as const, name: '货物照片', required: 1, order: 3, scope: 'station' as const },
      { type: 'departure' as const, name: '离站确认', required: 1, order: 4, scope: 'station' as const },
    ];

    itemTemplates.forEach((tpl) => {
      const itemId = uuidv4();
      let dueTime: string | undefined;
      if (tpl.type === 'arrival' && stationInput.planned_arrival_time) {
        dueTime = stationInput.planned_arrival_time;
      } else if (tpl.type !== 'arrival' && stationInput.planned_arrival_time) {
        const baseTime = new Date(stationInput.planned_arrival_time).getTime();
        dueTime = new Date(baseTime + tpl.order * 30 * 60 * 1000).toISOString();
      }
      const item: CheckItem = {
        id: itemId,
        task_id: taskId,
        station_id: stationId,
        check_scope: tpl.scope,
        check_type: tpl.type,
        check_name: tpl.name,
        required: tpl.required,
        sort_order: tpl.order,
        status: 'pending',
        due_time: dueTime,
        created_at: createdAt,
      };
      dbStore.addCheckItem(item);
      checkItems.push(item);
    });
  });

  const transitItems = generateTransitCheckItems(
    taskId,
    stations,
    request.check_interval_minutes,
    createdAt
  );

  return { task, stations, checkItems: [...checkItems, ...transitItems] };
}

export function getTaskById(taskId: string): TemperatureTask | undefined {
  return dbStore.tasks.find((t) => t.id === taskId);
}

export function getTaskByTaskNo(taskNo: string): TemperatureTask | undefined {
  return dbStore.tasks.find((t) => t.task_no === taskNo);
}

export function getTasksByWaybill(waybillNo: string): TemperatureTask[] {
  return dbStore.tasks
    .filter((t) => t.waybill_no === waybillNo)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function getStationsByTaskId(taskId: string): TaskStation[] {
  return dbStore.stations
    .filter((s) => s.task_id === taskId)
    .sort((a, b) => a.station_index - b.station_index);
}

export function getStationById(stationId: string): TaskStation | undefined {
  return dbStore.stations.find((s) => s.id === stationId);
}

export function getCheckItemsByStationId(stationId: string): CheckItem[] {
  return dbStore.checkItems
    .filter((item) => item.station_id === stationId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function getCheckItemsByTaskId(taskId: string): CheckItem[] {
  return dbStore.checkItems
    .filter((item) => item.task_id === taskId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function getTransitCheckItemsByTaskId(taskId: string): CheckItem[] {
  return dbStore.checkItems
    .filter((item) => item.task_id === taskId && item.check_scope === 'transit')
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function getStationCheckItemsByTaskId(taskId: string): CheckItem[] {
  return dbStore.checkItems
    .filter((item) => item.task_id === taskId && item.check_scope === 'station')
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function getCheckItemById(itemId: string): CheckItem | undefined {
  return dbStore.checkItems.find((item) => item.id === itemId);
}

export function findNextDueTransitCheckItem(taskId: string): CheckItem | undefined {
  const pendingTransit = dbStore.checkItems.filter(
    (item) => item.task_id === taskId && item.check_scope === 'transit' && item.status === 'pending'
  );
  return pendingTransit.sort((a, b) => {
    const ta = a.due_time ? new Date(a.due_time).getTime() : 0;
    const tb = b.due_time ? new Date(b.due_time).getTime() : 0;
    return ta - tb;
  })[0];
}

export function findPendingStationCheckItem(
  stationId: string,
  checkType: string
): CheckItem | undefined {
  return dbStore.checkItems
    .filter(
      (item) =>
        item.station_id === stationId &&
        item.check_type === checkType &&
        item.check_scope === 'station' &&
        item.status === 'pending'
    )
    .sort((a, b) => a.sort_order - b.sort_order)[0];
}

export function updateCheckItemStatus(
  itemId: string,
  status: CheckItem['status'],
  completedTime?: string
): void {
  const updates: Partial<CheckItem> = { status };
  if (completedTime) {
    updates.completed_time = completedTime;
  }
  dbStore.updateCheckItem(itemId, updates);
}

export function updateStationStatus(
  stationId: string,
  status: TaskStation['status'],
  actualArrivalTime?: string
): void {
  const updates: Partial<TaskStation> = { status };
  const station = getStationById(stationId);
  if (actualArrivalTime && !station?.actual_arrival_time) {
    updates.actual_arrival_time = actualArrivalTime;
  }
  dbStore.updateStation(stationId, updates);
}

export function updateTaskStatus(
  taskId: string,
  status: TemperatureTask['status']
): void {
  dbStore.updateTask(taskId, { status, updated_at: now() });
}

export function createReport(
  taskId: string,
  stationId: string,
  checkItemId: string | undefined,
  reportSource: string,
  temperature: number | undefined,
  photoUrl: string | undefined,
  remark: string | undefined,
  reportTime: string,
  isException: boolean,
  exceptionType?: string
): CheckReport {
  const reportId = uuidv4();
  const createdAt = now();

  const report: CheckReport = {
    id: reportId,
    task_id: taskId,
    station_id: stationId,
    check_item_id: checkItemId,
    report_source: reportSource as any,
    temperature,
    photo_url: photoUrl,
    report_time: reportTime,
    remark,
    is_exception: isException ? 1 : 0,
    exception_type: exceptionType,
    created_at: createdAt,
  };

  dbStore.addReport(report);

  return report;
}

export function getReportsByTaskId(taskId: string): CheckReport[] {
  return dbStore.reports
    .filter((r) => r.task_id === taskId)
    .sort((a, b) => new Date(b.report_time).getTime() - new Date(a.report_time).getTime());
}

export function getReportsByStationId(stationId: string): CheckReport[] {
  return dbStore.reports
    .filter((r) => r.station_id === stationId)
    .sort((a, b) => new Date(b.report_time).getTime() - new Date(a.report_time).getTime());
}

export function getNextStationByTaskId(taskId: string): TaskStation | undefined {
  return dbStore.stations
    .filter((s) => s.task_id === taskId && s.status !== 'completed')
    .sort((a, b) => a.station_index - b.station_index)[0];
}

export function getCurrentStationByTaskId(taskId: string): TaskStation | undefined {
  return dbStore.stations
    .filter((s) => s.task_id === taskId && (s.status === 'arrived' || s.status === 'pending'))
    .sort((a, b) => a.station_index - b.station_index)[0];
}

export function createException(params: {
  task_id: string;
  station_id?: string;
  check_item_id?: string;
  report_id?: string;
  exception_type: ExceptionType;
  description: string;
  temperature?: number;
  temperature_min?: number;
  temperature_max?: number;
  driver_remark?: string;
}): ExceptionRecord {
  const exceptionId = uuidv4();
  const createdAt = now();

  const record: ExceptionRecord = {
    id: exceptionId,
    task_id: params.task_id,
    station_id: params.station_id,
    check_item_id: params.check_item_id,
    report_id: params.report_id,
    exception_type: params.exception_type,
    description: params.description,
    temperature: params.temperature,
    temperature_min: params.temperature_min,
    temperature_max: params.temperature_max,
    driver_remark: params.driver_remark,
    status: 'pending',
    created_at: createdAt,
  };

  dbStore.addException(record);
  return record;
}

export function getExceptionById(exceptionId: string): ExceptionRecord | undefined {
  return dbStore.exceptions.find((e) => e.id === exceptionId);
}

export function getExceptionsByTaskId(taskId: string): ExceptionRecord[] {
  return dbStore.exceptions
    .filter((e) => e.task_id === taskId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function handleException(
  exceptionId: string,
  handler: string,
  handleRemark: string,
  status: ExceptionStatus
): ExceptionRecord | undefined {
  const exception = getExceptionById(exceptionId);
  if (!exception) return undefined;

  dbStore.updateException(exceptionId, {
    status,
    handler,
    handle_remark: handleRemark,
    handled_at: now(),
  });

  return getExceptionById(exceptionId);
}
