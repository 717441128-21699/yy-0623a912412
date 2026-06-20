import * as taskDao from '../daos/taskDao';
import { ExceptionRecord, HandleExceptionRequest } from '../types';

export function getExceptionsByTaskId(taskId: string): {
  task_id: string;
  total: number;
  pending: number;
  handling: number;
  closed: number;
  exceptions: ExceptionRecord[];
} | null {
  const task = taskDao.getTaskById(taskId);
  if (!task) return null;

  const exceptions = taskDao.getExceptionsByTaskId(taskId);

  return {
    task_id: taskId,
    total: exceptions.length,
    pending: exceptions.filter((e) => e.status === 'pending').length,
    handling: exceptions.filter((e) => e.status === 'handling').length,
    closed: exceptions.filter((e) => e.status === 'closed').length,
    exceptions,
  };
}

export function getExceptionById(exceptionId: string): ExceptionRecord | undefined {
  return taskDao.getExceptionById(exceptionId);
}

export function handleException(request: HandleExceptionRequest): ExceptionRecord | null {
  const exception = taskDao.handleException(
    request.exception_id,
    request.handler,
    request.handle_remark,
    request.status
  );

  if (!exception) return null;

  if (exception.status === 'closed') {
    const remainingOpen = taskDao
      .getExceptionsByTaskId(exception.task_id)
      .filter((e) => e.status !== 'closed');
    if (remainingOpen.length === 0) {
      const task = taskDao.getTaskById(exception.task_id);
      if (task && task.status === 'exception') {
        const allStations = taskDao.getStationsByTaskId(task.id);
        const allStationItems = taskDao.getStationCheckItemsByTaskId(task.id);
        const allTransitItems = taskDao.getTransitCheckItemsByTaskId(task.id);
        const pendingItems = [...allStationItems, ...allTransitItems].filter(
          (item) => item.required === 1 && item.status === 'pending'
        );
        const stationsDone = allStations.every((s) => s.status === 'completed');
        if (stationsDone && pendingItems.length === 0) {
          taskDao.updateTaskStatus(task.id, 'completed');
        } else {
          taskDao.updateTaskStatus(task.id, 'in_progress');
        }
      }
    }
  }

  return exception;
}
