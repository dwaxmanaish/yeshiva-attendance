import express from 'express';
import {
  buildOAuth2,
  authorizeWithCode,
  getConnectionFromSession,
  loginWithUserPass,
  identity,
  runQuery
} from '../utils/salesforce.js';

const router = express.Router();

router.get('/auth/login', (req, res) => {
  const oauth2 = buildOAuth2();
  const url = oauth2.getAuthorizationUrl({
    scope: 'api refresh_token offline_access id web',
    prompt: 'login consent'
  });
  res.redirect(url);
});

router.get('/auth/callback', async (req, res, next) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).json({ error: 'Missing code' });
    const { userInfo } = await authorizeWithCode(code, req.session);
    res.json({ ok: true, userInfo });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/login-password', async (req, res, next) => {
  try {
    const conn = await loginWithUserPass(req.session);
    const me = await identity(conn);
    res.json({ ok: true, userInfo: me });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/sfdc/whoami', async (req, res, next) => {
  try {
    const { ensureConnection } = await import('../utils/salesforce.js');
    const conn = await ensureConnection(req.session);
    const me = await identity(conn);
    res.json(me);
  } catch (err) {
    next(err);
  }
});

router.get('/sfdc/query', async (req, res, next) => {
  try {
    const soql = req.query.soql;
    if (!soql) return res.status(400).json({ error: 'Missing soql' });
    const { ensureConnection } = await import('../utils/salesforce.js');
    const conn = await ensureConnection(req.session);
    const result = await runQuery(conn, soql);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;

// Fetch Teacher__r.Name from Yeshiva_Classes__c by date range
router.get('/sfdc/teachers/by-year', async (req, res, next) => {
  try {
    const normalize = (value, fallback) => {
      const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
      const isoRe = /^\d{4}-\d{2}-\d{2}$/;
      if (isoRe.test(raw)) return raw;
      const mdyRe = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
      const m = raw.match(mdyRe);
      if (m) {
        const mm = m[1].padStart(2, '0');
        const dd = m[2].padStart(2, '0');
        const yyyy = m[3];
        return `${yyyy}-${mm}-${dd}`;
      }
      return null;
    };

    const start = normalize(req.query.start, '2025-09-01');
    const end = normalize(req.query.end, '2025-12-31');
    if (!start || !end) {
      return res.status(400).json({ error: 'Invalid date. Use YYYY-MM-DD or MM/DD/YYYY' });
    }

    const { ensureConnection } = await import('../utils/salesforce.js');
    const conn = await ensureConnection(req.session);

    const soql = `SELECT Id, Name, Teacher__c, Teacher__r.Name, Start_Date__c, End_Date__c FROM Yeshiva_Classes__c WHERE Start_Date__c >= ${start} AND End_Date__c <= ${end}`;
    const result = await runQuery(conn, soql);

    const groupsMap = new Map();
    for (const rec of result.records) {
      const teacherId = rec.Teacher__c;
      const teacherName = rec?.Teacher__r?.Name || null;
      if (!teacherId || !teacherName) continue;
      if (!groupsMap.has(teacherId)) {
        groupsMap.set(teacherId, { id: teacherId, name: teacherName, classes: [] });
      }
      groupsMap.get(teacherId).classes.push({
        id: rec.Id,
        name: rec.Name,
        startDate: rec.Start_Date__c,
        endDate: rec.End_Date__c
      });
    }

    const teacherGroups = Array.from(groupsMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    res.json({ start, end, teacherGroups });
  } catch (err) {
    next(err);
  }
});

// Attendance by class meeting: provide classId and start date to locate meeting
router.get('/sfdc/attendance/by-meeting', async (req, res, next) => {
  try {
    const meetingIdOverride = typeof req.query.meetingId === 'string' ? req.query.meetingId.trim() : '';
    const classId = typeof req.query.classId === 'string' ? req.query.classId.trim() : '';
    const classFieldOverride = typeof req.query.classField === 'string' ? req.query.classField.trim() : '';
    const dateFieldOverride = typeof req.query.dateField === 'string' ? req.query.dateField.trim() : '';
    const normalize = (value) => {
      const raw = typeof value === 'string' && value.trim() ? value.trim() : '';
      const isoRe = /^\d{4}-\d{2}-\d{2}$/;
      if (isoRe.test(raw)) return raw;
      const mdyRe = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
      const m = raw.match(mdyRe);
      if (m) {
        const mm = m[1].padStart(2, '0');
        const dd = m[2].padStart(2, '0');
        const yyyy = m[3];
        return `${yyyy}-${mm}-${dd}`;
      }
      return '';
    };
    const start = normalize(req.query.start);

    if (!meetingIdOverride && (!classId || !start)) {
      return res.status(400).json({ error: 'Provide meetingId OR (classId and start in YYYY-MM-DD or MM/DD/YYYY)' });
    }

    const { ensureConnection } = await import('../utils/salesforce.js');
    const conn = await ensureConnection(req.session);

    let meeting = null;
    let usedMeetingFields = null;
    let meetingInfo = null;
    if (meetingIdOverride) {
      // Direct meeting lookup
      const r = await runQuery(conn, `SELECT Id, Name FROM Yeshiva_Class_Meeting__c WHERE Id = '${meetingIdOverride}' LIMIT 1`);
      meeting = r.totalSize > 0 ? { id: r.records[0].Id, name: r.records[0].Name } : null;
      usedMeetingFields = { via: 'meetingId' };
    } else {
      // First try exact field names per spec
      if (classId && start) {
        const exactSoql = `SELECT Id, Name FROM Yeshiva_Class_Meeting__c WHERE Yeshiva_Classes__c = '${classId}' AND Class_Start_Date__c = ${start} LIMIT 1`;
        try {
          const r = await runQuery(conn, exactSoql);
          if (r.totalSize > 0) {
            meeting = { id: r.records[0].Id, name: r.records[0].Name };
            usedMeetingFields = { classField: 'Yeshiva_Classes__c', dateField: 'Class_Start_Date__c', dateType: 'date', via: 'exact' };
          }
        } catch (_e) {
          // ignore; will fallback to discovery
        }
      }

      // Describe to find actual field names/types (unless overridden or already found)
      const { findClassMeetingFieldInfo } = await import('../utils/salesforce.js');
      if (!meeting) {
        const discovered = await findClassMeetingFieldInfo(conn);
        meetingInfo = discovered;
        const classFieldName = classFieldOverride || discovered.classFieldName;
        const dateFieldName = dateFieldOverride || discovered.dateFieldName;
        const dateFieldType = discovered.dateFieldType;
        if (!classFieldName || !dateFieldName) {
          return res.status(500).json({ error: 'Unable to discover class meeting fields', discovered });
        }
        // Build predicate for date vs datetime
        const datePredicate = dateFieldType === 'datetime'
          ? `DAY_ONLY(${dateFieldName}) = ${start}`
          : `${dateFieldName} = ${start}`;

        const meetingSoql = `SELECT Id, Name FROM ${discovered.objectName} WHERE ${classFieldName} = '${classId}' AND ${datePredicate} LIMIT 1`;
        const meetingResp = await runQuery(conn, meetingSoql);
        meeting = meetingResp.totalSize > 0 ? { id: meetingResp.records[0].Id, name: meetingResp.records[0].Name } : null;
        usedMeetingFields = { classField: classFieldName, dateField: dateFieldName, dateType: dateFieldType, via: 'discovered' };
      }
    }

    if (!meeting) {
      return res.status(404).json({ error: 'Class meeting not found', classId, start, meetingInfo, usedMeetingFields });
    }

    // Detect attendance object and lookup field using describe
    const { findAttendanceObjectForMeeting } = await import('../utils/salesforce.js');
    const attendanceInfo = await findAttendanceObjectForMeeting(conn);
    const attendanceObject = attendanceInfo ? attendanceInfo.objectName : null;
    const attendanceLookupField = attendanceInfo ? attendanceInfo.meetingLookupField : null;

    if (!attendanceObject) {
      return res.status(404).json({
        error: 'Attendance object not found via common candidates',
        meeting,
        usedMeetingFields
      });
    }

    // Build dynamic select for attendance using discovered fields
    // Force Student__c per request
    let studentField = 'Student__c';
    const statusField = attendanceInfo && attendanceInfo.statusFieldName ? attendanceInfo.statusFieldName : null;
    const notesField = attendanceInfo && attendanceInfo.notesFieldName ? attendanceInfo.notesFieldName : null;

    // No detection needed since Student__c is explicitly requested

    const selectParts = ['Id', 'Name'];
    if (studentField) {
      selectParts.push(studentField);
    }
    if (statusField) selectParts.push(statusField);
    if (notesField) selectParts.push(notesField);

    const baseSelect = `SELECT ${selectParts.join(', ')} FROM ${attendanceObject} WHERE ${attendanceLookupField} = '${meeting.id}'`;
    let attendance = [];
    try {
      let r = await runQuery(conn, baseSelect);

      const records = r.records || [];
      const contactIdRegex = /^003[0-9A-Za-z]{12}(?:[0-9A-Za-z]{3})?$/; // Contact keyprefix 003
      const anchorRe = /<a[^>]*href=["']\/(003[0-9A-Za-z]{12}(?:[0-9A-Za-z]{3})?)["'][^>]*>([^<]+)<\/a>/i;

      // Parse student raw value into {id, name} when possible
      const parsedStudents = records.map(rec => {
        const raw = studentField ? rec[studentField] : undefined;
        if (typeof raw !== 'string') return { id: undefined, name: undefined };
        const m = raw.match(anchorRe);
        if (m) {
          return { id: m[1], name: m[2] };
        }
        if (contactIdRegex.test(raw)) {
          return { id: raw, name: undefined };
        }
        // Fallback: treat as name string with no id
        return { id: undefined, name: raw };
      });

      const contactIds = Array.from(new Set(parsedStudents
        .map(p => p.id)
        .filter(id => typeof id === 'string' && contactIdRegex.test(id))));

      const contactIdToName = new Map();
      if (contactIds.length > 0) {
        // Chunk IN queries to avoid overly long SOQL
        const chunkSize = 100;
        for (let i = 0; i < contactIds.length; i += chunkSize) {
          const chunk = contactIds.slice(i, i + chunkSize);
          const idsList = chunk.map(id => `'${id}'`).join(',');
          const q = `SELECT Id, Name FROM Contact WHERE Id IN (${idsList})`;
          try {
            const cr = await runQuery(conn, q);
            for (const c of cr.records || []) {
              contactIdToName.set(c.Id, c.Name);
            }
          } catch (_e) {
            // ignore chunk errors
          }
        }
      }

      attendance = records.map((rec, idx) => {
        const parsed = parsedStudents[idx] || { id: undefined, name: undefined };
        const sid = parsed.id;
        const sname = parsed.name || (sid && contactIdToName.has(sid) ? contactIdToName.get(sid) : undefined);
        return {
          id: rec.Id,
          name: rec.Name,
          studentId: sid,
          studentName: sname,
          status: statusField ? rec[statusField] : undefined,
          comments: notesField ? rec[notesField] : undefined
        };
      });
    } catch (_e) {
      const r = await runQuery(conn, `SELECT Id FROM ${attendanceObject} WHERE ${attendanceLookupField} = '${meeting.id}'`);
      attendance = r.records.map(rec => ({ id: rec.Id }));
    }

    res.json({
      classId,
      start,
      meeting,
      attendance
    });
  } catch (err) {
    next(err);
  }
});
