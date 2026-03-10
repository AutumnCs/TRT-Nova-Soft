console.log('脚本启动了');
const https = require('https');

const PRODUCT_ID = 'Aruv1l24Y6';
const DEVICE_NAME = 'httptest';

const TOKEN =
  'version=2018-10-31&res=products%2FAruv1l24Y6&et=1917587320&method=md5&sign=lSmPmidwoA3LlAn1KMRt5w%3D%3D';

const topic = `$sys/${PRODUCT_ID}/${DEVICE_NAME}/thing/property/post`;
const path =
  `/fuse/http/device/thing/property/post?topic=${encodeURIComponent(topic)}&protocol=HTTP`;

function generateRandomValue(min, max, decimals = 1) {
  const value = Math.random() * (max - min) + min;
  return Number(value.toFixed(decimals));
}

function generateSensorData() {
  const now = Date.now();
  
  return {
    uid: {
      value: '430865273656433105D1FF35',
      time: now
    },
    dht_temp: {
      value: generateRandomValue(20, 35, 1),
      time: now
    },
    dht_humi: {
      value: generateRandomValue(40, 80, 1),
      time: now
    },
    soil_percent: {
      value: Math.floor(generateRandomValue(10, 60, 1)),
      time: now
    },
    run_state: {
      value: Math.random() > 0.5,
      time: now
    },
    light_val: {
      value: generateRandomValue(0, 5, 1),
      time: now
    },
    ir_status: {
      value: Math.random() > 0.5,
      time: now
    },
    dsb_temp: {
      value: generateRandomValue(20, 35, 1),
      time: now
    }
  };
}

function sendPropertyPost() {
  const now = Date.now();
  const params = generateSensorData();
  
  const body = JSON.stringify({
    id: String(now),
    version: '1.0',
    params: params
  });

  const options = {
    hostname: 'open.iot.10086.cn',
    port: 443,
    path,
    method: 'POST',
    headers: {
      'token': TOKEN,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  console.log('\n===== 发送时间:', new Date().toLocaleString('zh-CN'), '=====');
  console.log('发送数据:', JSON.stringify(params, null, 2));

  const req = https.request(options, (res) => {
    let data = '';

    console.log('HTTP Status:', res.statusCode);

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      console.log('响应:', data);
    });
  });

  req.on('error', (err) => {
    console.error('请求失败:', err.message);
  });

  req.write(body);
  req.end();
}

console.log('开始每5秒发送一次模拟数据...');
console.log('按 Ctrl+C 停止');

sendPropertyPost();

setInterval(sendPropertyPost, 5000);
