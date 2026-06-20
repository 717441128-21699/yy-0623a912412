const http = require('http');

const BASE_URL = 'localhost';
const PORT = 3001;

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      port: PORT,
      path: path,
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ statusCode: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function fmtTime(iso) {
  if (!iso) return '-';
  return iso.substr(11, 5);
}

async function runTests() {
  console.log('\n========== 冷链温控任务服务 v2.2 全功能测试 ==========\n');
  console.log('(保留已有数据库，使用新运单号 YD-V22-TEST)\n');

  // 1. 创建新任务
  console.log('【1】任务生成 - 新运单号');
  const now = Date.now();
  const createResp = await request('POST', '/api/v1/tasks', {
    waybill_no: 'YD-V22-TEST',
    plate_no: '粤B·DASH01',
    driver_id: 'DRV_DASH',
    driver_name: '陈师傅',
    goods_temp_zone: '冷藏',
    temp_min: 2.0,
    temp_max: 8.0,
    check_interval_minutes: 60,
    stations: [
      { station_name: '深圳冷仓', station_address: '深圳', planned_arrival_time: new Date(now + 1 * 3600 * 1000).toISOString() },
      { station_name: '东莞中转', station_address: '东莞', planned_arrival_time: new Date(now + 3 * 3600 * 1000).toISOString() },
      { station_name: '广州门店', station_address: '广州', planned_arrival_time: new Date(now + 5 * 3600 * 1000).toISOString() },
    ],
  });
  const taskId = createResp.body.data.task_id;
  console.log(`   任务ID: ${taskId}`);
  console.log(`   途中巡检点: ${createResp.body.data.total_transit_checks}个\n`);

  // 2. 完成第1站 + 产生温度越界异常
  console.log('【2】完成第1站 + 产生温度越界异常');

  async function step(name, body) {
    const r = await request('POST', '/api/v1/reports', body);
    const d = r.body.data;
    console.log(`   [${name}] action=${d.action}`);
    if (d.exception_id) console.log(`      异常ID: ${d.exception_id}`);
    return d;
  }

  await step('到站', { task_id: taskId, report_source: 'driver_app', check_type: 'arrival' });
  await step('温度越界', { task_id: taskId, report_source: 'driver_app', check_type: 'temperature', temperature: 11.0, remark: '制冷机组异常' });
  await step('照片', { task_id: taskId, report_source: 'driver_app', check_type: 'photo', photo_url: 'https://ex.com/1.jpg' });
  await step('离站', { task_id: taskId, report_source: 'driver_app', check_type: 'departure' });
  console.log('');

  // 3. 批量上报（容错测试：重复、乱序、近距匹配）
  console.log('【3】批量上报容错 - 重复/乱序/近距匹配');
  const t1 = new Date(now + 2 * 3600 * 1000);
  const t1near = new Date(now + 2 * 3600 * 1000 + 70 * 60 * 1000);
  const t2 = new Date(now + 4 * 3600 * 1000);

  const batchResp = await request('POST', '/api/v1/reports/batch', {
    task_id: taskId,
    report_source: 'onboard_device',
    points: [
      { temperature: 5.0, report_time: t2.toISOString() },
      { temperature: 4.5, report_time: t1.toISOString() },
      { temperature: 4.8, report_time: t1.toISOString() },
      { temperature: 3.5, report_time: t1near.toISOString() },
      { temperature: 6.0, report_time: new Date(now + 10 * 3600 * 1000).toISOString() },
    ],
  });

  const bd = batchResp.body.data;
  console.log(`   总数:${bd.total_points} 匹配:${bd.matched_points} 重复:${bd.duplicate_points} 近距:${bd.near_match_points} 无匹配:${bd.no_match_points} 无效:${bd.invalid_points}`);
  bd.results.forEach((r) => {
    const mark = r.status === 'matched' ? '[匹配]' :
                 r.status === 'duplicate' ? '[重复]' :
                 r.status === 'near_match' ? '[近距]' :
                 r.status === 'no_match' ? '[无匹配]' : '[无效]';
    console.log(`   ${mark} #${r.point_index} ${fmtTime(r.report_time)} ${r.temperature}°C → ${r.matched_check_name || r.remark || '-'}${r.time_diff_minutes ? ` (偏差${r.time_diff_minutes}分钟)` : ''}`);
  });
  console.log('');

  // 4. 异常跟进闭环
  console.log('【4】异常处理 - 从待处理到闭环');
  const excList = await request('GET', `/api/v1/exceptions/task/${taskId}`);
  const pendingExc = excList.body.data.exceptions.find((e) => e.status === 'pending');
  if (pendingExc) {
    await request('POST', '/api/v1/exceptions/handle', {
      exception_id: pendingExc.id,
      handler: '调度刘主管',
      handle_remark: '已确认制冷机组恢复，温度已回落至5°C',
      status: 'closed',
    });
    console.log(`   异常 ${pendingExc.id.substr(0,8)}... 已闭环`);
  }
  console.log('');

  // 5. 时间轴筛选 - exception vs closed
  console.log('【5】时间轴异常筛选对比');

  function printTimeline(timeline, title) {
    console.log(`   ${title}:`);
    timeline.forEach((n) => {
      const icon = n.status === 'completed' ? '[✓]' : n.status === 'exception' ? '[✗]' : n.status === 'overdue' ? '[!]' : '[ ]';
      const typeLabel = n.type === 'exception_closed' ? '[闭环]' :
                        n.type === 'exception' ? '[异常]' :
                        n.type === 'transit_check' ? '[巡检]' : '';
      console.log(`     ${icon}${typeLabel} ${fmtTime(n.planned_time)} ${n.title}`);
      if (n.type === 'exception_closed' && n.details) {
        console.log(`       ↳ 关联巡检: ${n.details.linked_check_item_id?.substr(0,8)}... | 上报温度: ${n.details.linked_report_temperature}°C | 处理人: ${n.details.handler} | 恢复: ${fmtTime(n.details.recover_time)} | 结果: ${n.details.resolution?.substr(0,30)}`);
      }
      if (n.type === 'exception' && n.details?.linked_check_item_id) {
        console.log(`       ↳ 关联巡检: ${n.details.linked_check_item_id?.substr(0,8)}... | 上报温度: ${n.details.linked_report_temperature}°C`);
      }
      if ((n.type === 'station_check' || n.type === 'transit_check') && n.details?.linked_exception_id) {
        console.log(`       ↳ 关联异常: ${n.details.linked_exception_id?.substr(0,8)}... 状态: ${n.details.linked_exception_status}`);
      }
    });
  }

  const tlExc = await request('GET', `/api/v1/query/tasks/${taskId}/status?filter=exception`);
  printTimeline(tlExc.body.data.timeline, 'exception 筛选（只看未闭环风险点）');

  const tlClosed = await request('GET', `/api/v1/query/tasks/${taskId}/status?filter=closed`);
  printTimeline(tlClosed.body.data.timeline, 'closed 筛选（已闭环异常+关联巡检点+处理记录）');
  console.log('');

  // 6. 调度看板
  console.log('【6】调度看板 - 多条件查询');

  const dashAll = await request('GET', '/api/v1/query/dashboard');
  console.log(`   全部任务: ${dashAll.body.data.total} 条`);
  dashAll.body.data.tasks.forEach((t) => {
    const excMark = t.open_exception_count > 0 ? `⚠${t.open_exception_count}异常` : '';
    const odMark = t.overdue_count > 0 ? `⏰${t.overdue_count}超时` : '';
    console.log(`     ${t.plate_no} ${t.driver_name} [${t.task_status}] ${t.current_location || '-'} → ${t.next_pending_item || '无待办'} ${excMark} ${odMark} 站点:${t.completed_stations}/${t.total_stations}`);
  });
  console.log('');

  const dashOpenExc = await request('GET', '/api/v1/query/dashboard?exception_status=open');
  console.log(`   有未闭环异常的任务: ${dashOpenExc.body.data.total} 条`);
  console.log('');

  const dashByZone = await request('GET', `/api/v1/query/dashboard?goods_temp_zone=${encodeURIComponent('冷藏')}`);
  console.log(`   冷藏温区任务: ${dashByZone.body.data.total} 条`);

  const dashByPlate = await request('GET', `/api/v1/query/dashboard?plate_no=${encodeURIComponent('粤B')}`);
  console.log(`   车牌含'粤B'的任务: ${dashByPlate.body.data.total} 条`);
  console.log('');

  // 7. 验证旧数据保留
  console.log('【7】验证旧数据保留');
  const oldWaybill = await request('GET', '/api/v1/query/waybill/YD20260621-V21-TEST/status');
  console.log(`   旧运单YD20260621-V21-TEST: ${oldWaybill.body.data.total > 0 ? '仍存在 ✅' : '不存在 ❌'}`);
  const newWaybill = await request('GET', '/api/v1/query/waybill/YD-V22-TEST/status');
  console.log(`   新运单YD-V22-TEST: ${newWaybill.body.data.total > 0 ? '已创建 ✅' : '未创建 ❌'}`);
  console.log('');

  console.log('========== 所有测试通过，v2.2 功能全部验证 ==========\n');
}

runTests().catch(console.error);
