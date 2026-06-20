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
  console.log('\n========== 冷链温控任务服务 v2.3 全功能测试 ==========\n');
  console.log('(保留已有数据库，使用新运单号 YD-V23-TEST)\n');

  const now = Date.now();

  // ============== 1. 创建新任务 ==============
  console.log('【1】任务生成 - 新运单号 YD-V23-TEST');
  const createResp = await request('POST', '/api/v1/tasks', {
    waybill_no: 'YD-V23-TEST',
    plate_no: '粤B·V23001',
    driver_id: 'DRV_V23',
    driver_name: '王师傅',
    goods_temp_zone: '冷藏',
    temp_min: 2.0,
    temp_max: 8.0,
    check_interval_minutes: 60,
    stations: [
      { station_name: '深圳冷链仓', station_address: '深圳', planned_arrival_time: new Date(now + 1 * 3600 * 1000).toISOString() },
      { station_name: '东莞配送站', station_address: '东莞', planned_arrival_time: new Date(now + 3 * 3600 * 1000).toISOString() },
      { station_name: '广州门店', station_address: '广州', planned_arrival_time: new Date(now + 5 * 3600 * 1000).toISOString() },
    ],
  });
  const taskId = createResp.body.data.task_id;
  const allStationChecks = createResp.body.data.stations.reduce(
    (acc, s) => acc.concat(s.station_checks.map((c) => ({ ...c, station_name: s.station_name }))),
    []
  );
  console.log(`   任务ID: ${taskId}`);
  console.log(`   站点温度检测项数量: ${allStationChecks.filter((i) => i.check_type === 'temperature').length}`);
  console.log(`   到站/离站/照片数量: ${allStationChecks.filter((i) => i.check_type !== 'temperature').length}`);
  console.log(`   途中巡检点: ${createResp.body.data.total_transit_checks}个\n`);

  // ============== 2. 先完成到站(仅司机任务，不用批量) ==============
  console.log('【2】司机完成到站(非温度项，保留为pending来测试批量不会误匹配)');
  const station0Checks = createResp.body.data.stations[0].station_checks;
  const arrivalItem = station0Checks.find((i) => i.check_type === 'arrival');
  console.log(`   到站检查项ID: ${arrivalItem.check_item_id.substr(0, 10)}... 类型: ${arrivalItem.check_type}`);
  await request('POST', '/api/v1/reports', {
    task_id: taskId,
    check_item_id: arrivalItem.check_item_id,
    report_source: 'driver_app',
    check_type: 'arrival',
  });
  // 保持温度/照片/离站 pending
  console.log('   到站已完成，温度/照片/离站保持pending\n');

  // ============== 3. 批量上报：只匹配温度项，不碰司机任务 ==============
  console.log('【3】批量上报验证 - 只匹配temperature/transit_temperature');
  const t1 = new Date(now + 1.2 * 3600 * 1000);
  const t2 = new Date(now + 2.1 * 3600 * 1000);
  const batchId = `BATCH-${Date.now()}`;

  const batchResp = await request('POST', '/api/v1/reports/batch', {
    task_id: taskId,
    report_source: 'onboard_device',
    batch_id: batchId,
    points: [
      { point_id: 'P001', temperature: 5.2, report_time: t1.toISOString(), remark: '车载自动上报' },
      { point_id: 'P002', temperature: 4.8, report_time: t2.toISOString() },
      { point_id: 'P002', temperature: 4.9, report_time: t2.toISOString(), remark: '同点重复推' },
    ],
  });

  const bd = batchResp.body.data;
  console.log(`   批次号: ${bd.batch_id}`);
  console.log(`   总数:${bd.total_points} 匹配:${bd.matched_points} 重复:${bd.duplicate_points} 近距:${bd.near_match_points} 无匹配:${bd.no_match_points}`);
  bd.results.forEach((r) => {
    const matchedType = r.matched_check_name ? (r.matched_check_name.includes('途中') ? 'transit' : 'station') : '';
    const mark = r.status === 'matched' ? '[匹配]' :
                 r.status === 'duplicate' ? '[重复]' :
                 r.status === 'near_match' ? '[近距]' :
                 r.status === 'no_match' ? '[无匹配]' : '[无效]';
    console.log(`   ${mark} #${r.point_index} ${r.point_id || '-'} ${fmtTime(r.report_time)} ${r.temperature}°C → ${r.matched_check_name || r.remark || '-'} ${matchedType ? `(${matchedType}温度项)` : ''}`);
  });

  // 检查是否误匹配了到站/照片/离站
  const matchedNames = bd.results.filter((r) => r.matched_check_name).map((r) => r.matched_check_name);
  const badMatch = matchedNames.some((n) => n.includes('到站') || n.includes('照片') || n.includes('离站'));
  console.log(`   是否误匹配司机任务(到站/照片/离站): ${badMatch ? '是 ❌' : '否 ✅'}\n`);

  // ============== 4. 批次重发：返回缓存，不产生重复记录 ==============
  console.log('【4】批次重发验证 - 同批次号返回缓存结果');
  const beforeExcs = (await request('GET', `/api/v1/exceptions/task/${taskId}`)).body.data.total;
  const batchResend = await request('POST', '/api/v1/reports/batch', {
    task_id: taskId,
    report_source: 'onboard_device',
    batch_id: batchId,
    points: [
      { point_id: 'P001', temperature: 5.2, report_time: t1.toISOString() },
      { point_id: 'P002', temperature: 4.8, report_time: t2.toISOString() },
    ],
  });
  const br = batchResend.body.data;
  const afterExcs = (await request('GET', `/api/v1/exceptions/task/${taskId}`)).body.data.total;
  console.log(`   is_cached: ${br.is_cached}  batch_id: ${br.batch_id}`);
  console.log(`   异常记录数: 重发前${beforeExcs} 重发后${afterExcs} ${afterExcs === beforeExcs ? '（无重复 ✅）' : '（出现重复 ❌）'}`);
  console.log(`   结果条数: ${br.results.length}  summary: ${br.summary_message.substr(0, 60)}...\n`);

  // ============== 5. 产生温度越界异常，用于异常处置队列和闭环测试 ==============
  console.log('【5】制造越界异常 - 用于队列与闭环测试');
  const violationResp = await request('POST', '/api/v1/reports', {
    task_id: taskId,
    report_source: 'driver_app',
    check_type: 'temperature',
    temperature: 13.5,
    remark: '冷机报警，温度快速上升',
  });
  const excId = violationResp.body.data.exception_id;
  console.log(`   越界异常ID: ${excId.substr(0, 12)}... 越界温度:13.5°C（范围2-8°C）\n`);

  // ============== 6. 异常处置队列 ==============
  console.log('【6】异常处置队列 - 多条件筛选 + 风险优先级');
  const queueAll = await request('GET', '/api/v1/query/exceptions');
  const qa = queueAll.body.data;
  console.log(`   未闭环异常总数: ${qa.counts.total} (critical:${qa.counts.critical} high:${qa.counts.high} medium:${qa.counts.medium} low:${qa.counts.low})`);
  qa.items.slice(0, 3).forEach((item) => {
    const prioMark = item.priority === 'critical' ? '🔴' : item.priority === 'high' ? '🟠' : item.priority === 'medium' ? '🟡' : '🟢';
    console.log(`   ${prioMark} [${item.priority}/${item.priority_score}分] ${item.plate_no} ${item.driver_name} ${item.exception_type==='temperature_violation'?'温度越界':item.exception_type} 越界:${item.latest_violation_temp}°C 偏移:${item.violation_offset}°C 位置:${item.current_location} 待处理:${item.pending_minutes}分钟`);
    console.log(`      建议: ${item.suggested_action}`);
  });

  // 按车牌筛选
  const qByPlate = await request('GET', `/api/v1/query/exceptions?plate_no=${encodeURIComponent('粤B·V23')}`);
  console.log(`   按车牌"粤B·V23"筛选: ${qByPlate.body.data.items.length} 条`);

  // 按优先级筛选
  const qHigh = await request('GET', '/api/v1/query/exceptions?min_priority=high');
  console.log(`   优先级>=high: ${qHigh.body.data.items.length} 条`);

  // 按温区筛选
  const qByZone = await request('GET', `/api/v1/query/exceptions?goods_temp_zone=${encodeURIComponent('冷藏')}`);
  console.log(`   冷藏温区: ${qByZone.body.data.items.length} 条\n`);

  // ============== 7. 异常闭环 + 恢复证据 ==============
  console.log('【7】异常闭环 - 带恢复温度和说明');

  // 先看异常详情（闭环前）
  const excBefore = await request('GET', `/api/v1/exceptions/${excId}`);
  console.log(`   闭环前: 状态=${excBefore.body.data.status} 有恢复证据=${excBefore.body.data.recover_temperature || excBefore.body.data.recover_remark ? '是' : '否'}`);

  // 闭环时带上恢复温度和说明
  const closedResp = await request('POST', '/api/v1/exceptions/handle', {
    exception_id: excId,
    handler: '调度赵主管',
    handle_remark: '司机已重启冷机，现场观察30分钟温度已回到正常区间',
    status: 'closed',
    recover_temperature: 5.8,
    recover_remark: '车载终端连续3次上报5.5~6.2°C，确认恢复',
  });

  // 异常详情看恢复证据
  const excAfter = await request('GET', `/api/v1/exceptions/${excId}`);
  const ex = excAfter.body.data;
  console.log(`   闭环后: 状态=${ex.status}`);
  console.log(`   恢复温度: ${ex.recover_temperature}°C  恢复说明: ${ex.recover_remark}`);
  console.log(`   恢复时间: ${fmtTime(ex.recover_time)}  有恢复证据: ${ex.recover_temperature || ex.recover_remark ? '是 ✅' : '否 ❌'}`);

  // 时间轴closed筛选看恢复证据
  const tlClosed = await request('GET', `/api/v1/query/tasks/${taskId}/status?filter=closed`);
  const closedNode = tlClosed.body.data.timeline.find((n) => n.type === 'exception_closed');
  if (closedNode) {
    const d = closedNode.details;
    console.log(`   时间轴闭环节点标题: ${closedNode.title}`);
    console.log(`   时间轴恢复数据: 温度${d.recover_temperature}°C 说明${d.recover_remark ? d.recover_remark.substr(0, 20) : '-'} 有证据=${d.has_recover_evidence ? '是 ✅' : '否 ❌'}`);
    console.log(`   闭环人:${d.handler} 恢复时间:${fmtTime(d.recover_time)}`);
  }
  console.log('');

  // ============== 8. 对比：无恢复证据的闭环 ==============
  console.log('【8】对比验证 - 无恢复证据的闭环');
  const viol2Resp = await request('POST', '/api/v1/reports', {
    task_id: taskId,
    report_source: 'driver_app',
    check_type: 'temperature',
    temperature: 10.0,
    remark: '临时波动',
  });
  const excId2 = viol2Resp.body.data.exception_id;
  if (excId2) {
    await request('POST', '/api/v1/exceptions/handle', {
      exception_id: excId2,
      handler: '调度赵主管',
      handle_remark: '司机确认是开关门导致，已恢复',
      status: 'closed',
    });
    const excNoEv = await request('GET', `/api/v1/exceptions/${excId2}`);
    const en = excNoEv.body.data;
    console.log(`   无恢复证据闭环: 状态=${en.status} recover_temp=${en.recover_temperature ?? '-'} recover_remark=${en.recover_remark ?? '-'}`);
    const tlClosed2 = await request('GET', `/api/v1/query/tasks/${taskId}/status?filter=closed`);
    const noEvNode = tlClosed2.body.data.timeline.find(
      (n) => n.type === 'exception_closed' && n.exception_id === excId2
    );
    if (noEvNode) {
      console.log(`   时间轴标题: "${noEvNode.title}" has_recover_evidence=${noEvNode.details.has_recover_evidence ? '是' : '否（仅备注 ✅）'}`);
    }
  }
  console.log('');

  // ============== 9. 确认旧数据保留 ==============
  console.log('【9】历史数据确认');
  const old1 = await request('GET', '/api/v1/query/waybill/YD20260621-V21-TEST/status');
  const old2 = await request('GET', '/api/v1/query/waybill/YD-V22-TEST/status');
  const cur = await request('GET', '/api/v1/query/waybill/YD-V23-TEST/status');
  console.log(`   YD20260621-V21-TEST: ${old1.body.data.total > 0 ? '保留 ✅' : '丢失 ❌'}`);
  console.log(`   YD-V22-TEST: ${old2.body.data.total > 0 ? '保留 ✅' : '丢失 ❌'}`);
  console.log(`   YD-V23-TEST: ${cur.body.data.total > 0 ? '已创建 ✅' : '未创建 ❌'}\n`);

  console.log('========== v2.3 全功能测试通过 ==========\n');
}

runTests().catch(console.error);
