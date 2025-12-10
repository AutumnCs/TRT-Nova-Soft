import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Cloud, Droplets, Sun, AlertCircle, Lightbulb, Leaf, TrendingUp, Settings, Bell, Home, BarChart3, Plus, Users, User } from "lucide-react";
import Link from "next/link";

// 获取当前用户的所有传感器及其最新读数
async function getSensorData() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  // 从数据库查询该用户的传感器及最新数据
  const { data: sensorsData, error: sensorsError } = await supabase
    .from("sensors")
    .select(
      `
      id,
      name,
      location,
      sensor_readings(temperature, humidity, light, recorded_at)
    `
    )
    .order("created_at", { ascending: false });

  if (sensorsError) {
    console.error("Error fetching sensors:", sensorsError);
    return { sensors: [] };
  }

  // 处理数据格式，获取最新的读数
  const sensors = sensorsData?.map((sensor: any) => {
    const latestReading = sensor.sensor_readings?.[0] || {
      temperature: 0,
      humidity: 0,
      light: 0,
      recorded_at: new Date().toISOString(),
    };
    return {
      id: sensor.id,
      name: sensor.name,
      location: sensor.location,
      temperature: latestReading.temperature || 0,
      humidity: latestReading.humidity || 0,
      light: latestReading.light || 0,
      lastUpdated: latestReading.recorded_at || new Date().toISOString(),
    };
  }) || [];

  return { sensors };
}

function SensorCard({ sensor }: { sensor: any }) {
  // 判断各项环境参数是否在正常范围
  const tempNormal = sensor.temperature >= 15 && sensor.temperature <= 30;
  const humidityNormal = sensor.humidity >= 40 && sensor.humidity <= 80;
  const lightNormal = sensor.light >= 200 && sensor.light <= 2000;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
      <h3 className="text-lg font-semibold mb-4">{sensor.name}</h3>

      <div className="grid grid-cols-3 gap-4">
        {/* 温度 */}
        <div className="flex flex-col items-center p-3 bg-red-50 dark:bg-red-900/20 rounded">
          <Cloud className="text-red-500 mb-2" size={24} />
          <p className="text-sm text-gray-600 dark:text-gray-400">温度</p>
          <p className={`text-xl font-bold ${tempNormal ? "text-red-600" : "text-orange-600"}`}>
            {sensor.temperature}°C
          </p>
          {!tempNormal && <AlertCircle size={16} className="text-orange-500 mt-1" />}
        </div>

        {/* 湿度 */}
        <div className="flex flex-col items-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded">
          <Droplets className="text-blue-500 mb-2" size={24} />
          <p className="text-sm text-gray-600 dark:text-gray-400">湿度</p>
          <p className={`text-xl font-bold ${humidityNormal ? "text-blue-600" : "text-orange-600"}`}>
            {sensor.humidity}%
          </p>
          {!humidityNormal && <AlertCircle size={16} className="text-orange-500 mt-1" />}
        </div>

        {/* 光照 */}
        <div className="flex flex-col items-center p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded">
          <Sun className="text-yellow-500 mb-2" size={24} />
          <p className="text-sm text-gray-600 dark:text-gray-400">光照</p>
          <p className={`text-xl font-bold ${lightNormal ? "text-yellow-600" : "text-orange-600"}`}>
            {sensor.light} lux
          </p>
          {!lightNormal && <AlertCircle size={16} className="text-orange-500 mt-1" />}
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
        最后更新: {new Date(sensor.lastUpdated).toLocaleString("zh-CN")}
      </p>
    </div>
  );
}

