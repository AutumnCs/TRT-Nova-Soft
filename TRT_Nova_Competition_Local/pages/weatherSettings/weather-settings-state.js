function roundCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return null;
  }
  return {
    latitude: Number(lat.toFixed(2)),
    longitude: Number(lon.toFixed(2))
  };
}

function buildCityLabel(city = {}) {
  return [city.city, city.adm2, city.adm1]
    .filter((item, index, values) => item && values.indexOf(item) === index)
    .join(' · ');
}

function decorateCityResults(cities = []) {
  return cities.map((city) => ({
    ...city,
    label: buildCityLabel(city),
    meta: [city.adm2, city.adm1, city.country]
      .filter((item, index, values) => item && item !== city.city && values.indexOf(item) === index)
      .join(' · ')
  }));
}

module.exports = {
  buildCityLabel,
  decorateCityResults,
  roundCoordinates
};
