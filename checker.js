// Stock Checker — checks configured product URLs for availability
// and sends a push notification via ntfy.sh when something comes in stock.
//
// Designed to be extensible: each entry in `targets` is one product on one
// retailer. Add more entries (even from different sites) to expand coverage.
// Each target can optionally specify its own `parser` function if a
// retailer's page needs different logic than the default.

const NTFY_TOPIC = process.env.NTFY_TOPIC; // set as a GitHub Actions secret
const STATE_FILE = "./state.json"; // tracks last known status per target, to avoid spamming repeat notifications

import fs from "fs";

// ---- Default parser for Disney Store UK (Salesforce Commerce Cloud storefront) ----
// Looks at the rendered HTML for known phrases. If "Add to Bag" appears near
// the buy button and none of the out-of-stock phrases are present, we treat
// it as in stock. This is a simple heuristic — if Disney Store redesigns the
// page, this may need updating.
function disneyDefaultParser(html) {
  const outOfStockPhrases = ["Coming Soon", "Notify Me", "Sold Out", "Out of Stock"];
  const hasOutOfStockPhrase = outOfStockPhrases.some((phrase) => html.includes(phrase));
  const hasAddToBag = html.includes("Add to Bag");

  // Check "Add to Bag" FIRST and treat its presence as authoritative.
  // Out-of-stock phrases can appear elsewhere on the page (e.g. in a
  // "you may also like" carousel showing a different, sold-out product),
  // so their presence alone shouldn't override a genuine Add to Bag button.
  if (hasAddToBag) {
    return { inStock: true, reason: "Add to Bag present" };
  }
  if (hasOutOfStockPhrase) {
    return { inStock: false, reason: "Out-of-stock phrase found, no Add to Bag" };
  }
  // Ambiguous — couldn't confidently determine, so treat as not in stock but flag it
  return { inStock: false, reason: "UNCLEAR - manual check recommended", ambiguous: true };
}

// ---- Parser for Primark UK (store-level API) ----
// Uses Primark's internal GraphQL "StoresAvailabilityForSearch" endpoint,
// found via browser DevTools, which returns real per-store stock data —
// much more reliable than text-matching the page HTML (which is JS-rendered
// and doesn't show true stock state in a plain fetch).
//
// IMPORTANT CAVEAT: this endpoint was only confirmed working when called
// with real browser session cookies attached (Akamai bot-protection cookies:
// ak_bmsc, bm_sz, _abck). It is NOT yet confirmed to work from a script with
// no browser session. If this starts failing/blocking in GitHub Actions,
// that's the likely cause, and this approach may not be sustainable long-term.
function buildPrimarkStoreCheckUrl(sku, latitude, longitude, radius = 50) {
  const variables = encodeURIComponent(JSON.stringify({ sku, locale: "en-gb", latitude, longitude, radius }));
  const extensions = encodeURIComponent(
    JSON.stringify({
      persistedQuery: {
        version: 1,
        sha256Hash: "5da86d9ab00d044a08a86b2994962fb30c4b5b44328350a2ee46d21402701cc6",
      },
    })
  );
  return `https://api001-arh.primark.com/bff-cae-blue?operationName=StoresAvailabilityForSearch&variables=${variables}&extensions=${extensions}`;
}

