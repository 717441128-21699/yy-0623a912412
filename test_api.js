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
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(data),
          });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('========== 冷链温控任务服务接口测试 ==========\n');

  // 1. 健康检查
  console.log('【1】健康检查');
  const health = await request('GET', '/api/v1/health');
  console.log('   状态:', health.statusCode);
  console.log('   结果:', JSON.stringify(health.body), '\n');

  // 2. 创建任务
  console.log('【2】任务生成 - 创建温控任务');
  const taskData = {
    waybill_no: 'YD202606210001',
    plate_no: '粤B·A12345',
    driver_id: 'DRV001',
    driver_name: '张师傅',
    goods_temp_zone: '冷藏',
    temp_min: 2.0,
    temp_max: 8.0,
    check_interval_minutes: 30,
    stations: [
      {
        station_name: '深圳冷链仓',
        station_address: '深圳市龙岗区',
        planned_arrival_time: '2026-06-21T08:00:00.000Z',
      },
      {
        station_name: '广州配送中心',
        station_address: '广州市白云区',
        planned_arrival_time: '2026-06-21T12:00:00.000Z',
      },
      {
        station_name: '佛山终端店',
        station_address: '佛山市禅城区',
        planned_arrival_time: '2026-06-21T16:00:00.000Z',
      },
    ],
  };
  const createResp = await request('POST', '/api/v1/tasks', taskData);
  console.log('   状态:', createResp.statusCode);
  const taskId = createResp.body.data.task_id;
  console.log('   任务ID:', taskId);
  console.log('   任务号:', createResp.body.data.task_no);
  console.log('   站点数:', createResp.body.data.total_stations);
  console.log('   检查项数:', createResp.body.data.total_check_items);
  console.log('   站点清单:');
  createResp.body.data.stations.forEach((s) => {
    console.log(`     - 第${s.station_index}站: ${s.station_name} (${s.items.length}项检查)`);
  });
  console.log('');

  // 3. 过程接收 - 到站确认
  console.log('【3】过程接收 - 到站确认');
  const arrivalResp = await request('POST', '/api/v1/reports', {
    task_id: taskId,
    report_source: 'driver_app',
    check_type: 'arrival',
  });
  console.log('   状态:', arrivalResp.statusCode);
  console.log('   返回动作:', arrivalResp.body.data.action);
  console.log('   提示消息:', arrivalResp.body.data.message);
  console.log('   当前站点:', arrivalResp.body.data.current_station?.station_name);
  if (arrivalResp.body.data.missing_items) {
    console.log('   待补录项:', arrivalResp.body.data.missing_items.map((i) => i.check_name).join(', '));
  }
  console.log('');

  // 4. 过程接收 - 正常温度检测
  console.log('【4】过程接收 - 正常温度检测 (5°C)');
  const tempNormalResp = await request('POST', '/api/v1/reports', {
    task_id: taskId,
    report_source: 'driver_app',
    check_type: 'temperature',
    temperature: 5.0,
  });
  console.log('   状态:', tempNormalResp.statusCode);
  console.log('   返回动作:', tempNormalResp.body.data.action);
  console.log('   温度越界:', tempNormalResp.body.data.is_temperature_violation);
  console.log('   提示消息:', tempNormalResp.body.data.message);
  console.log('');

  // 5. 过程接收 - 温度越界
  console.log('【5】过程接收 - 温度越界检测 (10.5°C)');
  const tempViolationResp = await request('POST', '/api/v1/reports', {
    task_id: taskId,
    report_source: 'onboard_device',
    check_type: 'temperature',
    temperature: 10.5,
    remark: '制冷设备故障报警',
  });
  console.log('   状态:', tempViolationResp.statusCode);
  console.log('   返回动作:', tempViolationResp.body.data.action);
  console.log('   温度越界:', tempViolationResp.body.data.is_temperature_violation);
  console.log('   温度范围:', `${tempViolationResp.body.data.temperature_range.min}°C ~ ${tempViolationResp.body.data.temperature_range.max}°C`);
  console.log('   提示消息:', tempViolationResp.body.data.message);
  console.log('');

  // 6. 过程接收 - 货物照片
  console.log('【6】过程接收 - 货物照片上传');
  const photoResp = await request('POST', '/api/v1/reports', {
    task_id: taskId,
    report_source: 'driver_app',
    check_type: 'photo',
    photo_url: 'https://example.com/photos/cargo_001.jpg',
  });
  console.log('   状态:', photoResp.statusCode);
  console.log('   返回动作:', photoResp.body.data.action);
  console.log('   待补录项数:', photoResp.body.data.missing_items?.length || 0);
  console.log('');

  // 7. 过程接收 - 离站确认
  console.log('【7】过程接收 - 离站确认（完成首站所有检查）');
  const departResp = await request('POST', '/api/v1/reports', {
    task_id: taskId,
    report_source: 'driver_app',
    check_type: 'departure',
  });
  console.log('   状态:', departResp.statusCode);
  console.log('   返回动作:', departResp.body.data.action);
  console.log('   提示消息:', departResp.body.data.message);
  if (departResp.body.data.next_station) {
    console.log('   下一站:', departResp.body.data.next_station.station_name);
  }
  console.log('');

  // 8. 任务状态查询
  console.log('【8】任务状态查询 - 按运单号查询');
  const statusResp = await request('GET', '/api/v1/query/waybill/YD202606210001/status');
  console.log('   状态:', statusResp.statusCode);
  const taskStatus = statusResp.body.data.tasks[0];
  console.log('   任务状态:', taskStatus.task.status);
  console.log('   总站点数:', taskStatus.summary.total_stations);
  console.log('   已完成:', taskStatus.summary.completed_stations);
  console.log('   进行中:', taskStatus.summary.in_progress_stations);
  console.log('   待处理:', taskStatus.summary.pending_stations);
  console.log('   异常数:', taskStatus.summary.exception_count);
  console.log('   超时数:', taskStatus.summary.overdue_count);
  console.log('   温度越界:', taskStatus.summary.has_temperature_violation);
  console.log('   各站点详情:');
  taskStatus.stations.forEach((s) => {
    const statusIcon = s.station.status === 'completed' ? '[完]' : s.station.status === 'arrived' ? '[到]' : '[待]';
    const overdueIcon = s.is_overdue ? '[超时]' : '';
    console.log(`     ${statusIcon} 第${s.station.station_index}站: ${s.station.station_name} ${overdueIcon}`);
    console.log(`        进度: ${s.completed_count}/${s.total_required} 项已完成`);
    s.check_items.forEach((item) => {
      const itemStatus = item.status === 'completed' ? '✓' : item.status === 'exception' ? '✗异常' : '○';
      console.log(`          ${itemStatus} ${item.check_name}`);
    });
  });
  console.log('');

  console.log('========== 测试完成 ==========');
}

runTests().catch(console.error);
