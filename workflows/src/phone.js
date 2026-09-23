/**
 * Country-aware phone normalisation to E.164.
 *
 * The Pakistan pipeline assumed every number was Pakistani: a leading 0 became
 * +92. Applied to a London number that turns 020 7946 0958 into a nonsense
 * Pakistani number that looks perfectly valid, so this has to be explicit
 * before any non-PK market is added.
 *
 * Dependency-free: inlined into n8n Code nodes, which have no module system.
 */

/**
 * Per-country rules.
 *   cc          international dialling code
 *   natLen      valid lengths after the country code
 *   trunk       national trunk prefix stripped before adding the cc
 *   mobile      matches the E.164 form of a mobile number, where the country
 *               distinguishes them. North America does not.
 */
const RULES = {
  PK: {
    cc: '92',
    natLen: [9, 10],
    trunk: '0',
    mobile: /^\+923\d{9}$/,
  },
  GB: {
    cc: '44',
    natLen: [9, 10],
    trunk: '0',
    // 07xxx numbers are mobiles, and WhatsApp is widely used on them in the UK.
    mobile: /^\+447\d{9}$/,
  },
  US: {
    cc: '1',
    natLen: [10],
    trunk: '1',
    // The North American Numbering Plan gives mobiles no distinct prefix, so a
    // number cannot be classified from its digits alone. Never claim mobile.
    mobile: null,
  },
};

/** Strip everything that is not a digit or a leading plus. */
function digits(raw) {
  // Extension markers would otherwise be glued onto the number.
  const s = String(raw == null ? '' : raw).split(/\b(?:ext|x|extn)\b/i)[0];
  return s.replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
}

/**
 * @param {string} raw      the number as published
 * @param {string} country  ISO-ish key into RULES (PK, GB, US)
 * @returns {string} E.164, or '' when it cannot be trusted
 *
 * `country` must be right. A bare national number carries no evidence of where
 * it is from: `020 7946 0958` (London) and `042 3576 1234` (Lahore) are both
 * eleven digits behind a trunk zero, so no amount of inspection separates them.
 * The pipeline supplies the country from the city it queried, which is reliable.
 *
 * What this does guarantee is that a number written in explicit international
 * form for a *different* country is rejected rather than mangled — so a
 * `+44…` found on a page during a Pakistani sweep is dropped, not turned into
 * a plausible-looking Pakistani number.
 */
function toE164(raw, country) {
  const rule = RULES[country];
  if (!rule || !raw) return '';

  // Tags often hold several numbers; take the first.
  let s = digits(String(raw).split(/[;,/]|\bor\b/i)[0]);
  if (!s) return '';

  const cc = rule.cc;

  if (s.startsWith('+')) {
    // Already international. Accept only if it belongs to this country.
    if (!s.startsWith('+' + cc)) return '';
    s = '+' + cc + s.slice(1 + cc.length);
  } else if (s.startsWith('00' + cc)) {
    s = '+' + cc + s.slice(2 + cc.length);
  } else if (s.startsWith(cc) && rule.natLen.some((n) => s.length === cc.length + n)) {
    s = '+' + s;
  } else if (rule.trunk && s.startsWith(rule.trunk) &&
             rule.natLen.some((n) => s.length === rule.trunk.length + n)) {
    s = '+' + cc + s.slice(rule.trunk.length);
  } else if (rule.natLen.includes(s.length)) {
    s = '+' + cc + s;
  } else {
    return '';
  }

  const national = s.slice(1 + cc.length);
  if (!rule.natLen.includes(national.length)) return '';
  if (!/^\+\d+$/.test(s)) return '';
  return s;
}

/**
 * True only when the country's numbering plan actually identifies the number as
 * a mobile. Returns false for the US rather than guessing — an unreachable
 * WhatsApp link is worse than no link.
 */
function isMobile(e164, country) {
  const rule = RULES[country];
  if (!rule || !rule.mobile || !e164) return false;
  return rule.mobile.test(e164);
}

/** Country a bare E.164 number belongs to, or '' if unrecognised. */
function countryOf(e164) {
  const s = String(e164 || '');
  if (/^\+92\d{9,10}$/.test(s)) return 'PK';
  if (/^\+44\d{9,10}$/.test(s)) return 'GB';
  if (/^\+1\d{10}$/.test(s)) return 'US';
  return '';
}

module.exports = { toE164, isMobile, countryOf, RULES };
