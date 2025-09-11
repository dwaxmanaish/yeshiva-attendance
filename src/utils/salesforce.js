import { Connection, OAuth2 } from 'jsforce';

export function buildOAuth2() {
  return new OAuth2({
    clientId: process.env.SF_CLIENT_ID,
    clientSecret: process.env.SF_CLIENT_SECRET,
    redirectUri: process.env.SF_CALLBACK_URL,
    loginUrl: process.env.SF_LOGIN_URL || 'https://login.salesforce.com'
  });
}

export function getConnectionFromSession(session) {
  const tokens = session.salesforce || {};
  if (tokens.accessToken && tokens.instanceUrl) {
    return new Connection({
      instanceUrl: tokens.instanceUrl,
      accessToken: tokens.accessToken,
      version: process.env.SF_API_VERSION
    });
  }
  return null;
}

export async function authorizeWithCode(code, session) {
  const oauth2 = buildOAuth2();
  const conn = new Connection({ oauth2, version: process.env.SF_API_VERSION });
  const userInfo = await conn.authorize(code);
  session.salesforce = {
    accessToken: conn.accessToken,
    refreshToken: conn.refreshToken,
    instanceUrl: conn.instanceUrl,
    userId: userInfo?.id,
    orgId: userInfo?.organizationId
  };
  return { conn, userInfo };
}

export async function loginWithUserPass(session) {
  const username = process.env.SF_USERNAME;
  const password = process.env.SF_PASSWORD;
  const token = process.env.SF_SECURITY_TOKEN || '';
  if (!username || !password) {
    throw new Error('SF_USERNAME and SF_PASSWORD are required');
  }
  const conn = new Connection({
    loginUrl: process.env.SF_LOGIN_URL || 'https://login.salesforce.com',
    version: process.env.SF_API_VERSION
  });
  await conn.login(username, token ? password + token : password);
  session.salesforce = {
    accessToken: conn.accessToken,
    instanceUrl: conn.instanceUrl
  };
  return conn;
}

export async function identity(conn) {
  return conn.identity();
}

export async function runQuery(conn, soql) {
  return conn.query(soql);
}

export async function ensureConnection(session) {
  const existing = getConnectionFromSession(session);
  if (existing) {
    return existing;
  }
  return loginWithUserPass(session);
}

export async function describeObject(conn, objectName) {
  return conn.sobject(objectName).describe();
}

export async function findClassMeetingFieldInfo(conn) {
  const objectName = 'Yeshiva_Class_Meeting__c';
  const desc = await describeObject(conn, objectName);
  // Find class lookup
  const classLookup = desc.fields.find(f => f.type === 'reference' && (f.referenceTo || []).includes('Yeshiva_Classes__c'))
    || desc.fields.find(f => f.type === 'reference' && /class/i.test(f.name));
  // Find date/datetime field
  const dateField = desc.fields.find(f => f.type === 'date' && /date|start/i.test(f.name))
    || desc.fields.find(f => f.type === 'date')
    || desc.fields.find(f => f.type === 'datetime' && /date|start/i.test(f.name))
    || desc.fields.find(f => f.type === 'datetime');
  return {
    objectName,
    classFieldName: classLookup ? classLookup.name : null,
    dateFieldName: dateField ? dateField.name : null,
    dateFieldType: dateField ? dateField.type : null
  };
}

export async function findAttendanceObjectForMeeting(conn) {
  const global = await conn.describeGlobal();
  const candidates = global.sobjects
    .filter(s => /attendance/i.test(s.name))
    .filter(s => s.queryable)
    .filter(s => !/ChangeEvent$/i.test(s.name))
    .filter(s => !/History$/i.test(s.name))
    .map(s => s.name);
  for (const obj of candidates) {
    try {
      const d = await describeObject(conn, obj);
      const lookup = d.fields.find(f => f.type === 'reference' && (f.referenceTo || []).includes('Yeshiva_Class_Meeting__c'))
        || d.fields.find(f => f.type === 'reference' && /Class_Meeting/i.test(f.name));
      if (lookup) {
        // Try to find student, status, and comments fields by heuristics
        const studentField = d.fields.find(f => f.type === 'reference' && /student/i.test(f.name))
          || d.fields.find(f => f.type === 'reference' && (f.referenceTo || []).includes('Contact'));
        const statusField = d.fields.find(f => /status/i.test(f.name));
        const notesField = d.fields.find(f => /notes|comment/i.test(f.name));
        return {
          objectName: obj,
          meetingLookupField: lookup.name,
          studentFieldName: studentField ? studentField.name : null,
          statusFieldName: statusField ? statusField.name : null,
          notesFieldName: notesField ? notesField.name : null
        };
      }
    } catch (_e) {
      // ignore and continue
    }
  }
  return null;
}
