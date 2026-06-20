import { Router } from 'express';
import * as taskController from '../controllers/taskController';
import * as reportController from '../controllers/reportController';
import * as queryController from '../controllers/queryController';
import { validateCreateTask, validateSubmitReport } from '../middleware/validation';

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'cold-chain-temperature-task-service',
    timestamp: new Date().toISOString(),
  });
});

router.post('/tasks', validateCreateTask, taskController.createTask);
router.get('/tasks/:id', taskController.getTask);
router.get('/tasks/waybill/:waybill_no', taskController.getTasksByWaybill);

router.post('/reports', validateSubmitReport, reportController.submitReport);

router.get('/query/tasks/:id/status', queryController.getTaskStatusById);
router.get('/query/waybill/:waybill_no/status', queryController.getTaskStatusByWaybill);

export default router;
