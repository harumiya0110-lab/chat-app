import crypto from 'node:crypto';

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const targetUsername = String(process.env.POINTS_GRANT_USERNAME || '').trim();
const grantAmount = Math.floor(Number(process.env.POINTS_GRANT_AMOUNT || 0));
const grantId = String(process.env.POINTS_GRANT_ID || '').trim();

if (!rawServiceAccount || !targetUsername || !Number.isFinite(grantAmount) || grantAmount <= 0 || !grantId) {
  export default Promise.resolve();
} else {
  const run = async () => {
    const serviceAccount = JSON.parse(rawServiceAccount);
    const projectId = String(serviceAccount.project_id || '').trim();
    if (!serviceAccount.client_email || !serviceAccount.private_key || !projectId) throw new Error('service account is incomplete');

    const base64Url = value => Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const firestoreValue = value => Number.isInteger(value) ? { integerValue: String(value) } : { stringValue: String(value) };
    const fromFirestore = value => {
      if (value && 'integerValue' in value) return Number(value.integerValue);
      if (value && 'stringValue' in value) return value.stringValue;
      if (value && 'arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestore);
      return null;
    };

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    };
    const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    const assertion = `${unsigned}.${base64Url(signer.sign(serviceAccount.private_key))}`;

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
    });
    if (!tokenResponse.ok) throw new Error(`OAuth failed: ${tokenResponse.status}`);
    const { access_token: accessToken } = await tokenResponse.json();

    const docId = encodeURIComponent(targetUsername);
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/regionalPoints/${docId}`;
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

    const getResponse = await fetch(url, { headers });
    let fields = {};
    if (getResponse.ok) {
      const current = await getResponse.json();
      fields = current.fields || {};
    } else if (getResponse.status !== 404) {
      throw new Error(`Firestore GET failed: ${getResponse.status}`);
    }

    const grants = Array.isArray(fields.manualTestGrants?.arrayValue?.values)
      ? fields.manualTestGrants.arrayValue.values.map(fromFirestore).filter(Boolean)
      : [];
    if (grants.includes(grantId)) {
      console.log(`[points-grant] already applied id=${grantId} user=${targetUsername}`);
      return;
    }

    const currentPoints = Number(fields.points?.integerValue || fields.points?.doubleValue || 0);
    const newPoints = Math.max(0, Math.floor(currentPoints)) + grantAmount;
    const nextGrants = [...new Set([...grants, grantId])].slice(-20);

    const patchResponse = await fetch(`${url}?updateMask.fieldPaths=points&updateMask.fieldPaths=username&updateMask.fieldPaths=manualTestGrants`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        fields: {
          username: { stringValue: targetUsername },
          points: firestoreValue(newPoints),
          manualTestGrants: { arrayValue: { values: nextGrants.map(item => ({ stringValue: item })) } }
        }
      })
    });
    if (!patchResponse.ok) {
      const body = await patchResponse.text().catch(() => '');
      throw new Error(`Firestore PATCH failed: ${patchResponse.status} ${body.slice(0, 300)}`);
    }

    console.log(`[points-grant] applied +${grantAmount} user=${targetUsername} total=${newPoints} id=${grantId}`);
  };

  await run().catch(error => console.error('[points-grant] failed:', error.message));
}
