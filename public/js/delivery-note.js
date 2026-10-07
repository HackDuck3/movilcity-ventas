// Turns the text of a supplier's delivery note into phones for the stock.
// The text can be typed, pasted from a PDF or copied from a photo (phones can copy text out of pictures).

const IMEI_RUN = /(?:\b\d{15}\b[\s,.;=]*)+/g;
const PRICE = /(\d{1,5}(?:[.,]\d{1,2})?)\s*€/g;
const KNOWN_BRANDS = ['Samsung', 'Apple', 'iPhone', 'Xiaomi', 'Redmi', 'Poco', 'Realme', 'Oppo', 'Motorola', 'Huawei', 'Honor',
  'Nokia', 'TCL', 'ZTE', 'Vivo', 'OnePlus', 'Google', 'Alcatel', 'Blackview', 'Ulefone', 'Doogee', 'Infinix', 'Tecno'];

const toNumber = (text) => Number(text.replace(',', '.'));
const titleCase = (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

// "2 SAMSUNG GALAXY A17 5G BLACK=" → { brand: 'Samsung', model: 'GALAXY A17 5G BLACK' }
function splitBrandAndModel(description) {
  const words = description.split(/\s+/).filter(Boolean);
  const brand = KNOWN_BRANDS.find(known => known.toLowerCase() === (words[0] || '').toLowerCase());
  return brand ? { brand, model: words.slice(1).join(' ') } : { brand: titleCase(words[0] || ''), model: words.slice(1).join(' ') };
}

// The description of a line is the text before its IMEIs, without the prices and totals of the previous line.
function cleanDescription(text) {
  const afterLastPrice = text.split(/\d{1,5}(?:[.,]\d{1,2})?\s*€/).pop();
  const lastLine = afterLastPrice.split('\n').map(line => line.trim()).filter(Boolean).pop() || '';
  return lastLine.replace(/^\d{1,3}\s+(?=\D)/, '').replace(/[=:.\-\s]+$/, '').trim();
}

// When text is copied from a photo the table often comes column by column: all descriptions and IMEIs first,
// then all the prices. Those prices are matched to the lines by position.
function pricesByPosition(prices, imeiCounts) {
  const comeInUnitTotalPairs = prices.length >= imeiCounts.length * 2
    && imeiCounts.every((count, index) => Math.abs(prices[index * 2] * count - prices[index * 2 + 1]) < 0.01);
  return imeiCounts.map((_, index) => (comeInUnitTotalPairs ? prices[index * 2] : prices[index]) ?? null);
}

/**
 * Returns one entry per IMEI found: [{ brand, model, imei, cost }].
 * A line is: description, then its IMEIs, then the unit price (the first amount in € after the IMEIs).
 */
export function parseDeliveryNote(text) {
  const runs = [...text.matchAll(IMEI_RUN)];
  const lines = runs.map((run, index) => {
    const previousEnd = index === 0 ? 0 : runs[index - 1].index + runs[index - 1][0].length;
    const nextStart = index + 1 < runs.length ? runs[index + 1].index : text.length;
    const pricesAfter = [...text.slice(run.index + run[0].length, nextStart).matchAll(PRICE)].map(match => toNumber(match[1]));
    return {
      ...splitBrandAndModel(cleanDescription(text.slice(previousEnd, run.index))),
      imeis: run[0].match(/\d{15}/g),
      pricesAfter,
    };
  });

  const everyLineHasItsPrice = lines.every(line => line.pricesAfter.length);
  const trailingPrices = lines.length ? lines[lines.length - 1].pricesAfter : [];
  const costs = everyLineHasItsPrice
    ? lines.map(line => line.pricesAfter[0])
    : pricesByPosition(trailingPrices, lines.map(line => line.imeis.length));

  return lines.flatMap((line, index) =>
    line.imeis.map(imei => ({ brand: line.brand, model: line.model, imei, cost: costs[index] })));
}
