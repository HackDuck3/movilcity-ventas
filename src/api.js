'use strict';
const { routes, HttpError } = require('./http');

require('./routes/session');
require('./routes/categories');
require('./routes/movements');
require('./routes/invoices');
require('./routes/repairs');
require('./routes/customers');
require('./routes/stock');
require('./routes/purchases');
require('./routes/notices');
require('./routes/search');
require('./routes/stats');
require('./routes/quarter');
require('./routes/settings');
require('./routes/users');
require('./routes/data');
require('./routes/backup');
require('./routes/files');

module.exports = { routes, HttpError };
