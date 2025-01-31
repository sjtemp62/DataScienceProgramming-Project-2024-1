const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const turf = require('@turf/turf');
const dotenv = require('dotenv');
dotenv.config();

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',');

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

const parseValue = (value) => {
  if (typeof value === 'string') {
    return parseFloat(value.replace(/,/g, '')) || 0;
  }
  return parseFloat(value) || 0;
};

const getComputedGeoJson = (geojsonData, weights, statuses, houseType) => {
  const baseColumns = [
    '면적 당 1인가구수', '면적 당 대중교통 수', '면적 당 전체 상점 수'
  ];

  const priceColumns = houseType ? [
    `${houseType} 단위면적당 월세금`, `${houseType} 월세 단위면적당 보증금`, `${houseType} 전세 단위면적당 보증금`
  ] : [
    '평균 단위면적당 월세금', '평균 월세 단위면적당 보증금', '평균 전세 단위면적당 보증금'
  ];

  const columns = baseColumns.concat(priceColumns);

  const priceColumnAverages = priceColumns.reduce((acc, column) => {
    const values = geojsonData.features.map(f => parseValue(f.properties[column])).filter(value => !isNaN(value));
    const sum = values.reduce((total, value) => total + value, 0);
    const avg = sum / values.length;
    acc[column] = avg;
    return acc;
  }, {});

  geojsonData.features.forEach(feature => {
    // 가격 열의 null 값을 평균값으로 대체
    priceColumns.forEach(column => {
      if (!feature.properties[column] || isNaN(parseValue(feature.properties[column]))) {
        feature.properties[column] = priceColumnAverages[column];
      }
    });

    const priceSum = parseValue(feature.properties[priceColumns[0]]) +
      parseValue(feature.properties[priceColumns[1]]) +
      parseValue(feature.properties[priceColumns[2]]);
    feature.properties.priceSum = priceSum;
  });

  geojsonData.features.forEach(feature => {
    const priceSum = (parseValue(feature.properties[priceColumns[0]]) * 12 / 0.06) +
      parseValue(feature.properties[priceColumns[1]]) +
      parseValue(feature.properties[priceColumns[2]]);
    feature.properties.priceSum = priceSum;
  });

  const minMaxValues = columns.concat('priceSum').reduce((acc, column) => {
    const values = geojsonData.features.map(f => parseValue(f.properties[column]));
    acc[column] = { min: Math.min(...values), max: Math.max(...values) };
    return acc;
  }, {});

  const normalize = (value, column) => {
    const { min, max } = minMaxValues[column];
    return (value - min) / (max - min);
  };

  const computedValues = geojsonData.features.map(feature => {
    const values = columns.map(column => parseValue(feature.properties[column]));
    const normalizedValues = values.map((value, index) => normalize(value, columns[index]));

    const priceSumNormalized = normalize(feature.properties.priceSum, 'priceSum');
    const reversePriceSumNormalized = 1 - priceSumNormalized;
    feature.properties.reversepriceSumNormalized = reversePriceSumNormalized;

    const computedValue =
      (statuses[0] ? normalizedValues[0] * weights[0] : 0) +
      (statuses[1] ? normalizedValues[1] * weights[1] : 0) +
      (statuses[2] ? normalizedValues[2] * weights[2] : 0) +
      (statuses[3] ? reversePriceSumNormalized * weights[3] : 0);

    return computedValue;
  });

  const globalMin = Math.min(...computedValues);
  const globalMax = Math.max(...computedValues);
  const normalizeGlobal = (value) => (value - globalMin) / (globalMax - globalMin) * 100;

  geojsonData.features = geojsonData.features.map((feature, index) => {
    feature.properties.computedValue = normalizeGlobal(computedValues[index]);
    return feature;
  });

  return geojsonData;
};

const getCentroids = (geojsonData) => {
  return geojsonData.features.map(feature => {
    const centroid = turf.centroid(feature);
    feature.properties.centroid = centroid.geometry.coordinates;
    return feature;
  });
};

const getDistance = (coord1, coord2) => {
  const from = turf.point(coord1);
  const to = turf.point(coord2);
  const distance = turf.distance(from, to, { units: 'kilometers' });
  return distance;
};

// 지역명 변환 함수
const convertRegionName = (regionName) => {
  if (!regionName) return ''; // null 또는 undefined 체크
  return regionName.replace(/·/g, '.');
};

app.get('/geojson/:type', (req, res) => {
  const { type } = req.params;
  const geojsonPath = path.join(__dirname, type === 'sigungu' ? '전체데이터_최종처리_시군구_면적당데이터_추가.geojson' : '전체데이터_최종처리_읍면동_면적당데이터_추가_left.geojson');

  fs.readFile(geojsonPath, 'utf8', (err, data) => {
    if (err) {
      console.error('GeoJSON 파일 읽기 오류:', err);
      res.status(500).send('GeoJSON 파일 읽기 오류');
      return;
    }

    let geojsonData;
    try {
      geojsonData = JSON.parse(data);
    } catch (parseError) {
      console.error('GeoJSON 파싱 오류:', parseError);
      res.status(500).send('GeoJSON 파싱 오류');
      return;
    }

    const weights = [1, 1, 1, 1];
    const statuses = [true, true, true, true];

    geojsonData = getComputedGeoJson(geojsonData, weights, statuses);
    res.json(geojsonData);
  });
});