export default async function PlantSensorsPage() {
  // 获取传感器数据
  const { sensors } = await getSensorData();

  // 计算平均温度、湿度、光照
  const avgTemp = sensors.length > 0 
    ? (sensors.reduce((sum, s) => sum + s.temperature, 0) / sensors.length).toFixed(1)
    : 0;
  const avgHumidity = sensors.length > 0
    ? Math.round(sensors.reduce((sum, s) => sum + s.humidity, 0) / sensors.length)
    : 0;
  const avgLight = sensors.length > 0
    ? Math.round(sensors.reduce((sum, s) => sum + s.light, 0) / sensors.length)
    : 0;

  // 页面主结构
  return (
    <div className="flex-1 w-full flex flex-col bg-gray-50 dark:bg-slate-900 min-h-screen pb-24">
      {/* 固定顶部导航栏，包含品牌与操作按钮 */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700">
        <div className="px-4 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center">
              <Leaf className="text-white" size={20} />
            </div>
            <h1 className="text-xl font-bold text-gray-800 dark:text-white">蓝星</h1>
          </div>
          
          <div className="flex items-center space-x-4">
            <button className="w-8 h-8 rounded-full bg-green-100 dark:bg-slate-700 flex items-center justify-center text-green-600 dark:text-green-400 hover:bg-green-200 transition-colors">
              <Bell size={18} />
            </button>
            <button className="w-8 h-8 rounded-full bg-green-100 dark:bg-slate-700 flex items-center justify-center text-green-600 dark:text-green-400 hover:bg-green-200 transition-colors">
              <Settings size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* 主内容区域 */}
      <main className="pt-16">
        {/* 3D花盆展示区（占位，后续可集成three.js模型） */}
        <section className="relative h-64 bg-gradient-to-b from-green-100 dark:from-green-900/20 to-white dark:to-slate-800 overflow-hidden flex items-center justify-center">
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="text-4xl">🪴</div>
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">3D花盆展示区</h2>
            <p className="text-sm text-gray-500">（后续集成3D模型）</p>
          </div>

          {/* 植物名称标签 */}
          <div className="absolute top-4 left-4 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-full shadow-md text-sm font-medium">
            植物 <span className="text-xs text-gray-500 ml-1">已种植</span>
          </div>

          {/* 悬浮控制按钮 */}
          <div className="absolute bottom-4 right-4 flex flex-col space-y-3">
            <button className="w-12 h-12 rounded-full bg-white dark:bg-slate-700 shadow-lg flex items-center justify-center text-green-600 dark:text-green-400 hover:bg-green-600 hover:text-white transition-all duration-300">
              <Droplets size={20} />
            </button>
            <button className="w-12 h-12 rounded-full bg-white dark:bg-slate-700 shadow-lg flex items-center justify-center text-green-600 dark:text-green-400 hover:bg-green-600 hover:text-white transition-all duration-300">
              <Sun size={20} />
            </button>
          </div>
        </section>

        {/* 环境数据卡片区，展示平均温度/湿度/光照/设备数 */}
        <section className="px-4 py-5">
          <h2 className="text-lg font-bold mb-4 text-gray-800 dark:text-white">环境状态</h2>
          
          {/* 四个主要环境参数卡片 */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* 温度卡片 */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 border border-gray-100 dark:border-slate-700 hover:shadow-lg transition-shadow">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">温度</p>
                  <p className="text-2xl font-bold mt-1 text-gray-800 dark:text-white">{avgTemp}°C</p>
                </div>
                <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 dark:text-green-400">
                  <Cloud size={20} />
                </div>
              </div>
              <div className="mt-3 h-1 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-green-600 rounded-full" style={{ width: '65%' }}></div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">适宜生长 (15-30°C)</p>
            </div>
            
            {/* 湿度卡片 */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 border border-gray-100 dark:border-slate-700 hover:shadow-lg transition-shadow">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">湿度</p>
                  <p className="text-2xl font-bold mt-1 text-gray-800 dark:text-white">{avgHumidity}%</p>
                </div>
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <Droplets size={20} />
                </div>
              </div>
              <div className="mt-3 h-1 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 rounded-full" style={{ width: avgHumidity + '%' }}></div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">状态 (40-80% 最佳)</p>
            </div>
            
            {/* 光照卡片 */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 border border-gray-100 dark:border-slate-700 hover:shadow-lg transition-shadow">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">光照</p>
                  <p className="text-2xl font-bold mt-1 text-gray-800 dark:text-white">{avgLight} lux</p>
                </div>
                <div className="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center text-yellow-600 dark:text-yellow-400">
                  <Sun size={20} />
                </div>
              </div>
              <div className="mt-3 h-1 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-yellow-600 rounded-full" style={{ width: Math.min(avgLight / 60, 100) + '%' }}></div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">适宜 (200-2000 lux)</p>
            </div>
            
            {/* 传感器数量卡片 */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 border border-gray-100 dark:border-slate-700 hover:shadow-lg transition-shadow">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">传感器</p>
                  <p className="text-2xl font-bold mt-1 text-gray-800 dark:text-white">{sensors.length}</p>
                </div>
                <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400">
                  <Leaf size={20} />
                </div>
              </div>
              <div className="mt-3 h-1 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-purple-600 rounded-full" style={{ width: '80%' }}></div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">已连接设备</p>
            </div>
          </div>

          {/* 传感器详细列表（如有） */}
          {sensors.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-bold mb-3 text-gray-800 dark:text-white">传感器详情</h3>
              <div className="grid grid-cols-1 gap-4">
                {sensors.map((sensor) => (
                  <SensorCard key={sensor.id} sensor={sensor} />
                ))}
              </div>
            </div>
          )}
          
          {/* 生长趋势图（占位，后续可集成Chart.js） */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 border border-gray-100 dark:border-slate-700 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-gray-800 dark:text-white">生长趋势</h3>
              <div className="text-sm text-green-600 dark:text-green-400">
                <select className="bg-transparent border-none outline-none text-gray-700 dark:text-gray-300">
                  <option>近7天</option>
                  <option>近30天</option>
                  <option>近90天</option>
                </select>
              </div>
            </div>
            <div className="h-48 flex items-center justify-center bg-gray-50 dark:bg-slate-700/50 rounded-lg">
              <p className="text-gray-500 text-sm">（后续集成趋势图表）</p>
            </div>
          </div>
          
          {/* AI养护建议区（占位） */}
          <div className="bg-gradient-to-r from-green-50 dark:from-green-900/20 to-emerald-50 dark:to-emerald-900/20 rounded-xl p-4 mb-6 border border-green-200 dark:border-green-700/50">
            <div className="flex items-start">
              <div className="w-10 h-10 rounded-full bg-green-200 dark:bg-green-900/50 flex items-center justify-center text-green-600 dark:text-green-400 mr-3 mt-0.5">
                <Lightbulb size={20} />
              </div>
              <div>
                <h3 className="font-bold text-gray-800 dark:text-white mb-1">AI养护建议</h3>
                <p className="text-gray-700 dark:text-gray-300 text-sm">根据当前传感器数据，您的植物生长环境整体良好。建议定期检查土壤湿度，确保植物获得充足的光照。</p>
                <button className="text-green-600 dark:text-green-400 text-sm mt-2 font-medium hover:underline">查看详细方案 →</button>
              </div>
            </div>
          </div>
          
          {/* 快捷操作区 */}
          <h2 className="text-lg font-bold mb-4 text-gray-800 dark:text-white">快捷操作</h2>
          <div className="grid grid-cols-3 gap-3 mb-6">
            <button className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 border border-gray-100 dark:border-slate-700 flex flex-col items-center justify-center hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 dark:text-green-400 mb-2">
                <Settings size={20} />
              </div>
              <span className="text-sm text-gray-700 dark:text-gray-300">自动模式</span>
            </button>
            
            <button className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 border border-gray-100 dark:border-slate-700 flex flex-col items-center justify-center hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-2">
                <TrendingUp size={20} />
              </div>
              <span className="text-sm text-gray-700 dark:text-gray-300">数据统计</span>
            </button>
            
            <button className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 border border-gray-100 dark:border-slate-700 flex flex-col items-center justify-center hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center text-yellow-600 dark:text-yellow-400 mb-2">
                <AlertCircle size={20} />
              </div>
              <span className="text-sm text-gray-700 dark:text-gray-300">警报设置</span>
            </button>
            
            <button className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 border border-gray-100 dark:border-slate-700 flex flex-col items-center justify-center hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400 mb-2">
                <Users size={20} />
              </div>
              <span className="text-sm text-gray-700 dark:text-gray-300">社区交流</span>
            </button>
            
            <button className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 border border-gray-100 dark:border-slate-700 flex flex-col items-center justify-center hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400 mb-2">
                <Home size={20} />
              </div>
              <span className="text-sm text-gray-700 dark:text-gray-300">返回首页</span>
            </button>

            <Link
              href="/dashboard"
              className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 border border-gray-100 dark:border-slate-700 flex flex-col items-center justify-center hover:shadow-lg transition-shadow"
            >
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 dark:text-green-400 mb-2">
                <Home size={20} />
              </div>
              <span className="text-sm text-gray-700 dark:text-gray-300">仪表板</span>
            </Link>
          </div>
        </section>
      </main>

      {/* 固定底部导航栏，模仿App风格 */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-gray-100 dark:border-slate-700 py-2 z-40">
        <div className="px-4">
          <div className="flex justify-around">
            <a href="#" className="flex flex-col items-center text-green-600 dark:text-green-400 py-2">
              <Home size={20} />
              <span className="text-xs mt-1">首页</span>
            </a>
            <a href="#" className="flex flex-col items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 py-2">
              <BarChart3 size={20} />
              <span className="text-xs mt-1">数据</span>
            </a>
            <a href="#" className="flex flex-col items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 py-2">
              <div className="w-12 h-12 rounded-full bg-green-600 flex items-center justify-center -mt-5 shadow-lg hover:bg-green-700 transition-colors">
                <Plus className="text-white" size={24} />
              </div>
              <span className="text-xs mt-1">添加</span>
            </a>
            <a href="#" className="flex flex-col items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 py-2">
              <Users size={20} />
              <span className="text-xs mt-1">社区</span>
            </a>
            <a href="#" className="flex flex-col items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 py-2">
              <User size={20} />
              <span className="text-xs mt-1">我的</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
