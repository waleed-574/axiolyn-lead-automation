/**
 * Offline tests for the plain-language business type labels.
 *
 *   node scripts/test-business-type.js
 */
const { businessType } = require('../workflows/src/business-type');

let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (expected "${expected}", got "${actual}")`}`);
  if (!ok) failed++;
}

console.log('the categories your team actually asked about');
check('law', businessType('office:lawyer'), 'Law firm');
check('food', businessType('amenity:restaurant'), 'Restaurant');
check('medical', businessType('healthcare:hospital'), 'Hospital');
check('clinic', businessType('amenity:clinic'), 'Medical clinic');

console.log('');
console.log('the highest-volume categories in the data');
check('wholesale', businessType('shop:wholesale'), 'Wholesaler');
check('education', businessType('office:educational_institution'), 'Education provider');
check('car repair', businessType('shop:car_repair'), 'Car repair garage');
check('travel', businessType('shop:travel_agency'), 'Travel agency');
check('IT keeps its capitals', businessType('office:it'), 'IT company');
check('estate agency', businessType('office:estate_agent'), 'Estate agency');
check('accountancy', businessType('office:accountant'), 'Accountancy firm');
check('pharmacy', businessType('healthcare:pharmacy'), 'Pharmacy');

console.log('');
console.log('the long tail is derived, not left blank');
// 180 distinct categories appear in the data, so unmapped ones are certain.
check('derives an unmapped tag', businessType('shop:pet_grooming'), 'Pet grooming');
check('derives another', businessType('craft:blacksmith'), 'Blacksmith');
check('handles a bare group', businessType('office:yes'), 'Office (unspecified)');

console.log('');
console.log('nothing useful yields an honest label, not a guess');
check('empty', businessType(''), 'Unclassified');
check('literal other', businessType('other'), 'Unclassified');
check('null', businessType(null), 'Unclassified');

console.log('');
console.log('public bodies stay visible as such');
check('government', businessType('office:government'), 'Government office');
check('diplomatic', businessType('office:diplomatic'), 'Diplomatic mission');

console.log('');
console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
