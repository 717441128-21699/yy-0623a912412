import { Router } from 'express';
import * as taskController from '../controllers/taskController';
import * as reportController from '../controllers/reportController';
import * as queryController from '../controllers/queryController';
import * as exceptionController from '../controllers/exceptionController';
import * as batchController from '../controllers/batchController';
import { validateCreateTask, validateSubmitReport, validateHandleException, validateBatchReport } from '../middleware/validation';

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'cold-chain-temperature-task-service',
    version: '2.1',
    timestamp: new Date().toISOString(),
  });
});

router.post('/tasks', validateCreateTask, taskController.createTask);
router.get('/tasks/:id', taskController.getTask);
router.get('/tasks/waybill/:waybill_no', taskController.getTasksByWaybill);

router.post('/reports', validateSubmitReport, reportController.submitReport);
router.post('/reports/batch', validateBatchReport, batchController.submitBatchReport);

router.get('/query/tasks/:id/status', queryController.getTaskStatusById);
router.get('/query/waybill/:waybill_no/status', queryController.getTaskStatusByWaybill);

router.get('/exceptions/task/:task_id', exceptionController.getTaskExceptions);
router.get('/exceptions/:id', exceptionController.getExceptionDetail);
router.post('/exceptions/handle', validateHandleException, exceptionController.handleException);

export default router;
