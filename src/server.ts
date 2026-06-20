import app from './app';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  冷链司机温控任务后端服务                                 ║
║  Cold Chain Temperature Task Service                    ║
╠══════════════════════════════════════════════════════════╣
║  服务地址: http://localhost:${PORT}                         ║
║  API 前缀: /api/v1                                       ║
╠══════════════════════════════════════════════════════════╣
║  1. 任务生成: POST /api/v1/tasks                         ║
║  2. 过程接收: POST /api/v1/reports                       ║
║  3. 状态查询: GET  /api/v1/query/waybill/:no/status      ║
║  健康检查: GET  /api/v1/health                           ║
╚══════════════════════════════════════════════════════════╝
  `);
});
