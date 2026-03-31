const rawApiBase = import.meta.env.VITE_API_BASE?.trim();

export const API_BASE = (rawApiBase || 'https://my-smart-grocery-api.onrender.com').replace(/\/+$/, '');

export const ENABLE_KEEPALIVE = import.meta.env.VITE_ENABLE_KEEPALIVE
  ? import.meta.env.VITE_ENABLE_KEEPALIVE === 'true'
  : import.meta.env.PROD;
