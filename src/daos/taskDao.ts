import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../db/database';
import {
  TemperatureTask,
  TaskStation,
  CheckItem,
  CheckReport,
  CreateTaskRequest,
} from '../types';

function now(): string {
  return new Date().toISOString();
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
      { type: 'arrival' as const, name: '到站确认', required: 1, order: 1 },
      { type: 'temperature' as const, name: '温度检测', required: 1, order: 2 },
      { type: 'photo' as const, name: '货物照片', required: 1, order: 3 },
      { type: 'departure' as const, name: '离站确认', required: 1, order: 4 },
    ];

    itemTemplates.forEach((tpl) => {
      const itemId = uuidv4();
      const item: CheckItem = {
        id: itemId,
        task_id: taskId,
        station_id: stationId,
        check_type: tpl.type,
        check_name: tpl.name,
        required: tpl.required,
        sort_order: tpl.order,
        status: 'pending',
        created_at: createdAt,
      };
      dbStore.addCheckItem(item);
      checkItems.push(item);
    });
  });

  return { task, stations, checkItems };
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
    .sort((a, b) => {
      if (a.station_id === b.station_id) {
        return a.sort_order - b.sort_order;
      }
      return a.station_id.localeCompare(b.station_id);
    });
}

export function getCheckItemById(itemId: string): CheckItem | undefined {
  return dbStore.checkItems.find((item) => item.id === itemId);
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

export function findPendingCheckItem(
  stationId: string,
  checkType: string
): CheckItem | undefined {
  return dbStore.checkItems
    .filter((item) => item.station_id === stationId && item.check_type === checkType && item.status === 'pending')
    .sort((a, b) => a.sort_order - b.sort_order)[0];
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
