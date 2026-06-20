$taskId = "b3c460cf-6452-4cfc-b12c-aa2c9b1292db"

Write-Host "=== 测试1: 到站确认 ==="
$body1 = @{
    task_id = $taskId
    report_source = "driver_app"
    check_type = "arrival"
    remark = ""
} | ConvertTo-Json
$result1 = Invoke-RestMethod -Uri "http://localhost:3001/api/v1/reports" -Method Post -Body $body1 -ContentType "application/json"
Write-Host "动作: $($result1.data.action)"
Write-Host "消息: $($result1.data.message)"
if ($result1.data.missing_items) {
    Write-Host "缺项: $($result1.data.missing_items | ForEach-Object { $_.check_name } | Join-String -Separator ', ')"
}
Write-Host ""

Write-Host "=== 测试2: 温度检测（正常温度 5°C） ==="
$body2 = @{
    task_id = $taskId
    report_source = "driver_app"
    check_type = "temperature"
    temperature = 5.0
} | ConvertTo-Json
$result2 = Invoke-RestMethod -Uri "http://localhost:3001/api/v1/reports" -Method Post -Body $body2 -ContentType "application/json"
Write-Host "动作: $($result2.data.action)"
Write-Host "消息: $($result2.data.message)"
Write-Host "温度越界: $($result2.data.is_temperature_violation)"
Write-Host ""

Write-Host "=== 测试3: 温度检测（温度越界 10°C） ==="
$body3 = @{
    task_id = $taskId
    report_source = "onboard_device"
    check_type = "temperature"
    temperature = 10.5
    remark = "制冷设备故障报警"
} | ConvertTo-Json
$result3 = Invoke-RestMethod -Uri "http://localhost:3001/api/v1/reports" -Method Post -Body $body3 -ContentType "application/json"
Write-Host "动作: $($result3.data.action)"
Write-Host "消息: $($result3.data.message)"
Write-Host "温度越界: $($result3.data.is_temperature_violation)"
Write-Host "温度范围: $($result3.data.temperature_range.min)°C ~ $($result3.data.temperature_range.max)°C"
Write-Host ""

Write-Host "=== 测试4: 货物照片上传 ==="
$body4 = @{
    task_id = $taskId
    report_source = "driver_app"
    check_type = "photo"
    photo_url = "https://example.com/photos/cargo_001.jpg"
} | ConvertTo-Json
$result4 = Invoke-RestMethod -Uri "http://localhost:3001/api/v1/reports" -Method Post -Body $body4 -ContentType "application/json"
Write-Host "动作: $($result4.data.action)"
Write-Host "消息: $($result4.data.message)"
Write-Host ""

Write-Host "=== 测试5: 离站确认 ==="
$body5 = @{
    task_id = $taskId
    report_source = "driver_app"
    check_type = "departure"
} | ConvertTo-Json
$result5 = Invoke-RestMethod -Uri "http://localhost:3001/api/v1/reports" -Method Post -Body $body5 -ContentType "application/json"
Write-Host "动作: $($result5.data.action)"
Write-Host "消息: $($result5.data.message)"
if ($result5.data.next_station) {
    Write-Host "下一站: 第 $($result5.data.next_station.station_index) 站"
}
Write-Host ""
