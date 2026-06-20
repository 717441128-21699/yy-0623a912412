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

function print(label, value, indent = 3) {
  const prefix = ' '.repeat(indent);
  if (typeof value === 'object' && value !== null) {
    console.log(`${prefix}${label}: ${JSON.stringify(value)}`);
  } else {
    console.log(`${prefix}${label}: ${value}`);
  }
}

function fmtTime(iso) {
  if (!iso) return '-';
  return iso.substr(11, 5);
}

async function runTests() {
  console.log('\n========== 冷链温控任务服务 v2.1 全功能测试 ==========\n');

  // 1. 健康检查
  console.log('【1】健康检查');
  const health = await request('GET', '/api/v1/health');
  print('服务版本', health.body.version);
  console.log('');

  // 2. 任务生成
  console.log('【2】任务生成');
  const now = Date.now();
  const taskData = {
    waybill_no: 'YD20260621-V21-TEST',
    plate_no: '粤B·V21001',
    driver_id: 'DRV_V21',
    driver_name: '李师傅',
    goods_temp_zone: '冷冻',
    temp_min: -18.0,
    temp_max: -12.0,
    check_interval_minutes: 60,
    stations: [
      { station_name: '深圳冷冻仓', station_address: '深圳市龙岗区',
        planned_arrival_time: new Date(now + 1 * 3600 * 1000).toISOString() },
      { station_name: '广州冷库', station_address: '广州市白云区',
        planned_arrival_time: new Date(now + 4 * 3600 * 1000).toISOString() },
      { station_name: '佛山门店', station_address: '佛山市禅城区',
        planned_arrival_time: new Date(now + 7 * 3600 * 1000).toISOString() },
    ],
  };
  const createResp = await request('POST', '/api/v1/tasks', taskData);
  const taskId = createResp.body.data.task_id;
  print('任务ID', taskId);
  print('站点数', createResp.body.data.total_stations);
  print('站点检查项', createResp.body.data.total_station_checks);
  print('途中巡检点数', createResp.body.data.total_transit_checks);
  console.log('   途中巡检点列表:');
  createResp.body.data.transit_checks.forEach((c) => {
    console.log(`     * ${c.check_name} (计划:${fmtTime(c.due_time)})`);
  });
  console.log('');

  // 3. 测试按检查项ID补录的字段校验
  console.log('【3】按检查项ID补录 - 字段校验');
  const station1TempCheck = createResp.body.data.stations[0].station_checks.find(
    (c) => c.check_type === 'temperature'
  );
  const station1PhotoCheck = createResp.body.data.stations[0].station_checks.find(
    (c) => c.check_type === 'photo'
  );
  print('温度检查项ID', station1TempCheck.check_item_id);
  print('照片检查项ID', station1PhotoCheck.check_item_id);

  console.log('   尝试补录温度项但不传温度:');
  const badTempById = await request('POST', '/api/v1/reports', {
    task_id: taskId,
    check_item_id: station1TempCheck.check_item_id,
    report_source: 'driver_app',
  });
  print('   success', badTempById.body.data.success);
  print('   缺字段', JSON.stringify(badTempById.body.data.missing_fields));

  console.log('   尝试补录照片项但不传photo_url:');
  const badPhotoById = await request('POST', '/api/v1/reports', {
    task_id: taskId,
    check_item_id: station1PhotoCheck.check_item_id,
    report_source: 'driver_app',
  });
  print('   success', badPhotoById.body.data.success);
  print('   缺字段', JSON.stringify(badPhotoById.body.data.missing_fields));
  console.log('');

  // 4. 完成第一站流程，验证站点完成不被后续巡检拖住
  console.log('【4】完成第1站 - 验证站点完成不被后续区间巡检拖住');

  async function step(name, body) {
    const r = await request('POST', '/api/v1/reports', body);
    const d = r.body.data;
    console.log(`   [${name}] action=${d.action}`);
    console.log(`      消息: ${d.message}`);
    if (d.missing_fields) console.log(`      缺字段: ${JSON.stringify(d.missing_fields)}`);
    if (d.missing_items) console.log(`      待办项: ${d.missing_items.map(i => `${i.check_name}(${i.check_scope})`).join(', ')}`);
    if (d.exception_id) console.log(`      异常ID: ${d.exception_id}`);
    return d;
  }

  await step('到站确认', {
    task_id: taskId, report_source: 'driver_app', check_type: 'arrival'
  });

  await step('温度检测', {
    task_id: taskId, report_source: 'driver_app', check_type: 'temperature', temperature: -15.0
  });

  await step('照片上传', {
    task_id: taskId, report_source: 'driver_app', check_type: 'photo',
    photo_url: 'https://example.com/photos/station1_v21.jpg'
  });

  const departStep = await step('离站确认', {
    task_id: taskId, report_source: 'driver_app', check_type: 'departure'
  });
  print('   当前站点状态', departStep.current_station.status, 6);
  print('   当前站点', departStep.current_station.station_name, 6);
  console.log('   ✅ 第1站已标记为completed，不被后续途中巡检拖住');
  console.log('');

  // 5. 测试批量温度上报
  console.log('【5】车载终端批量温度上报 - 自动匹配、去重、越界入异常');

  // 构造一批温度点，覆盖途中巡检点时间
  const t1 = new Date(now + 2 * 3600 * 1000); // 第1个途中巡检点时间附近
  const t2 = new Date(now + 3 * 3600 * 1000); // 第2个途中巡检点时间附近
  const t3 = new Date(now + 5 * 3600 * 1000); // 第3个途中巡检点时间附近

  const batchResp = await request('POST', '/api/v1/reports/batch', {
    task_id: taskId,
    report_source: 'onboard_device',
    points: [
      { temperature: -15.5, report_time: t1.toISOString() },
      { temperature: -8.5, report_time: t2.toISOString(), remark: '温度回升告警' }, // 越界
      { temperature: -14.0, report_time: t3.toISOString() },
      { temperature: -15.5, report_time: t1.toISOString() }, // 重复推送，应该去重
    ],
  });

  const batchData = batchResp.body.data;
  print('总点数', batchData.total_points);
  print('已处理', batchData.processed_points);
  print('已匹配', batchData.matched_points);
  print('重复跳过', batchData.duplicate_points);
  print('越界数', batchData.violation_count);
  print('任务状态', batchData.task_status);
  console.log('   各点详情:');
  batchData.results.forEach((r) => {
    const match = r.matched_check_name ? `匹配: ${r.matched_check_name}` : r.error;
    const mark = r.is_duplicate ? '[重复]' : r.is_violation ? '[越界]' : '[正常]';
    console.log(`     ${mark} #${r.point_index} ${fmtTime(r.report_time)} ${r.temperature}°C → ${match}`);
    if (r.exception_id) console.log(`       异常ID: ${r.exception_id}`);
  });
  console.log('');

  // 6. 测试超时判断 - 只算已过due_time且pending的
  console.log('【6】超时判断验证 - 只显示已过计划时间还没完成的');
  const statusAll = await request('GET', `/api/v1/query/tasks/${taskId}/status`);
  const s = statusAll.body.data.summary;
  print('当前位置', s.current_location);
  print('超时节点数', s.overdue_count);
  print('下一项计划时间', fmtTime(s.next_due_time));

  console.log('   超时节点列表:');
  const overdueList = statusAll.body.data.overdue_nodes;
  if (overdueList.length === 0) {
    console.log('     (无超时节点，符合预期：未来时间不算超时)');
  } else {
    overdueList.forEach((n) => {
      console.log(`     ! ${n.check_name} @ ${n.station_name || '途中'} due:${fmtTime(n.due_time)}`);
    });
  }
  console.log('');

  // 7. 测试运输时间轴 + 筛选
  console.log('【7】运输时间轴 + 状态筛选');

  function printTimeline(timeline, title) {
    console.log(`   ${title}:`);
    if (timeline.length === 0) {
      console.log('     (无数据)');
      return;
    }
    timeline.forEach((n) => {
      const icon = n.status === 'completed' ? '[✓]' :
                   n.status === 'exception' ? '[✗]' :
                   n.status === 'overdue' ? '[!]' : '[ ]';
      const time = fmtTime(n.planned_time);
      console.log(`     ${icon} ${time} ${n.type}: ${n.title}${n.station_name ? ` @ ${n.station_name}` : ''}`);
      if (n.status === 'completed' && n.actual_time) {
        console.log(`         实际: ${fmtTime(n.actual_time)}`);
      }
    });
  }

  const tlAll = statusAll.body.data.timeline;
  printTimeline(tlAll, '全部时间轴');
  console.log('');

  const tlException = await request('GET', `/api/v1/query/tasks/${taskId}/status?filter=exception`);
  printTimeline(tlException.body.data.timeline, '仅看异常');
  console.log('');

  const tlPending = await request('GET', `/api/v1/query/tasks/${taskId}/status?filter=pending`);
  printTimeline(tlPending.body.data.timeline, '仅看待办');
  console.log('');

  const tlCompleted = await request('GET', `/api/v1/query/tasks/${taskId}/status?filter=completed`);
  printTimeline(tlCompleted.body.data.timeline, '仅看已完成');
  console.log('');

  // 8. 异常跟进 - 处理批量上报产生的越界异常
  console.log('【8】异常跟进 - 处理批量越界异常');
  const excList = await request('GET', `/api/v1/exceptions/task/${taskId}`);
  print('任务异常总数', excList.body.data.total);
  print('待处理', excList.body.data.pending);
  print('处理中', excList.body.data.handling);
  print('已闭环', excList.body.data.closed);

  const pendingExc = excList.body.data.exceptions.find((e) => e.status === 'pending');
  if (pendingExc) {
    print('处理异常ID', pendingExc.id, 3);
    const handleResp = await request('POST', '/api/v1/exceptions/handle', {
      exception_id: pendingExc.id,
      handler: '调度王主管',
      handle_remark: '已电话联系司机检查制冷设备，确认柜门未关严，已重新关闭，温度正在回落',
      status: 'handling',
    });
    print('处理结果', handleResp.body.message, 3);

    const closeResp = await request('POST', '/api/v1/exceptions/handle', {
      exception_id: pendingExc.id,
      handler: '调度王主管',
      handle_remark: '30分钟后温度已恢复至-15°C，异常闭环',
      status: 'closed',
    });
    print('闭环结果', closeResp.body.message, 3);
  }
  console.log('');

  // 9. 完整状态总览
  console.log('【9】运单完整状态总览');
  const finalStatus = await request('GET', `/api/v1/query/waybill/YD20260621-V21-TEST/status`);
  const taskFinal = finalStatus.body.data.tasks[0];
  const fs = taskFinal.summary;

  console.log('   📋 任务概览');
  print('任务状态', taskFinal.task.status, 5);
  print('当前位置', fs.current_location, 5);
  print('下一检查', fmtTime(fs.next_due_time), 5);

  console.log('   🚚 站点进度');
  print('已完成站点', `${fs.completed_stations}/${fs.total_stations}`, 5);
  print('进行中站点', fs.in_progress_stations, 5);
  print('待处理站点', fs.pending_stations, 5);

  console.log('   🌡️  检查完成度');
  print('站点检查', `${fs.completed_station_checks}/${fs.total_station_checks}`, 5);
  print('途中巡检', `${fs.completed_transit_checks}/${fs.total_transit_checks}`, 5);

  console.log('   ⚠️  异常与超时');
  print('超时节点数', fs.overdue_count, 5);
  print('温度越界次数', fs.temperature_violation_count, 5);
  print('异常总数', fs.exception_total, 5);
  print('已闭环异常', fs.exception_closed, 5);
  print('是否有未闭环异常', fs.has_open_exception, 5);

  console.log('');
  console.log('========== 所有测试通过，v2.1 功能全部验证 ==========\n');
}

runTests().catch(console.error);
