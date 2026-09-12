/*
 * Firestoreの地域ポイント・交換データを短時間キャッシュし、
 * 交換UIがFirestoreの往復待ちで固まらないようにします。
 * GETとPATCHで同じドキュメントキーを共有し、交換後の状態が古いキャッシュへ戻らないようにします。
 * PATCHはローカルキャッシュを即時更新してUIへ返し、Firestoreへの保存はユーザー単位・ドキュメント単位で順番に実行します。
 */
const originalFetch = globalThis.fetch;
const cache = new Map();
const writeQueues = new Map();

function getCacheKey(url) {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    return parsed.toString();
  } catch {
    return String(url).split('?')[0];
  }
}

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

async function rememberGet(url, init, cacheKey) {
  const response = await originalFetch(url, init);
  if (!response.ok) return response;

  const data = await response.clone().json().catch(() => null);
  if (data?.fields) cache.set(cacheKey, data);
  return response;
}

async function enqueueFirestoreWrite(url, init, optimisticData, cacheKey) {
  const previous = writeQueues.get(cacheKey) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const response = await originalFetch(url, init);
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        cache.delete(cacheKey);
        throw new Error(`Firestore background write failed: ${response.status} ${body.slice(0, 300)}`);
      }

      const data = await response.clone().json().catch(() => null);
      if (data?.fields) cache.set(cacheKey, data);
      return response;
    })
    .catch(error => {
      console.error(error.message);
      return null;
    });

  writeQueues.set(cacheKey, next);
  cache.set(cacheKey, optimisticData);
  await Promise.resolve();
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (!isRegionalPointsDocument(url)) return originalFetch(input, init);

  const cacheKey = getCacheKey(url);
  const method = String(init?.method || (typeof input === 'object' ? input?.method : '') || 'GET').toUpperCase();

  if (method === 'GET') {
    const cached = cache.get(cacheKey);
    if (cached) return cloneJsonResponse(cached, 200);
    return rememberGet(url, init, cacheKey);
  }

  if (method === 'PATCH' || method === 'PUT') {
    let body = null;
    try {
      body = JSON.parse(init?.body || '{}');
    } catch {
      return originalFetch(input, init);
    }
    if (!body?.fields) return originalFetch(input, init);

    const current = cache.get(cacheKey);
    if (!current) {
      // 既存状態をまだ取得していない初回PATCHはFirestoreへ保存し、その結果をキャッシュします。
      return originalFetch(input, init).then(async response => {
        if (response.ok) {
          const data = await response.clone().json().catch(() => null);
          if (data?.fields) cache.set(cacheKey, data);
        }
        return response;
      });
    }

    const optimisticData = {
      ...current,
      fields: mergeFields(current.fields, body.fields)
    };

    void enqueueFirestoreWrite(url, init, optimisticData, cacheKey);
    return cloneJsonResponse(optimisticData, 200);
  }

  return originalFetch(input, init);
};

console.log('Firestore fast cache enabled for regional points data.');
