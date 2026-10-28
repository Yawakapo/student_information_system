/* Passwords.
 *
 * STRIPPED FOR THE PANEL DEMO. Hashing is switched off here on purpose.
 *
 * WHAT WAS REMOVED
 *   New accounts are no longer hashed. hashPassword used to run bcrypt and
 *   store something like $2b$12$... . It now returns the password exactly as
 *   typed, so the database holds readable text.
 *
 * WHAT IS STILL HERE, AND WHY
 *   verifyPassword still recognises an old bcrypt hash. Six accounts in the
 *   database were created while hashing was on, so their passwords are
 *   stored as hashes. Without this branch those six accounts would stop being
 *   able to sign in. Remove this file when you switch hashing back on and the
 *   branch goes with it.
 *
 * TO PUT HASHING BACK
 *   1. restore line 5 below to  bcrypt.hash(String(password), 12)
 *   2. delete the whole verifyPassword function and use bcrypt.compare
 *   3. re-save the passwords of the six existing accounts, because they are
 *      still stored as hashes
 *
 * Only safe while the system runs on one machine with no internet. Anyone who
 * can open the database can read every password.
 */

const BCRYPT_PATTERN = /^\$2[aby]\$/;

/* Stores the password as typed. */
const hashPassword = (password) => Promise.resolve(String(password));

const isBcryptHash = (value) => BCRYPT_PATTERN.test(String(value || ''));

/* A password typed at the sign-in box has to match what is stored. Two forms
   are accepted: plain text, which is what new accounts hold, and an old
   bcrypt hash, which is what the accounts made before the switch hold. */
const verifyPassword = async (storedPassword, suppliedPassword) => {
  const stored = String(storedPassword || '');
  const supplied = String(suppliedPassword || '');
  if (isBcryptHash(stored)) {
    const bcrypt = require('bcrypt');
    return bcrypt.compare(supplied, stored);
  }
  return stored === supplied;
};

const needsPasswordRehash = (storedPassword) => !isBcryptHash(storedPassword);

module.exports = { hashPassword, isBcryptHash, needsPasswordRehash, verifyPassword };