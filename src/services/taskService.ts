import * as taskDao from '../daos/taskDao';
import { CreateTaskRequest, TemperatureTask, TaskStation, CheckItem } from '../types';

export interface TaskDetailResponse {
  task: TemperatureTask;
  stations: (TaskStation & { check_items: CheckItem[] })[];
  transit_checks: CheckItem[];
}

export interface CheckListItem {
  check_item_id?: string;
  check_type: string;
  check_scope: string;
  check_name: string;
  required: boolean;
  sort_order: number;
  due_time?: string;
}

export function generateTask(request: CreateTaskRequest): {
  task: TemperatureTask;
  stations: TaskStation[];
  checkItems: CheckItem[];
  checklist: {
    station_index: number;
    station_name: string;
    planned_arrival_time?: string;
    station_checks: CheckListItem[];
  }[];
  transit_checks: CheckListItem[];
} {
  const result = taskDao.createTask(request);

  const checklist = result.stations.map((station) => {
    const stationChecks = result.checkItems
      .filter((item) => item.station_id === station.id && item.check_scope === 'station')
      .map((item) => ({
        check_item_id: item.id,
        check_type: item.check_type,
        check_scope: item.check_scope,
        check_name: item.check_name,
        required: item.required === 1,
        sort_order: item.sort_order,
        due_time: item.due_time,
      }));

    return {
      station_index: station.station_index,
      station_name: station.station_name,
      planned_arrival_time: station.planned_arrival_time,
      station_checks: stationChecks,
    };
  });

  const transitChecks = result.checkItems
    .filter((item) => item.check_scope === 'transit')
    .map((item) => ({
      check_item_id: item.id,
      check_type: item.check_type,
      check_scope: item.check_scope,
      check_name: item.check_name,
      required: item.required === 1,
      sort_order: item.sort_order,
      due_time: item.due_time,
    }));

  return {
    task: result.task,
    stations: result.stations,
    checkItems: result.checkItems,
    checklist,
    transit_checks: transitChecks,
  };
}

export function getTaskDetail(taskId: string): TaskDetailResponse | null {
  const task = taskDao.getTaskById(taskId);
  if (!task) return null;

  const stations = taskDao.getStationsByTaskId(taskId);
  const stationsWithItems = stations.map((station) => {
    const checkItems = taskDao
      .getCheckItemsByStationId(station.id)
      .filter((item) => item.check_scope === 'station');
    return { ...station, check_items: checkItems };
  });

  const transitChecks = taskDao.getTransitCheckItemsByTaskId(taskId);

  return {
    task,
    stations: stationsWithItems,
    transit_checks: transitChecks,
  };
}

export function getTaskByWaybill(waybillNo: string): TemperatureTask[] {
  return taskDao.getTasksByWaybill(waybillNo);
}
