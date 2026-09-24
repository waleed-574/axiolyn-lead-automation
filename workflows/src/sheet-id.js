/**
 * Accepts a spreadsheet id or a full Google Sheets URL and returns the id.
 *
 * Pasting the URL is the natural thing to do when copying from the browser,
 * and the failure it caused was needlessly obscure: the Sheets API answers a
 * malformed id with 404 "Requested entity was not found", which reads like the
 * sheet was deleted rather than like the id was wrong.
 */

/**
 * @param {string} value  an id, or any Google Sheets URL containing one
 * @returns {string} the bare spreadsheet id, or '' if none can be found
 */
function parseSheetId(value) {
  const s = String(value == null ? '' : value).trim().replace(/^["']|["']$/g, '');
  if (!s) return '';

  // .../spreadsheets/d/<id>/edit#gid=0
  const fromUrl = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl) return fromUrl[1];

  // Already an id. Google's are 40+ chars of [A-Za-z0-9-_]; anything with a
  // slash, space or dot is a mangled paste rather than an id.
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;

  return '';
}

module.exports = { parseSheetId };
