const text = value => String(value ?? '').trim();

const isValidEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value).toLowerCase());
const isValidUsername = value => /^[A-Za-z0-9][A-Za-z0-9 ._-]{2,29}$/.test(text(value));

module.exports = { isValidEmail, isValidUsername };
