// In-memory store for M0-V9 verification. Production uses the Postgres
// repository in src/store/postgres.js with identical methods.
export function createMemoryStore() {
  const runs = new Map();
  const records = [];
  const priceRows = [];
  const auditEvents = [];
  const calendarDays = new Map();
  const qualityReports = [];
  const complianceDocs = new Map();
  const apiKeys = new Map();

  return {
    saveRun(run) {
      runs.set(run.source_id, { ...run, updated_at: new Date().toISOString() });
    },
    getRun(sourceId) {
      return runs.get(sourceId) || null;
    },
    listRuns() {
      return Array.from(runs.values());
    },
    saveRecord(record) {
      const row = { ...record, id: `rec_${records.length + 1}` };
      records.push(row);
      return row;
    },
    listRecords() {
      return records.slice();
    },
    savePriceRows(rows) {
      let inserted = 0;
      let updated = 0;
      for (const row of rows) {
        const idx = priceRows.findIndex(
          (p) => p.ticker === row.ticker && p.exchange === row.exchange && p.trade_date === row.trade_date
        );
        if (idx >= 0) {
          priceRows[idx] = { ...priceRows[idx], ...row };
          updated += 1;
        } else {
          priceRows.push(row);
          inserted += 1;
        }
      }
      return { inserted, updated };
    },
    listPriceRows(ticker) {
      return ticker ? priceRows.filter((p) => p.ticker === ticker) : priceRows.slice();
    },
    saveAuditEvent(event) {
      const row = { ...event, id: `audit_${auditEvents.length + 1}`, ts: new Date().toISOString() };
      auditEvents.push(row);
      return row;
    },
    listAuditEvents() {
      return auditEvents.slice();
    },
    saveCalendarDays(days) {
      let inserted = 0;
      for (const d of days) {
        if (!calendarDays.has(d.calendar_date)) inserted += 1;
        calendarDays.set(d.calendar_date, { ...calendarDays.get(d.calendar_date), ...d });
      }
      return { inserted, total: calendarDays.size };
    },
    listCalendarDays(start, end) {
      return Array.from(calendarDays.values())
        .filter((d) => (!start || d.calendar_date >= start) && (!end || d.calendar_date <= end))
        .sort((a, b) => a.calendar_date.localeCompare(b.calendar_date));
    },
    getCalendarStatus() {
      const days = Array.from(calendarDays.values());
      return {
        count: days.length,
        source: days[0]?.source || null,
        is_verified: days[0]?.is_verified || false,
        retrieved_at: days[0]?.retrieved_at || null,
        confidence: days[0]?.confidence ?? null
      };
    },
    saveQualityReport(report) {
      const row = { ...report, id: `quality_${qualityReports.length + 1}` };
      qualityReports.push(row);
      return row;
    },
    listQualityReports() {
      return qualityReports.slice();
    },
    saveComplianceDoc(doc) {
      const key = `${doc.type}:${doc.version}`;
      const row = { ...doc, id: `doc_${complianceDocs.size + 1}`, effective_at: doc.effective_at || new Date().toISOString() };
      complianceDocs.set(key, row);
      return row;
    },
    getComplianceDoc(type, version) {
      if (version) return complianceDocs.get(`${type}:${version}`) || null;
      const all = Array.from(complianceDocs.values()).filter((d) => d.type === type);
      if (!all.length) return null;
      all.sort((a, b) => (a.effective_at < b.effective_at ? 1 : -1));
      return all[0];
    },
    listComplianceDocs(type) {
      return Array.from(complianceDocs.values())
        .filter((d) => !type || d.type === type)
        .sort((a, b) => a.type.localeCompare(b.type) || a.effective_at.localeCompare(b.effective_at));
    },
    saveApiKey(key) {
      const row = { ...key, id: key.id || `key_${apiKeys.size + 1}`, created_at: new Date().toISOString() };
      apiKeys.set(row.id, row);
      return row;
    },
    getApiKey(id) {
      return apiKeys.get(id) || null;
    },
    listApiKeys() {
      return Array.from(apiKeys.values());
    }
  };
}
