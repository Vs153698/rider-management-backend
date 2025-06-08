const axios = require('axios');

const cashfreeConfig = {
  appId: process.env.CASHFREE_APP_ID,
  secretKey: process.env.CASHFREE_SECRET_KEY,
  baseUrl: process.env.CASHFREE_BASE_URL || 'https://sandbox.cashfree.com/pg',
  version: '2023-08-01'
};

const createCashfreeHeaders = () => ({
  'accept': 'application/json',
  'content-type': 'application/json',
  'x-api-version': cashfreeConfig.version,
  'x-client-id': cashfreeConfig.appId,
  'x-client-secret': cashfreeConfig.secretKey
});

const cashfreeAPI = axios.create({
  baseURL: cashfreeConfig.baseUrl,
  headers: createCashfreeHeaders()
});

module.exports = {
  cashfreeConfig,
  cashfreeAPI,
  createCashfreeHeaders
};