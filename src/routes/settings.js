'use strict';
const { DEFAULT_SETTINGS } = require('../defaults');
const { getSetting, setSetting, allSettings } = require('../settings');
const { route, fail } = require('../http');
const { str, isColor } = require('../utils');

const MAX_LOGO_LENGTH = 1_500_000;
const LONG_TEXT_FIELDS = ['conditions'];
const isColorField = (field) => field.startsWith('color') || field === 'primary' || field === 'accent';

// Coerces an incoming value to the type of its default. Returns undefined to keep the current value.
function sanitize(field, value, defaultValue) {
  if (typeof defaultValue === 'boolean') return !!value;
  if (typeof defaultValue === 'number') return Number.isFinite(Number(value)) ? Number(value) : undefined;
  if (field === 'warranties') {
    return (Array.isArray(value) ? value : [])
      .map(w => ({ name: str(w && w.name, 60), text: str(w && w.text, 300) }))
      .filter(w => w.name);
  }
  if (Array.isArray(defaultValue)) return (Array.isArray(value) ? value : []).map(item => str(item, 40)).filter(Boolean);
  if (field === 'logo') {
    const isImage = typeof value === 'string' && (value === '' || value.startsWith('data:image/'));
    return isImage ? value.slice(0, MAX_LOGO_LENGTH) : undefined;
  }
  if (isColorField(field)) return isColor(value) ? value : undefined;
  return str(value, LONG_TEXT_FIELDS.includes(field) ? 5000 : 300);
}

route('GET', '/api/admin/settings', 'admin', () => allSettings());

route('PUT', '/api/admin/settings/:key', 'admin', ({ params, body }) => {
  const defaults = DEFAULT_SETTINGS[params.key];
  if (!defaults) fail(404, 'Ajuste desconocido');
  const next = getSetting(params.key);
  for (const field of Object.keys(defaults)) {
    if (!(field in body)) continue;
    const value = sanitize(field, body[field], defaults[field]);
    if (value !== undefined) next[field] = value;
  }
  setSetting(params.key, next);
  return next;
});
