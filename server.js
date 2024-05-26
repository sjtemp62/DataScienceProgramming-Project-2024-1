const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const app = express();

const allowedOrigins = [
  'http://localhost:5173',
  'http://sjpark-dev.com:5173',
  'http://sjpark-dev.com',
  'https://sjpark-dev.com',
  'https://sjpark-dev.com:5173'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json());

const geojsonTownPath = path.join(__dirname, 'updated_merged_data_final.geojson');
const geojsonCityPath = path.join(__dirname, 'updated_merged_data_final.geojson');

const getComputedGeoJson = (geojsonData) => {
  const columns = [
    '2023년_계_총세대수',
    'count_transport',
    'sum_all_shop',
    'montly-avg_mean'
  ];

  const minMaxValues = columns.reduce((acc, column) => {
    const values = geojsonData.features.map(f => {
      const value = f.properties && f.properties[column] !== undefined ? parseFloat(f.properties[column]) : 0;
      return value;
    });
    acc[column] = { min: Math.min(...values), max: Math.max(...values) };
    return acc;
  }, {});

  const normalize = (value, column) => {
    const { min, max } = minMaxValues[column];
    return (value - min) / (max - min);
  };

  geojsonData.features.forEach(feature => {
    if (!feature.properties) {
      console.error('Invalid feature: properties is undefined', feature);
      return; // Skip this feature
    }

    const values = columns.map(column => {
      const value = feature.properties[column] !== undefined ? parseFloat(feature.properties[column]) : 0;
      return value;
    });
    const normalizedValues = values.map((value, index) => normalize(value, columns[index]));

    const averagePriceIndex = (values[3] / 3) || 0;
    const reverseAveragePriceIndex = 1 - (normalize(averagePriceIndex, columns[3]) || 0);

    const computedValue = 
      (1 * normalizedValues[0]) +
      (1 * normalizedValues[1]) +
      (1 * normalizedValues[2]) +
      (1 * reverseAveragePriceIndex);

    feature.properties.computedValue = computedValue;
    feature.properties.priceSumNormalized = normalizedValues[3];
  });

  return geojsonData;
};

const readGeoJsonFile = (filePath) => {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        console.error('GeoJSON 파일 읽기 오류', err);
        reject('GeoJSON 파일 읽기 오류');
      } else {
        try {
          const jsonData = JSON.parse(data);
          resolve(jsonData);
        } catch (parseErr) {
          console.error('GeoJSON 파싱 오류', parseErr);
          reject('GeoJSON 파싱 오류');
        }
      }
    });
  });
};

app.get('/geojson/town', async (req, res) => {
  try {
    let geojsonData = await readGeoJsonFile(geojsonTownPath);
    console.log('GeoJSON Town Data:', JSON.stringify(geojsonData, null, 2)); // Log the data structure

    geojsonData = getComputedGeoJson(geojsonData);
    res.json(geojsonData);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message);
  }
});

app.get('/geojson/city', async (req, res) => {
  try {
    let geojsonData = await readGeoJsonFile(geojsonCityPath);
    console.log('GeoJSON City Data:', JSON.stringify(geojsonData, null, 2)); // Log the data structure

    geojsonData = getComputedGeoJson(geojsonData);
    res.json(geojsonData);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message);
  }
});

app.post('/update-geojson', async (req, res) => {
  const { useTownData } = req.body;
  const geojsonPath = useTownData ? geojsonTownPath : geojsonCityPath;

  try {
    let geojsonData = await readGeoJsonFile(geojsonPath);
    console.log('GeoJSON Data for Update:', JSON.stringify(geojsonData, null, 2)); // Log the data structure
    geojsonData = getComputedGeoJson(geojsonData);
    res.json(geojsonData);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message);
  }
});

const server = app.listen(process.env.PORT || 3001, () => {
  console.log(`서버가 ${server.address().port} 포트에서 실행 중입니다`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${error.port} is already in use`);
  } else {
    console.error(error);
  }
});

server.timeout = 600000; // 10 minutes
