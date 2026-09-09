const originalFetch = globalThis.fetch;
const PHOTON_BASE = 'https://photon.komoot.io/api/';

function toNominatimShape(data, query) {
  const features = Array.isArray(data?.features) ? data.features : [];
  return features.slice(0, 3).map((feature) => {
    const coordinates = feature?.geometry?.coordinates || [];
    const properties = feature?.properties || {};
    const lat = Number(coordinates[1]);
    const lon = Number(coordinates[0]);
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
  }).filter((item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)));
}

globalThis.fetch = async (input, init) => {
  const requestUrl = typeof input === 'string' ? input : input?.url || '';

  if (!requestUrl.startsWith('https://nominatim.openstreetmap.org/search')) {
    return originalFetch(input, init);
  }

  const originalUrl = new URL(requestUrl);
  const query = originalUrl.searchParams.get('q') || '';
  if (!query) return originalFetch(input, init);

  const photonUrl = new URL(PHOTON_BASE);
  photonUrl.searchParams.set('q', query);
  photonUrl.searchParams.set('limit', originalUrl.searchParams.get('limit') || '3');
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
    console.log(`Geocoder compatibility: Nominatim -> Photon query="${query}" results=${converted.length}`);

    return new Response(JSON.stringify(converted), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Geocoder compatibility failed:', error);
    return originalFetch(input, init);
  }
};
