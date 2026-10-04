'use strict';
const { get, run } = require('./db');
const { DEFAULT_SETTINGS } = require('./defaults');

// Each settings group is one JSON row. Stored values are merged over the
// defaults so options added in a newer version appear automatically.
function getSetting(key) {
  const defaults = DEFAULT_SETTINGS[key];
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return defaults ? structuredClone(defaults) : null;
  return { ...defaults, ...JSON.parse(row.value) };
}

function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, JSON.stringify(value));
}

function allSettings() {
  return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key => [key, getSetting(key)]));
}

module.exports = { getSetting, setSetting, allSettings };
