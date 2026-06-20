import * as taskDao from '../daos/taskDao';
import {
  TemperatureTask,
  TaskStation,
  CheckItem,
  CheckReport,
  ExceptionRecord,
} from '../types';

export type TimelineNodeType = 'station_arrival' | 'station_check' | 'transit_check' | 'exception' | 'station_departure';
export type FilterStatus = 'all' | 'pending' | 'exception' | 'overdue' | 'completed' | 'closed';

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
  current_location?: string;
  next_due_time?: string;
}

export interface TimelineNode {
  id: string;
  type: TimelineNodeType;
  title: string;
  status: 'pending' | 'completed' | 'exception' | 'overdue';
  planned_time?: string;
  actual_time?: string;
  station_index?: number;
  station_name?: string;
  check_item_id?: string;
  exception_id?: string;
  details?: any;
  sort_key: string;
}

export interface TaskStatusDetail {
  task: TemperatureTask;
  stations: StationStatusDetail[];
  transit_checks: TransitCheckDetail[];
  overdue_nodes: OverdueNode[];
  temperature_violations: TemperatureViolation[];
  exceptions: ExceptionSummary[];
  timeline: TimelineNode[];
  summary: TaskSummary;
}

export function isCheckOverdue(item: CheckItem): boolean {
  if (!item.due_time || item.status !== 'pending') return false;
  return Date.now() > new Date(item.due_time).getTime();
}

function isStationOverdue(station: TaskStation): boolean {
  if (!station.planned_arrival_time || station.status === 'completed') return false;
  return Date.now() > new Date(station.planned_arrival_time).getTime();
}

function buildTimeline(
  task: TemperatureTask,
  stations: TaskStation[],
  stationItems: CheckItem[],
  transitItems: CheckItem[],
  allReports: CheckReport[],
  exceptions: ExceptionRecord[],
  filter?: FilterStatus
): TimelineNode[] {
  const nodes: TimelineNode[] = [];

  stations.forEach((station) => {
    if (station.planned_arrival_time) {
      nodes.push({
        id: `arrival_${station.id}`,
        type: 'station_arrival',
        title: `到达 ${station.station_name}`,
        status: station.status === 'arrived' || station.status === 'completed' ? 'completed' :
                isStationOverdue(station) ? 'overdue' : 'pending',
        planned_time: station.planned_arrival_time,
        actual_time: station.actual_arrival_time,
        station_index: station.station_index,
        station_name: station.station_name,
        sort_key: station.planned_arrival_time,
      });
    }

    const items = stationItems.filter((i) => i.station_id === station.id);
    items.forEach((item) => {
      const report = allReports.find((r) => r.check_item_id === item.id);
      let status: TimelineNode['status'] = 'pending';
      if (item.status === 'completed') status = 'completed';
      else if (item.status === 'exception') status = 'exception';
      else if (item.status === 'pending' && isCheckOverdue(item)) status = 'overdue';

      const node: TimelineNode = {
        id: `check_${item.id}`,
        type: item.check_type === 'departure' ? 'station_departure' : 'station_check',
        title: item.check_name,
        status,
        planned_time: item.due_time,
        actual_time: report?.report_time,
        station_index: station.station_index,
        station_name: station.station_name,
        check_item_id: item.id,
        details: {
          check_type: item.check_type,
          temperature: report?.temperature,
          photo_url: report?.photo_url,
        },
        sort_key: item.due_time || station.planned_arrival_time || '',
      };
      nodes.push(node);
    });
  });

  transitItems.forEach((item) => {
    const report = allReports.find((r) => r.check_item_id === item.id);
    let status: TimelineNode['status'] = 'pending';
    if (item.status === 'completed') status = 'completed';
    else if (item.status === 'exception') status = 'exception';
    else if (item.status === 'pending' && isCheckOverdue(item)) status = 'overdue';

    nodes.push({
      id: `transit_${item.id}`,
      type: 'transit_check',
      title: item.check_name,
      status,
      planned_time: item.due_time,
      actual_time: report?.report_time,
      check_item_id: item.id,
      details: {
        temperature: report?.temperature,
      },
      sort_key: item.due_time || '',
    });
  });

  exceptions.forEach((exc) => {
    nodes.push({
      id: `exc_${exc.id}`,
      type: 'exception',
      title: `${exc.exception_type === 'temperature_violation' ? '温度越界' : '异常事件'}`,
      status: exc.status === 'closed' ? 'completed' : 'exception',
      planned_time: exc.created_at,
      actual_time: exc.created_at,
      exception_id: exc.id,
      details: {
        exception_type: exc.exception_type,
        description: exc.description,
        temperature: exc.temperature,
        driver_remark: exc.driver_remark,
        handler: exc.handler,
        handle_remark: exc.handle_remark,
        handled_at: exc.handled_at,
      },
      sort_key: exc.created_at,
    });
  });

  nodes.sort((a, b) => {
    const ta = a.planned_time ? new Date(a.planned_time).getTime() : 0;
    const tb = b.planned_time ? new Date(b.planned_time).getTime() : 0;
    return ta - tb;
  });

  if (filter && filter !== 'all') {
    return nodes.filter((n) => {
      if (filter === 'pending') return n.status === 'pending';
      if (filter === 'exception') return n.status === 'exception';
      if (filter === 'overdue') return n.status === 'overdue';
      if (filter === 'completed') return n.status === 'completed';
      if (filter === 'closed') return n.status === 'completed' && n.type === 'exception';
      return true;
    });
  }

  return nodes;
}

