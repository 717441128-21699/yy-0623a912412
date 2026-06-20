export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'exception';
export type StationStatus = 'pending' | 'arrived' | 'completed';
export type CheckItemStatus = 'pending' | 'completed' | 'exception' | 'overdue';
export type CheckType = 'temperature' | 'photo' | 'arrival' | 'departure' | 'transit_temperature';
export type CheckScope = 'station' | 'transit';
export type ReportSource = 'driver_app' | 'onboard_device';
export type ExceptionStatus = 'pending' | 'handling' | 'closed';
export type ExceptionType = 'temperature_violation' | 'driver_remark' | 'missing_item' | 'overdue';

export interface TemperatureTask {
  id: string;
  task_no: string;
  waybill_no: string;
  plate_no: string;
  driver_id: string;
  driver_name: string;
  goods_temp_zone: string;
  temp_min: number;
  temp_max: number;
  check_interval_minutes: number;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

export interface TaskStation {
  id: string;
  task_id: string;
  station_index: number;
  station_name: string;
  station_address?: string;
  planned_arrival_time?: string;
  actual_arrival_time?: string;
  status: StationStatus;
  created_at: string;
}

export interface CheckItem {
  id: string;
  task_id: string;
  station_id: string;
  check_scope: CheckScope;
  check_type: CheckType;
  check_name: string;
  required: number;
  sort_order: number;
  status: CheckItemStatus;
  due_time?: string;
  completed_time?: string;
  created_at: string;
}

export interface CheckReport {
  id: string;
  task_id: string;
  station_id: string;
  check_item_id?: string;
  report_source: ReportSource;
  temperature?: number;
  photo_url?: string;
  report_time: string;
  remark?: string;
  is_exception: number;
  exception_type?: string;
  created_at: string;
}

export interface ExceptionRecord {
  id: string;
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
  status: ExceptionStatus;
  handler?: string;
  handle_remark?: string;
  handled_at?: string;
  created_at: string;
}

export interface CreateTaskRequest {
  waybill_no: string;
  plate_no: string;
  driver_id: string;
  driver_name: string;
  goods_temp_zone: string;
  temp_min: number;
  temp_max: number;
  check_interval_minutes: number;
  stations: StationInput[];
}

export interface StationInput {
  station_name: string;
  station_address?: string;
  planned_arrival_time?: string;
}

export interface SubmitReportRequest {
  task_id: string;
  station_id?: string;
  report_source: ReportSource;
  temperature?: number;
  photo_url?: string;
  remark?: string;
  report_time?: string;
  check_type?: CheckType;
  check_item_id?: string;
}

export interface BatchTemperaturePoint {
  temperature: number;
  report_time: string;
  remark?: string;
}

export interface BatchSubmitRequest {
  task_id: string;
  report_source: ReportSource;
  points: BatchTemperaturePoint[];
}

export interface HandleExceptionRequest {
  exception_id: string;
  handler: string;
  handle_remark: string;
  status: ExceptionStatus;
}
