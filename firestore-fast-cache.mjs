/*
 * Firestoreの地域ポイント・交換データを短時間キャッシュし、
 * 交換UIがFirestoreの往復待ちで固まらないようにします。
 * PATCHはローカルキャッシュを即時更新してUIへ返し、実際のFirestore保存は順番にバックグラウンドで実行します。
 */
const originalFetch = globalThis.fetch;
const cache = new Map();
const writeQueues = new Map();

function isRegionalPointsDocument(url) {
  return /^https:\/\/firestore\.googleapis\.com\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents\/regionalPoints\/[^/?]+(?:\?.*)?$/u.test(url);
}

function cloneJsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function mergeFields(base = {}, patch = {}) {
  return { ...base, ...patch };
}

async function rememberGet(url, init) {
  const response = await originalFetch(url, init);
  if (!response.ok) return response;

  const data = await response.clone().json().catch(() => null);
  if (data?.fields) cache.set(url, data);
  return response;
}

async function enqueueFirestoreWrite(url, init, optimisticData) {
  const previous = writeQueues.get(url) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const response = await originalFetch(url, init);
      if (!response.ok) {
        cache.delete(url);
        const body = await response.text().catch(() => '');
        throw new Error(`Firestore background write failed: ${response.status} ${body.slice(0, 300)}`);
      }
      return response;
    })
    .catch(error => {
      console.error(error.message);
      return null;
    });

  writeQueues.set(url, next);
  cache.set(url, optimisticData);
  await Promise.resolve();
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (!isRegionalPointsDocument(url)) return originalFetch(input, init);

  const method = String(init?.method || (typeof input === 'object' ? input?.method : '') || 'GET').toUpperCase();

  if (method === 'GET') {
    const cached = cache.get(url);
    if (cached) return cloneJsonResponse(cached, 200);
    return rememberGet(url, init);
  }

  if (method === 'PATCH' || method === 'PUT') {
    let body = null;
    try { body = JSON.parse(init?.body || '{}'); } catch { return originalFetch(input, init); }
    if (!body?.fields) return originalFetch(input, init);

    const current = cache.get(url);
    if (!current) {
      // 既存状態を知らない初回PATCHは、整合性を優先して通常のFirestore処理を行います。
      return originalFetch(input, init).then(async response => {
        if (response.ok) {
          const data = await response.clone().json().catch(() => null);
          if (data?.fields) cache.set(url, data);
        }
        return response;
      });
    }

    const optimisticData = {
      ...current,
      fields: mergeFields(current.fields, body.fields)
    };

    void enqueueFirestoreWrite(url, init, optimisticData);
    return cloneJsonResponse(optimisticData, 200);
  }

  return originalFetch(input, init);
};

console.log('Firestore fast cache enabled for regional points data.');