export function getTaskStatusByWaybill(
  waybillNo: string,
  filter?: FilterStatus
): TaskStatusDetail[] {
  const tasks = taskDao.getTasksByWaybill(waybillNo);
  return tasks.map((task) => buildTaskStatusDetail(task.id, filter));
}

export function getTaskStatusById(
  taskId: string,
  filter?: FilterStatus
): TaskStatusDetail | null {
  const task = taskDao.getTaskById(taskId);
  if (!task) return null;
  return buildTaskStatusDetail(taskId, filter);
}

function buildTaskStatusDetail(
  taskId: string,
  filter?: FilterStatus
): TaskStatusDetail {
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

    return {
      station,
      station_checks: checks,
      reports,
      is_overdue: isStationOverdue(station),
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
      if (check.status === 'pending' && isCheckOverdue(check)) {
        overdueNodes.push({
          check_item_id: check.id,
          check_type: check.check_type,
          check_scope: check.check_scope,
          check_name: check.check_name,
          station_name: sd.station.station_name,
          due_time: check.due_time!,
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

  const timeline = buildTimeline(
    task, stations, stationItems, transitItems, allReports, exceptions, filter
  );

  const totalStationChecks = stationItems.filter((i) => i.required === 1);
  const totalTransitChecks = transitItems.filter((i) => i.required === 1);

  const pendingOverdue = [...stationItems, ...transitItems]
    .filter((i) => i.required === 1 && i.status === 'pending' && isCheckOverdue(i));

  const currentStation = stationDetails.find((s) => s.station.status === 'arrived')
    || stationDetails.find((s) => s.station.status === 'pending');
  const nextDueItem = [...totalStationChecks, ...totalTransitChecks]
    .filter((i) => i.status === 'pending' && i.due_time)
    .sort((a, b) => new Date(a.due_time!).getTime() - new Date(b.due_time!).getTime())[0];

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
    overdue_count: pendingOverdue.length,
    temperature_violation_count: tempViolations.length,
    exception_total: exceptions.length,
    exception_pending: exceptions.filter((e) => e.status === 'pending').length,
    exception_handling: exceptions.filter((e) => e.status === 'handling').length,
    exception_closed: exceptions.filter((e) => e.status === 'closed').length,
    has_open_exception: exceptions.some((e) => e.status !== 'closed'),
    current_location: currentStation?.station.station_name,
    next_due_time: nextDueItem?.due_time,
  };

  return {
    task,
    stations: stationDetails,
    transit_checks: transitDetails,
    overdue_nodes: overdueNodes,
    temperature_violations: tempViolations,
    exceptions: exceptionSummary,
    timeline,
    summary,
  };
}
