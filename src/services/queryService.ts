import * as taskDao from '../daos/taskDao';
import { TemperatureTask, TaskStation, CheckItem, CheckReport } from '../types';

export interface TaskStatusDetail {
  task: TemperatureTask;
  stations: StationStatusDetail[];
  summary: TaskSummary;
}

export interface StationStatusDetail {
  station: TaskStation;
  check_items: CheckItem[];
  reports: CheckReport[];
  is_overdue: boolean;
  completed_count: number;
  total_required: number;
}

export interface TaskSummary {
  total_stations: number;
  completed_stations: number;
  in_progress_stations: number;
  pending_stations: number;
  total_check_items: number;
  completed_check_items: number;
  exception_count: number;
  overdue_count: number;
  has_temperature_violation: boolean;
}

export function getTaskStatusByWaybill(waybillNo: string): TaskStatusDetail[] {
  const tasks = taskDao.getTasksByWaybill(waybillNo);
  return tasks.map((task) => buildTaskStatusDetail(task.id));
}

export function getTaskStatusById(taskId: string): TaskStatusDetail | null {
  const task = taskDao.getTaskById(taskId);
  if (!task) return null;
  return buildTaskStatusDetail(taskId);
}

function buildTaskStatusDetail(taskId: string): TaskStatusDetail {
  const task = taskDao.getTaskById(taskId)!;
  const stations = taskDao.getStationsByTaskId(taskId);
  const allCheckItems = taskDao.getCheckItemsByTaskId(taskId);
  const allReports = taskDao.getReportsByTaskId(taskId);

  const stationDetails: StationStatusDetail[] = stations.map((station) => {
    const checkItems = allCheckItems.filter((item) => item.station_id === station.id);
    const reports = allReports.filter((r) => r.station_id === station.id);
    const requiredItems = checkItems.filter((item) => item.required === 1);
    const completedItems = checkItems.filter((item) => item.status === 'completed' || item.status === 'exception');

    let isOverdue = false;
    if (station.planned_arrival_time && station.status !== 'completed') {
      const plannedTime = new Date(station.planned_arrival_time).getTime();
      const now = Date.now();
      if (now > plannedTime && station.status === 'pending') {
        isOverdue = true;
      }
    }

    return {
      station,
      check_items: checkItems,
      reports,
      is_overdue: isOverdue,
      completed_count: completedItems.length,
      total_required: requiredItems.length,
    };
  });

  const summary: TaskSummary = {
    total_stations: stations.length,
    completed_stations: stations.filter((s) => s.status === 'completed').length,
    in_progress_stations: stations.filter((s) => s.status === 'arrived').length,
    pending_stations: stations.filter((s) => s.status === 'pending').length,
    total_check_items: allCheckItems.length,
    completed_check_items: allCheckItems.filter((item) => item.status === 'completed').length,
    exception_count: allReports.filter((r) => r.is_exception === 1).length,
    overdue_count: stationDetails.filter((s) => s.is_overdue).length,
    has_temperature_violation: allReports.some((r) => r.exception_type === 'temperature_violation'),
  };

  return {
    task,
    stations: stationDetails,
    summary,
  };
}