app.post('/update-geojson/:type', (req, res) => {
  const { type } = req.params;
  const { weights, statuses } = req.body;
  const geojsonPath = path.join(__dirname, type === 'sigungu' ? '전체데이터_최종처리_시군구_면적당데이터_추가.geojson' : '전체데이터_최종처리_읍면동_면적당데이터_추가_left.geojson');

  console.log('받은 가중치:', weights);
  console.log('받은 상태:', statuses);

  fs.readFile(geojsonPath, 'utf8', (err, data) => {
    if (err) {
      console.error('GeoJSON 파일 읽기 오류:', err);
      res.status(500).send('GeoJSON 파일 읽기 오류');
      return;
    }

    let geojsonData;
    try {
      geojsonData = JSON.parse(data);
    } catch (parseError) {
      console.error('GeoJSON 파싱 오류:', parseError);
      res.status(500).send('GeoJSON 파싱 오류');
      return;
    }

    try {
      geojsonData = getComputedGeoJson(geojsonData, weights, statuses);
    } catch (computationError) {
      console.error('GeoJSON 계산 오류:', computationError);
      res.status(500).send('GeoJSON 계산 오류');
      return;
    }

    res.json(geojsonData);
  });
});

app.post('/api/recommend', (req, res) => {
  const {
    currentWorkplaceSido,
    currentWorkplaceSigungu,
    currentWorkplaceEupmyeondong,
    commercialScale,
    transportation,
    singleHousehold,
    rentType,
    houseType,
    area,
    minPrice,
    maxPrice,
    minDeposit,
    maxDeposit,
    maxDistance,
  } = req.body;

  console.log('Received data:', req.body);

  const geojsonPath = path.join(__dirname, '전체데이터_최종처리_읍면동_면적당데이터_추가_left.geojson');

  fs.readFile(geojsonPath, 'utf8', (err, data) => {
    if (err) {
      console.error('GeoJSON 파일 읽기 오류:', err);
      res.status(500).send('GeoJSON 파일 읽기 오류');
      return;
    }

    let geojsonData;
    try {
      geojsonData = JSON.parse(data);
    } catch (parseError) {
      console.error('GeoJSON 파싱 오류:', parseError);
      res.status(500).send('GeoJSON 파싱 오류');
      return;
    }

    // 중심점 계산
    const featuresWithCentroids = getCentroids(geojsonData);

    // 현재 직장의 행정구역 합치기
    const workplaceRegion = convertRegionName(`${currentWorkplaceSido} ${currentWorkplaceSigungu} ${currentWorkplaceEupmyeondong}`);

    // 현재 직장의 중심점 찾기
    const workplaceFeature = featuresWithCentroids.find(
      feature => convertRegionName(feature.properties.행정구역_x) === workplaceRegion
    );

    if (!workplaceFeature) {
      res.status(404).send('직장의 행정구역을 찾을 수 없습니다.');
      return;
    }

    const workplaceCentroid = workplaceFeature.properties.centroid;

    // 거리 계산하여 maxDistance 안쪽의 지역만 반환
    const nearbyFeatures = featuresWithCentroids.filter(feature => {
      const featureCentroid = feature.properties.centroid;
      const distance = getDistance(workplaceCentroid, featureCentroid);
      feature.properties.distance = distance; // 거리 추가
      return distance <= maxDistance;
    });

    // 사용자로부터 받은 가중치와 상태 값 설정
    const weights = [0, transportation, commercialScale, 5]; // rentPrice 대신 1로 설정
    const statuses = [false, true, true, true]; // rentPrice 대신 false로 설정

    // 가격 범위 필터링
    const filteredFeatures = nearbyFeatures.filter(feature => {
      const monthlyRentKey = `${houseType} 단위면적당 월세금`;
      const monthlyDepositKey = `${houseType} 월세 단위면적당 보증금`;
      const jeonseDepositKey = `${houseType} 전세 단위면적당 보증금`;

      if (rentType === '월세') {
        const monthlyRent = parseValue(feature.properties[monthlyRentKey]) * area;
        const deposit = parseValue(feature.properties[monthlyDepositKey]) * area;
        return monthlyRent >= minPrice && monthlyRent <= maxPrice && deposit >= minDeposit && deposit <= maxDeposit;
      } else if (rentType === '전세') {
        const deposit = parseValue(feature.properties[jeonseDepositKey]) * area;
        return deposit >= minDeposit && deposit <= maxDeposit;
      }
      return false;
    });

    // 가중치를 이용해 computedValue 계산
    const computedGeoJson = getComputedGeoJson({ features: filteredFeatures }, weights, statuses, houseType);
    res.json(computedGeoJson.features);
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`서버가 ${PORT} 포트에서 실행 중입니다`);
});
