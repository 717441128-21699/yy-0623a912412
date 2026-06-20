import * as taskDao from '../daos/taskDao';
import { CreateTaskRequest, TemperatureTask, TaskStation, CheckItem } from '../types';

export interface TaskDetailResponse {
  task: TemperatureTask;
  stations: (TaskStation & { check_items: CheckItem[] })[];
}

export function generateTask(request: CreateTaskRequest): {
  task: TemperatureTask;
  stations: TaskStation[];
  checkItems: CheckItem[];
  checklist: Array<{
    station_index: number;
    station_name: string;
    items: Array<{
      check_type: string;
      check_name: string;
      required: boolean;
      sort_order: number;
    }>;
  }>;
} {
  const result = taskDao.createTask(request);

  const checklist = result.stations.map((station) => {
    const items = result.checkItems
      .filter((item) => item.station_id === station.id)
      .map((item) => ({
        check_type: item.check_type,
        check_name: item.check_name,
        required: item.required === 1,
        sort_order: item.sort_order,
      }));

    return {
      station_index: station.station_index,
      station_name: station.station_name,
      items,
    };
  });

  return {
    ...result,
    checklist,
  };
}

export function getTaskDetail(taskId: string): TaskDetailResponse | null {
  const task = taskDao.getTaskById(taskId);
  if (!task) return null;

  const stations = taskDao.getStationsByTaskId(taskId);
  const stationsWithItems = stations.map((station) => {
    const checkItems = taskDao.getCheckItemsByStationId(station.id);
    return { ...station, check_items: checkItems };
  });

  return {
    task,
    stations: stationsWithItems,
  };
}

export function getTaskByWaybill(waybillNo: string): TemperatureTask[] {
  return taskDao.getTasksByWaybill(waybillNo);
}
