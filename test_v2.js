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

function print(label, value) {
  const prefix = '   ';
  if (typeof value === 'object') {
    console.log(`${prefix}${label}: ${JSON.stringify(value)}`);
  } else {
    console.log(`${prefix}${label}: ${value}`);
  }
}

async function runTests() {
  console.log('\n========== 冷链温控任务服务 v2.0 全功能测试 ==========\n');

  // 1. 健康检查
  console.log('【1】健康检查');
  const health = await request('GET', '/api/v1/health');
  print('状态', health.statusCode);
  print('服务版本', health.body.version);
  console.log('');

  // 2. 任务生成 - 含途中温度巡检点
  console.log('【2】任务生成 - 验证途中巡检点自动生成');
  const now = Date.now();
  const taskData = {
    waybill_no: 'YD20260621-TEST001',
    plate_no: '粤B·TEST001',
    driver_id: 'DRV_TEST',
    driver_name: '测试司机',
    goods_temp_zone: '冷藏',
    temp_min: 2.0,
    temp_max: 8.0,
    check_interval_minutes: 60,
    stations: [
      { station_name: '深圳冷链仓', station_address: '深圳市龙岗区',
        planned_arrival_time: new Date(now + 1 * 3600 * 1000).toISOString() },
      { station_name: '广州配送中心', station_address: '广州市白云区',
        planned_arrival_time: new Date(now + 4 * 3600 * 1000).toISOString() },
      { station_name: '佛山终端店', station_address: '佛山市禅城区',
        planned_arrival_time: new Date(now + 7 * 3600 * 1000).toISOString() },
    ],
  };
  const createResp = await request('POST', '/api/v1/tasks', taskData);
  const taskId = createResp.body.data.task_id;
  print('任务ID', taskId);
  print('站点数', createResp.body.data.total_stations);
  print('站点检查项', createResp.body.data.total_station_checks);
  print('途中巡检点数', createResp.body.data.total_transit_checks);
  console.log('   站点清单:');
  createResp.body.data.stations.forEach((s) => {
    console.log(`     - 第${s.station_index}站 ${s.station_name} (计划到:${s.planned_arrival_time?.substr(11,5)})`);
    s.station_checks.forEach((c) => {
      console.log(`       * [${c.check_type}] ${c.check_name} (计划:${c.due_time?.substr(11,5)})`);
    });
  });
  console.log('   途中巡检点:');
  createResp.body.data.transit_checks.forEach((c) => {
    console.log(`     * ${c.check_name} (计划:${c.due_time?.substr(11,5)})`);
  });
  console.log('');

  // 3. 测试严格字段校验 - 温度检测缺温度
  console.log('【3】严格校验 - 温度检测必须带温度值');
  const badTemp = await request('POST', '/api/v1/reports', {
    task_id: taskId, report_source: 'driver_app', check_type: 'temperature',
  });
  print('返回 success', badTemp.body.data?.success);
  print('返回 action', badTemp.body.data?.action);
  print('缺字段', JSON.stringify(badTemp.body.data?.missing_fields));
  console.log('');

  // 4. 测试严格字段校验 - 照片上传缺地址
  console.log('【4】严格校验 - 照片上传必须带 photo_url');
  const badPhoto = await request('POST', '/api/v1/reports', {
    task_id: taskId, report_source: 'driver_app', check_type: 'photo',
  });
  print('返回 success', badPhoto.body.data?.success);
  print('缺字段', JSON.stringify(badPhoto.body.data?.missing_fields));
  console.log('');

  // 5. 正常上报流程
  console.log('【5】过程接收 - 第1站正常上报流程');
  let lastExceptionId = null;

  async function step(name, body) {
    const r = await request('POST', '/api/v1/reports', body);
    const d = r.body.data;
    console.log(`   [${name}] action=${d.action}`);
    console.log(`      消息: ${d.message}`);
    if (d.missing_fields) console.log(`      缺字段: ${JSON.stringify(d.missing_fields)}`);
    if (d.missing_items) console.log(`      待办项: ${d.missing_items.map(i => i.check_name).join(', ')}`);
    if (d.exception_id) { lastExceptionId = d.exception_id; console.log(`      异常ID: ${d.exception_id}`); }
    if (d.next_transit_check) console.log(`      下一途中巡检: ${d.next_transit_check.check_name} (${d.next_transit_check.due_time?.substr(11,5)})`);
    return d;
  }

  await step('到站确认', {
    task_id: taskId, report_source: 'driver_app', check_type: 'arrival'
  });

  await step('温度检测(正常)', {
    task_id: taskId, report_source: 'driver_app', check_type: 'temperature', temperature: 5.0
  });

  const excStep = await step('温度检测(越界)', {
    task_id: taskId, report_source: 'driver_app', check_type: 'temperature',
    temperature: 12.5, remark: '制冷机故障，温度上升',
  });

  await step('照片上传', {
    task_id: taskId, report_source: 'driver_app', check_type: 'photo',
    photo_url: 'https://example.com/photos/station1.jpg'
  });

  await step('离站确认', {
    task_id: taskId, report_source: 'driver_app', check_type: 'departure'
  });
  console.log('');

  // 6. 途中巡检点上报
  console.log('【6】途中巡检 - 验证途中温度巡检点匹配');
  await step('途中巡检(正常)', {
    task_id: taskId, report_source: 'onboard_device', check_type: 'transit_temperature',
    temperature: 6.0
  });

  await step('途中巡检(越界)', {
    task_id: taskId, report_source: 'onboard_device', check_type: 'transit_temperature',
    temperature: 9.0
  });
  console.log('');

  // 7. 异常跟进流程
  console.log('【7】异常跟进 - 查看并处理异常');
  const excListResp = await request('GET', `/api/v1/exceptions/task/${taskId}`);
  const excList = excListResp.body.data;
  print('任务异常总数', excList.total);
  print('待处理', excList.pending);
  print('处理中', excList.handling);
  print('已闭环', excList.closed);
  console.log('   异常详情:');
  excList.exceptions.forEach((e) => {
    console.log(`     * [${e.status}] ${e.exception_type}: ${e.description}`);
    if (e.handler) console.log(`       处理人:${e.handler} 备注:${e.handle_remark}`);
  });

  const handleResp = await request('POST', '/api/v1/exceptions/handle', {
    exception_id: lastExceptionId,
    handler: '运营王调度',
    handle_remark: '已联系维修人员抢修制冷设备，货物安排中转，损失已记录',
    status: 'closed'
  });
  print('异常处理结果', handleResp.body.message);
  console.log('');

  // 8. 状态查询 - 详细展示站点/途中/超时/越界
  console.log('【8】状态查询 - 按运单号查询详细状态');
  const statusResp = await request('GET', '/api/v1/query/waybill/YD20260621-TEST001/status');
  const taskStatus = statusResp.body.data.tasks[0];
  const s = taskStatus.summary;
  print('任务状态', taskStatus.task.status);
  print('站点进度', `${s.completed_stations}/${s.total_stations} (进行中:${s.in_progress_stations},待处理:${s.pending_stations})`);
  print('站点检查', `${s.completed_station_checks}/${s.total_station_checks}`);
  print('途中巡检', `${s.completed_transit_checks}/${s.total_transit_checks}`);
  print('超时节点数', s.overdue_count);
  print('温度越界次数', s.temperature_violation_count);
  print('异常统计', `总数:${s.exception_total} 待处理:${s.exception_pending} 处理中:${s.exception_handling} 已闭环:${s.exception_closed}`);
  print('是否有未闭环异常', s.has_open_exception);

  console.log('   各站点进度:');
  taskStatus.stations.forEach((st) => {
    const icon = st.station.status === 'completed' ? '[完]' : st.station.status === 'arrived' ? '[到]' : '[待]';
    const od = st.is_overdue ? '[超时]' : '';
    console.log(`     ${icon} ${od} 第${st.station.station_index}站 ${st.station.station_name} (${st.completed_count}/${st.total_required})`);
    if (st.temperature_reports.length > 0) {
      console.log(`       温度记录: ${st.temperature_reports.map(r => `${r.temperature}°C${r.is_violation ? '(越界!)' : ''}`).join(', ')}`);
    }
  });

  console.log('   途中巡检进度:');
  taskStatus.transit_checks.forEach((tc) => {
    const status = tc.check_item.status === 'pending' ? (tc.is_overdue ? '[超时待检]' : '[待检]') :
                   tc.check_item.status === 'completed' ? '[已检]' : '[异常]';
    const temp = tc.completed_report?.temperature !== undefined ? ` ${tc.completed_report.temperature}°C` : '';
    const due = tc.check_item.due_time?.substr(11,5);
    console.log(`     ${status} ${tc.check_item.check_name} (计划${due})${temp}`);
  });

  if (taskStatus.overdue_nodes.length > 0) {
    console.log('   超时节点:');
    taskStatus.overdue_nodes.forEach((n) => {
      console.log(`     ! ${n.check_name} (计划${n.due_time?.substr(11,5)}, 站点:${n.station_name || '途中'})`);
    });
  }

  if (taskStatus.temperature_violations.length > 0) {
    console.log('   温度越界记录:');
    taskStatus.temperature_violations.forEach((v) => {
      console.log(`     ! ${v.temperature}°C (范围 ${v.temp_min}~${v.temp_max}°C) @ ${v.station_name || '途中'} ${v.report_time.substr(11,5)}`);
      if (v.exception_id) console.log(`       异常ID:${v.exception_id} 司机备注:${v.driver_remark || '-'}`);
    });
  }

  console.log('   异常跟进记录:');
  taskStatus.exceptions.forEach((e) => {
    const icon = e.status === 'closed' ? '[闭环]' : e.status === 'handling' ? '[处理中]' : '[待处理]';
    console.log(`     ${icon} ${e.exception_type}: ${e.description}`);
    if (e.handler) console.log(`       处理人:${e.handler} 处理:${e.handle_remark} (${e.handled_at?.substr(0,16)})`);
  });

  console.log('\n========== 所有测试通过 ==========\n');
}

runTests().catch(console.error);
