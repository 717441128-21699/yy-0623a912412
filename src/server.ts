import app from './app';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  冷链司机温控任务后端服务 v2.0                           ║
║  Cold Chain Temperature Task Service                    ║
╠══════════════════════════════════════════════════════════╣
║  服务地址: http://localhost:${PORT}                         ║
║  API 前缀: /api/v1                                       ║
╠══════════════════════════════════════════════════════════╣
║  [1] 任务生成    POST   /api/v1/tasks                    ║
║  [2] 过程接收    POST   /api/v1/reports                  ║
║  [3] 状态查询    GET    /api/v1/query/tasks/:id/status   ║
║      状态查询    GET    /api/v1/query/waybill/:no/status ║
║  [4] 异常列表    GET    /api/v1/exceptions/task/:task_id ║
║      异常详情    GET    /api/v1/exceptions/:id           ║
║      异常处理    POST   /api/v1/exceptions/handle        ║
║  健康检查       GET    /api/v1/health                    ║
╚══════════════════════════════════════════════════════════╝
  `);
});
