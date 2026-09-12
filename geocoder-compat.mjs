const originalFetch = globalThis.fetch;
const PHOTON_BASE = 'https://photon.komoot.io/api/';

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[「」『』]/g, '')
    .replace(/\s+/gu, '')
    .trim()
    .toLowerCase();
}

function detectAdministrativeType(query) {
  const normalized = normalize(query);
  if (/(都|道|府|県)$/u.test(normalized)) return 'state';
  if (/市$/u.test(normalized)) return 'city';
  if (/(町|村)$/u.test(normalized)) return normalized.endsWith('町') ? 'town' : 'village';
  if (/区$/u.test(normalized)) return 'district';
  return null;
}

function getFeatureText(properties = {}) {
  return [
    properties.name,
    properties.city,
    properties.district,
    properties.county,
    properties.state,
    properties.country
  ].filter(Boolean).join(' ');
}

function isAdministrativeFeature(feature, preferredType) {
  const properties = feature?.properties || {};
  const osmKey = String(properties.osm_key || '').toLowerCase();
  const osmValue = String(properties.osm_value || '').toLowerCase();
  const type = String(properties.type || '').toLowerCase();

  if (osmKey === 'place') {
    if (preferredType === 'city' && ['city', 'municipality'].includes(osmValue)) return true;
    if (preferredType === 'town' && ['town', 'municipality'].includes(osmValue)) return true;
    if (preferredType === 'village' && ['village', 'municipality'].includes(osmValue)) return true;
    if (preferredType === 'district' && ['district', 'borough', 'suburb'].includes(osmValue)) return true;
    if (!preferredType && ['city', 'town', 'village', 'municipality'].includes(osmValue)) return true;
  }

  if (preferredType === 'state' && ['state', 'province'].includes(osmValue)) return true;
  if (type === preferredType) return true;
  return false;
}

function toNominatimShape(data, query) {
  const features = Array.isArray(data?.features) ? data.features : [];
  const preferredType = detectAdministrativeType(query);
  const queryNorm = normalize(query);

  const scored = features.map((feature, index) => {
    const coordinates = feature?.geometry?.coordinates || [];
    const properties = feature?.properties || {};
    const lat = Number(coordinates[1]);
    const lon = Number(coordinates[0]);
    const name = normalize(properties.name);
    const city = normalize(properties.city);
    const district = normalize(properties.district);
    const state = normalize(properties.state);
    const combined = normalize(getFeatureText(properties));

    let score = Number(properties.importance || 0) || 0;
    if (name === queryNorm) score += 8;
    else if (combined.includes(queryNorm)) score += 4;
    if (isAdministrativeFeature(feature, preferredType)) score += 6;
    if (preferredType === 'city' && ['city', 'municipality'].includes(String(properties.osm_value || '').toLowerCase())) score += 3;
    if (preferredType === 'town' && ['town', 'municipality'].includes(String(properties.osm_value || '').toLowerCase())) score += 3;
    if (preferredType === 'village' && ['village', 'municipality'].includes(String(properties.osm_value || '').toLowerCase())) score += 3;
    if (preferredType === 'district' && ['district', 'borough'].includes(String(properties.osm_value || '').toLowerCase())) score += 3;

    return { feature, score, index, lat, lon };
  });

  return scored
    .filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lon))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3)
    .map(({ feature, lat, lon }) => {
      const properties = feature?.properties || {};
      const displayName = [
        properties.name,
        properties.city,
        properties.district,
        properties.state,
        properties.country
      ].filter(Boolean).join(', ') || query;

      return {
        lat: String(lat),
        lon: String(lon),
        display_name: displayName,
        namedetails: properties
      };
    });
}

globalThis.fetch = async (input, init) => {
  const requestUrl = typeof input === 'string' ? input : input?.url || '';

  if (!requestUrl.startsWith('https://nominatim.openstreetmap.org/search')) {
    return originalFetch(input, init);
  }

  const originalUrl = new URL(requestUrl);
  const query = originalUrl.searchParams.get('q') || '';
  if (!query) return originalFetch(input, init);

  const preferredType = detectAdministrativeType(query);
  const photonUrl = new URL(PHOTON_BASE);
  photonUrl.searchParams.set('q', preferredType ? `${query}, Japan` : query);
  photonUrl.searchParams.set('limit', preferredType ? '8' : (originalUrl.searchParams.get('limit') || '3'));
  photonUrl.searchParams.set('lang', 'ja');

  try {
    const response = await originalFetch(photonUrl, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        'Accept': 'application/json',
        'User-Agent': 'inaka-power-chat-map/1.0'
      }
    });

    if (!response.ok) return response;

    const data = await response.json();
    const converted = toNominatimShape(data, query);
    console.log(`Geocoder compatibility: ${preferredType ? `${preferredType} query` : 'general query'} -> Photon query="${query}" results=${converted.length}`);

    return new Response(JSON.stringify(converted), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Geocoder compatibility failed:', error);
    return originalFetch(input, init);
  }
};