function primarkStoreAvailabilityParser(responseText) {
  let json;
  try {
    json = JSON.parse(responseText);
  } catch {
    return { inStock: false, reason: "UNCLEAR - response wasn't valid JSON (possibly blocked)", ambiguous: true };
  }

  if (json.errors) {
    return { inStock: false, reason: `API returned an error: ${JSON.stringify(json.errors)}`, ambiguous: true };
  }

  const stores = json?.data?.geosearchWithInventory?.stores || [];
  if (stores.length === 0) {
    return { inStock: false, reason: "UNCLEAR - no stores returned, response shape may have changed", ambiguous: true };
  }

  // Known non-stock values seen so far: OUT_OF_STOCK, NOT_RANGED (store never carries this item).
  // Anything else (e.g. IN_STOCK, LOW_STOCK) is treated as available.
  const knownOutOfStockValues = ["OUT_OF_STOCK", "NOT_RANGED"];
  const inStockStore = stores.find((s) => !knownOutOfStockValues.includes(s.inventoryBySku?.available));

  if (inStockStore) {
    return {
      inStock: true,
      reason: `Available at ${inStockStore.geomodifier} (${inStockStore.address.postalCode}) — status: ${inStockStore.inventoryBySku.available}`,
    };
  }

  return { inStock: false, reason: `Checked ${stores.length} nearby stores, all OUT_OF_STOCK or NOT_RANGED` };
}

// ---- Add your target products here ----
// name: friendly label for notifications
// url: the product page to check
// parser: function(html) => { inStock, reason, ambiguous }
const targets = [
  {
    name: "Disney Princess Stationery Kit",
    url: "https://www.disneystore.co.uk/disney-princess-stationery-kit-435391289152.html",
    parser: disneyDefaultParser,
  },
  {
    name: "Disney Princess Coin Purse (Primark)",
    url: buildPrimarkStoreCheckUrl("212097357", 51.745330416241096, -1.2263556685776311, 100),
    parser: primarkStoreAvailabilityParser,
    extraHeaders: {
      accept: "*/*",
      "content-type": "application/json",
      origin: "https://www.primark.com",
      referer: "https://www.primark.com/",
    },
  },
  // Add more targets below, e.g.:
  // {
  //   name: "Some Other Item",
  //   url: "https://www.disneystore.co.uk/some-other-item.html",
  //   parser: disneyDefaultParser,
  // },
];

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function sendNotification(title, message, url) {
  if (!NTFY_TOPIC) {
    console.warn("NTFY_TOPIC not set — skipping notification. Message was:", title, message);
    return;
  }
  try {
    await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: "POST",
      headers: {
        Title: title, // must be plain ASCII/Latin-1 — no emoji, HTTP headers can't carry them
        Priority: "high",
        Tags: "tada", // this renders as a 🎉 icon in the ntfy app itself, no need to put emoji in the text
        ...(url ? { Click: url } : {}),
      },
      body: message,
    });
    console.log(`Notification sent: ${title}`);
  } catch (err) {
    console.error("Failed to send notification:", err.message);
  }
}

async function checkTarget(target, state) {
  console.log(`Checking: ${target.name}`);
  try {
    const res = await fetch(target.url, {
      headers: {
        // Pretend to be a normal browser to reduce chance of being blocked
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        ...(target.extraHeaders || {}), // allows per-target overrides, e.g. origin/referer for API endpoints
      },
    });

    if (!res.ok) {
      console.warn(`  Non-OK response (${res.status}) for ${target.name}`);
      return;
    }

    const html = await res.text();
    const result = target.parser(html);
    const previousInStock = state[target.url]?.inStock ?? false;

    console.log(`  Result: inStock=${result.inStock} (${result.reason})`);

    if (result.ambiguous) {
      console.warn(`  AMBIGUOUS result for ${target.name} — page structure may have changed`);
    }

    // Only notify on a *transition* from out-of-stock to in-stock,
    // so you don't get repeat notifications every run while it stays in stock.
    if (result.inStock && !previousInStock) {
      await sendNotification(
        `${target.name} is IN STOCK!`,
        `Just spotted availability — grab it before it's gone.`,
        target.url
      );
    }

    state[target.url] = { inStock: result.inStock, lastChecked: new Date().toISOString() };
  } catch (err) {
    console.error(`  Error checking ${target.name}:`, err.message);
  }
}

async function main() {
  const state = loadState();

  for (const target of targets) {
    await checkTarget(target, state);
    // Small delay between requests to be polite to the server
    await new Promise((r) => setTimeout(r, 1500));
  }

  saveState(state);
}

main();
