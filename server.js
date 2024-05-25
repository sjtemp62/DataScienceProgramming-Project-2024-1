const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const app = express();

const allowedOrigins = ['http://localhost:5173', 'http://192.168.0.3:5173', 'http://sjpark-dev.com:5173', 'https://sjpark-dev.com:5173', 'http://sjpark-dev.com', 'https://sjpark-dev.com'];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

const geojsonPath = path.join(__dirname, 'all_data_with_geojson_data.geojson');

const parseValue = (value) => {
  if (typeof value === 'string') {
    return parseFloat(value.replace(/,/g, '')) || 0;
  }
  return parseFloat(value) || 0;
};

const getComputedGeoJson = (geojsonData, weights, statuses) => {
  const columns = [
    '2023년_계_총세대수', 'count_transport', 'sum_all_shop', 
    'montly-avg_mean', 'dep-avg_rent_mean', 'dep-avg_deposit_mean'
  ];

  // 가격 관련 데이터의 합산 값을 계산하여 추가
  geojsonData.features.forEach(feature => {
    const priceSum = parseValue(feature.properties['montly-avg_mean']) +
                     parseValue(feature.properties['dep-avg_rent_mean']) +
                     parseValue(feature.properties['dep-avg_deposit_mean']);
    feature.properties.priceSum = priceSum;
  });

  // min-max 정규화
  const minMaxValues = columns.concat('priceSum').reduce((acc, column) => {
    const values = geojsonData.features.map(f => parseValue(f.properties[column]));
    acc[column] = { min: Math.min(...values), max: Math.max(...values) };
    return acc;
  }, {});

  const normalize = (value, column) => {
    const { min, max } = minMaxValues[column];
    return (value - min) / (max - min);
  };

  // 가중치를 적용하여 계산
  const computedValues = geojsonData.features.map(feature => {
    const values = columns.map(column => parseValue(feature.properties[column]));
    const normalizedValues = values.map((value, index) => normalize(value, columns[index]));

    // 가격 합산 값 역으로 정규화
    const priceSumNormalized = normalize(feature.properties.priceSum, 'priceSum');
    const reversePriceSumNormalized = 1 - priceSumNormalized;
    feature.properties.priceSumNormalized = priceSumNormalized;

    const computedValue =
      (statuses[0] ? normalizedValues[0] * weights[0] : 0) +
      (statuses[1] ? normalizedValues[1] * weights[1] : 0) +
      (statuses[2] ? normalizedValues[2] * weights[2] : 0) +
      (statuses[3] ? reversePriceSumNormalized * weights[3] : 0);

    return computedValue;
  });

  // 전체 값을 0~100 범위로 정규화
  const globalMin = Math.min(...computedValues);
  const globalMax = Math.max(...computedValues);
  const normalizeGlobal = (value) => (value - globalMin) / (globalMax - globalMin) * 100;

  geojsonData.features = geojsonData.features.map((feature, index) => {
    feature.properties.computedValue = normalizeGlobal(computedValues[index]);
    return feature;
  });

  return geojsonData;
};

app.get('/geojson', (req, res) => {
  fs.readFile(geojsonPath, 'utf8', (err, data) => {
    if (err) {
      console.error('GeoJSON 파일 읽기 오류:', err); // 에러 로그 추가
      res.status(500).send('GeoJSON 파일 읽기 오류');
      return;
    }

    let geojsonData;
    try {
      geojsonData = JSON.parse(data);
    } catch (parseError) {
      console.error('GeoJSON 파싱 오류:', parseError); // 에러 로그 추가
      res.status(500).send('GeoJSON 파싱 오류');
      return;
    }

    const weights = [1, 1, 1, 1];
    const statuses = [true, true, true, true];

    geojsonData = getComputedGeoJson(geojsonData, weights, statuses);
    res.json(geojsonData);
  });
});

app.post('/update-geojson', (req, res) => {
  const { weights, statuses } = req.body;

  console.log('받은 가중치:', weights); // 디버깅 로그 추가
  console.log('받은 상태:', statuses); // 디버깅 로그 추가

  fs.readFile(geojsonPath, 'utf8', (err, data) => {
    if (err) {
      console.error('GeoJSON 파일 읽기 오류:', err); // 에러 로그 추가
      res.status(500).send('GeoJSON 파일 읽기 오류');
      return;
    }

    let geojsonData;
    try {
      geojsonData = JSON.parse(data);
    } catch (parseError) {
      console.error('GeoJSON 파싱 오류:', parseError); // 에러 로그 추가
      res.status(500).send('GeoJSON 파싱 오류');
      return;
    }

    try {
      geojsonData = getComputedGeoJson(geojsonData, weights, statuses);
    } catch (computationError) {
      console.error('GeoJSON 계산 오류:', computationError); // 에러 로그 추가
      res.status(500).send('GeoJSON 계산 오류');
      return;
    }

    res.json(geojsonData);
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`서버가 ${PORT} 포트에서 실행 중입니다`);
});
