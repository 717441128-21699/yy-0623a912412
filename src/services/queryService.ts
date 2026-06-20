import * as taskDao from '../daos/taskDao';
import {
  TemperatureTask,
  TaskStation,
  CheckItem,
  CheckReport,
  ExceptionRecord,
} from '../types';

export interface StationStatusDetail {
  station: TaskStation;
  station_checks: CheckItem[];
  reports: CheckReport[];
  is_overdue: boolean;
  completed_count: number;
  total_required: number;
  temperature_reports: Array<{
    report_id: string;
    temperature: number;
    report_time: string;
    is_violation: boolean;
  }>;
}

export interface TransitCheckDetail {
  check_item: CheckItem;
  is_overdue: boolean;
  completed_report?: CheckReport;
}

export interface OverdueNode {
  check_item_id: string;
  check_type: string;
  check_scope: string;
  check_name: string;
  station_name?: string;
  due_time: string;
  completed?: string;
}

export interface TemperatureViolation {
  report_id: string;
  station_name?: string;
  temperature: number;
  temp_min: number;
  temp_max: number;
  report_time: string;
  exception_id?: string;
  driver_remark?: string;
}

export interface ExceptionSummary {
  exception_id: string;
  exception_type: string;
  description: string;
  status: string;
  temperature?: number;
  driver_remark?: string;
  handler?: string;
  handle_remark?: string;
  handled_at?: string;
  created_at: string;
}

export interface TaskSummary {
  total_stations: number;
  completed_stations: number;
  in_progress_stations: number;
  pending_stations: number;
  total_station_checks: number;
  completed_station_checks: number;
  total_transit_checks: number;
  completed_transit_checks: number;
  overdue_count: number;
  temperature_violation_count: number;
  exception_total: number;
  exception_pending: number;
  exception_handling: number;
  exception_closed: number;
  has_open_exception: boolean;
}

export interface TaskStatusDetail {
  task: TemperatureTask;
  stations: StationStatusDetail[];
  transit_checks: TransitCheckDetail[];
  overdue_nodes: OverdueNode[];
  temperature_violations: TemperatureViolation[];
  exceptions: ExceptionSummary[];
  summary: TaskSummary;
}

function isOverdue(item: CheckItem | TaskStation): boolean {
  const due = (item as any).due_time || (item as any).planned_arrival_time;
  if (!due) return false;
  return new Date().getTime() > new Date(due).getTime();
}

function isCheckOverdue(item: CheckItem): boolean {
  if (item.due_time && item.status === 'pending') {
    return new Date().getTime() > new Date(item.due_time).getTime();
  }
  return false;
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
  const stationItems = taskDao.getStationCheckItemsByTaskId(taskId);
  const transitItems = taskDao.getTransitCheckItemsByTaskId(taskId);
  const allReports = taskDao.getReportsByTaskId(taskId);
  const exceptions = taskDao.getExceptionsByTaskId(taskId);

  const stationDetails: StationStatusDetail[] = stations.map((station) => {
    const checks = stationItems.filter((item) => item.station_id === station.id);
    const reports = allReports.filter((r) => r.station_id === station.id);
    const required = checks.filter((i) => i.required === 1);
    const completed = required.filter((i) => i.status === 'completed' || i.status === 'exception');
    const tempReports = reports
      .filter((r) => r.temperature !== undefined)
      .map((r) => ({
        report_id: r.id,
        temperature: r.temperature!,
        report_time: r.report_time,
        is_violation: r.is_exception === 1 && r.exception_type === 'temperature_violation',
      }));

    let stationOverdue = false;
    if (station.planned_arrival_time && station.status !== 'completed') {
      stationOverdue = isOverdue(station);
    }

    return {
      station,
      station_checks: checks,
      reports,
      is_overdue: stationOverdue,
      completed_count: completed.length,
      total_required: required.length,
      temperature_reports: tempReports,
    };
  });

  const transitDetails: TransitCheckDetail[] = transitItems.map((item) => {
    const report = allReports.find((r) => r.check_item_id === item.id);
    return {
      check_item: item,
      is_overdue: isCheckOverdue(item),
      completed_report: report,
    };
  });

  const overdueNodes: OverdueNode[] = [];

  stationDetails.forEach((sd) => {
    sd.station_checks.forEach((check) => {
      if (check.due_time && check.status === 'pending') {
        overdueNodes.push({
          check_item_id: check.id,
          check_type: check.check_type,
          check_scope: check.check_scope,
          check_name: check.check_name,
          station_name: sd.station.station_name,
          due_time: check.due_time,
        });
      }
    });
  });

  transitDetails.forEach((td) => {
    if (td.is_overdue) {
      overdueNodes.push({
        check_item_id: td.check_item.id,
        check_type: td.check_item.check_type,
        check_scope: td.check_item.check_scope,
        check_name: td.check_item.check_name,
        due_time: td.check_item.due_time!,
      });
    }
  });

  overdueNodes.sort(
    (a, b) => new Date(a.due_time).getTime() - new Date(b.due_time).getTime()
  );

  const tempViolations: TemperatureViolation[] = allReports
    .filter((r) => r.is_exception === 1 && r.exception_type === 'temperature_violation')
    .map((r) => {
      const station = stations.find((s) => s.id === r.station_id);
      const exc = exceptions.find((e) => e.report_id === r.id);
      return {
        report_id: r.id,
        station_name: station?.station_name,
        temperature: r.temperature!,
        temp_min: task.temp_min,
        temp_max: task.temp_max,
        report_time: r.report_time,
        exception_id: exc?.id,
        driver_remark: r.remark,
      };
    });

  const exceptionSummary: ExceptionSummary[] = exceptions.map((e) => ({
    exception_id: e.id,
    exception_type: e.exception_type,
    description: e.description,
    status: e.status,
    temperature: e.temperature,
    driver_remark: e.driver_remark,
    handler: e.handler,
    handle_remark: e.handle_remark,
    handled_at: e.handled_at,
    created_at: e.created_at,
  }));

  const totalStationChecks = stationItems.filter((i) => i.required === 1);
  const totalTransitChecks = transitItems.filter((i) => i.required === 1);

  const summary: TaskSummary = {
    total_stations: stations.length,
    completed_stations: stations.filter((s) => s.status === 'completed').length,
    in_progress_stations: stations.filter((s) => s.status === 'arrived').length,
    pending_stations: stations.filter((s) => s.status === 'pending').length,
    total_station_checks: totalStationChecks.length,
    completed_station_checks: totalStationChecks.filter(
      (i) => i.status === 'completed' || i.status === 'exception'
    ).length,
    total_transit_checks: totalTransitChecks.length,
    completed_transit_checks: totalTransitChecks.filter(
      (i) => i.status === 'completed' || i.status === 'exception'
    ).length,
    overdue_count: overdueNodes.length,
    temperature_violation_count: tempViolations.length,
    exception_total: exceptions.length,
    exception_pending: exceptions.filter((e) => e.status === 'pending').length,
    exception_handling: exceptions.filter((e) => e.status === 'handling').length,
    exception_closed: exceptions.filter((e) => e.status === 'closed').length,
    has_open_exception: exceptions.some((e) => e.status !== 'closed'),
  };

  return {
    task,
    stations: stationDetails,
    transit_checks: transitDetails,
    overdue_nodes: overdueNodes,
    temperature_violations: tempViolations,
    exceptions: exceptionSummary,
    summary,
  };
}
