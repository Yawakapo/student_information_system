const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, '../process.env'), quiet: true });
